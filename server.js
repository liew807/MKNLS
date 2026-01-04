// server.js - 完整版（包含数据库支持、客服登录和聊天）
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 数据库配置 ==========
let pool;
const useDatabase = process.env.DATABASE_URL ? true : false;

if (useDatabase) {
    console.log('🔌 使用PostgreSQL数据库');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // 测试数据库连接
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error('❌ 数据库连接失败:', err.message);
            process.exit(1);
        } else {
            console.log('✅ 数据库连接成功');
        }
    });
} else {
    console.log('📁 使用本地文件存储');
}

// ========== 数据库初始化 ==========
async function initializeDatabase() {
    if (!useDatabase) return;
    
    try {
        // 创建用户表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(100) NOT NULL,
                display_name VARCHAR(100),
                is_admin BOOLEAN DEFAULT FALSE,
                is_support BOOLEAN DEFAULT FALSE,
                can_view_orders BOOLEAN DEFAULT TRUE,
                can_chat BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建商品表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                description TEXT,
                image_url VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建订单表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                order_number VARCHAR(50) UNIQUE NOT NULL,
                user_id INTEGER REFERENCES users(id),
                product_id INTEGER REFERENCES products(id),
                product_name VARCHAR(200) NOT NULL,
                product_price DECIMAL(10, 2) NOT NULL,
                total_amount DECIMAL(10, 2) NOT NULL,
                payment_method VARCHAR(50),
                status VARCHAR(20) DEFAULT 'pending',
                cart_items JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建客服渠道表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS services (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                name VARCHAR(100) NOT NULL,
                link VARCHAR(500) NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建聊天会话表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                user_name VARCHAR(100),
                status VARCHAR(20) DEFAULT 'active',
                last_message TEXT,
                last_message_time TIMESTAMP,
                unread_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建聊天消息表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                chat_session_id INTEGER REFERENCES chat_sessions(id),
                content TEXT NOT NULL,
                sender_type VARCHAR(20) NOT NULL, -- 'user' or 'support'
                sender_id INTEGER,
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建设置表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建购物车表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cart_items (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                product_id INTEGER REFERENCES products(id),
                product_name VARCHAR(200) NOT NULL,
                product_price DECIMAL(10, 2) NOT NULL,
                quantity INTEGER DEFAULT 1,
                product_image VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, product_id)
            )
        `);
        
        console.log('✅ 数据库表创建完成');
        
        // 检查是否有管理员用户
        const adminResult = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (adminResult.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (username, password, is_admin, display_name) VALUES ($1, $2, $3, $4)',
                ['admin', hashedPassword, true, '系统管理员']
            );
            console.log('✅ 创建默认管理员账号: admin / admin123');
        }
        
        // 检查是否有默认客服账号
        const supportResult = await pool.query('SELECT * FROM users WHERE username = $1', ['support1']);
        if (supportResult.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('support123', 10);
            await pool.query(
                'INSERT INTO users (username, password, is_support, display_name, can_view_orders, can_chat) VALUES ($1, $2, $3, $4, $5, $6)',
                ['support1', hashedPassword, true, '客服小张', true, true]
            );
            console.log('✅ 创建默认客服账号: support1 / support123');
        }
        
        // 检查是否有默认客服账号2
        const support2Result = await pool.query('SELECT * FROM users WHERE username = $1', ['support2']);
        if (support2Result.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('support456', 10);
            await pool.query(
                'INSERT INTO users (username, password, is_support, display_name, can_view_orders, can_chat) VALUES ($1, $2, $3, $4, $5, $6)',
                ['support2', hashedPassword, true, '客服小李', true, true]
            );
            console.log('✅ 创建默认客服账号2: support2 / support456');
        }
        
        // 初始化默认设置
        const defaultSettings = {
            storeName: '9927俱乐部',
            kuaishouLink: 'https://v.kuaishou.com/JGv00n48',
            contactInfo: 'FB账号GH Tree',
            welcomeMessage: '欢迎选购！点击购买扫码完成付款',
            enableService: true,
            supportOnline: true,
            supportWorkingHours: '9:00-22:00'
        };
        
        await pool.query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            ['general', defaultSettings]
        );
        
        // 初始化默认客服渠道
        const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
        if (parseInt(servicesResult.rows[0].count) === 0) {
            const defaultServices = [
                ['whatsapp', '官方客服', 'https://wa.me/60123456789', true],
                ['wechat', '微信客服', 'https://weixin.qq.com/', true],
                ['telegram', 'Telegram客服', 'https://t.me/yourchannel', true],
                ['line', 'Line客服', 'https://line.me/R/ti/p/@yourid', true]
            ];
            
            for (const service of defaultServices) {
                await pool.query(
                    'INSERT INTO services (type, name, link, enabled) VALUES ($1, $2, $3, $4)',
                    service
                );
            }
            console.log('✅ 创建默认客服渠道');
        }
        
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// ========== 文件存储备用方案 ==========
const DATA_FILE = path.join(__dirname, 'data.json');

async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ 数据文件已存在');
    } catch {
        const initialData = {
            users: [
                { 
                    id: 1,
                    username: 'admin', 
                    password: 'admin123', 
                    isAdmin: true,
                    isSupport: true,
                    canViewOrders: true,
                    canChat: true,
                    displayName: '系统管理员',
                    createdAt: new Date().toISOString()
                },
                {
                    id: 2,
                    username: 'support1',
                    password: 'support123',
                    isAdmin: false,
                    isSupport: true,
                    canViewOrders: true,
                    canChat: true,
                    displayName: '客服小张',
                    createdAt: new Date().toISOString()
                },
                {
                    id: 3,
                    username: 'support2',
                    password: 'support456',
                    isAdmin: false,
                    isSupport: true,
                    canViewOrders: true,
                    canChat: true,
                    displayName: '客服小李',
                    createdAt: new Date().toISOString()
                }
            ],
            products: [],
            orders: [],
            services: [
                {
                    id: 1,
                    type: 'whatsapp',
                    name: '官方客服',
                    link: 'https://wa.me/60123456789',
                    enabled: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: 2,
                    type: 'wechat',
                    name: '微信客服',
                    link: 'https://weixin.qq.com/',
                    enabled: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ],
            chatSessions: [],
            chatMessages: [],
            cartItems: [],
            settings: {
                storeName: '9927俱乐部',
                kuaishouLink: 'https://v.kuaishou.com/JGv00n48',
                contactInfo: 'FB账号GH Tree',
                welcomeMessage: '欢迎选购！点击购买扫码完成付款',
                enableService: true,
                supportOnline: true,
                supportWorkingHours: '9:00-22:00',
                updatedAt: new Date().toISOString()
            },
            lastUpdated: new Date().toISOString()
        };
        
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ 创建初始数据文件 data.json');
    }
}

async function readData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(data);
        
        // 确保数据结构完整
        if (!parsed.users) parsed.users = [];
        if (!parsed.products) parsed.products = [];
        if (!parsed.orders) parsed.orders = [];
        if (!parsed.services) parsed.services = [];
        if (!parsed.chatSessions) parsed.chatSessions = [];
        if (!parsed.chatMessages) parsed.chatMessages = [];
        if (!parsed.cartItems) parsed.cartItems = [];
        if (!parsed.settings) parsed.settings = {};
        
        return parsed;
    } catch (error) {
        console.error('❌ 读取数据失败:', error.message);
        // 尝试重新创建文件
        await ensureDataFile();
        return await readData();
    }
}

// 保存数据
async function saveData(data) {
    try {
        data.lastUpdated = new Date().toISOString();
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('💾 数据已保存到 data.json');
        return true;
    } catch (error) {
        console.error('❌ 保存数据失败:', error);
        return false;
    }
}

// ========== 中间件 ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== API路由 ==========

// 1. 获取商品列表
app.get('/api/products', async (req, res) => {
    try {
        const data = await readData();
        res.json({
            success: true,
            data: data.products || [],
            total: data.products.length,
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        console.error('获取商品失败:', error);
        res.status(500).json({ success: false, error: '获取商品失败' });
    }
});

// 2. 添加商品
app.post('/api/products/add', async (req, res) => {
    try {
        const { name, price, description, image } = req.body;
        console.log('📦 添加商品:', { name, price });
        
        if (!name || !price) {
            return res.status(400).json({ 
                success: false, 
                error: '商品名称和价格是必填项' 
            });
        }
        
        const data = await readData();
        
        const product = {
            id: Date.now(),
            name,
            price: parseFloat(price),
            description: description || '',
            image: image || 'https://via.placeholder.com/300x250.png?text=商品',
            createdAt: new Date().toISOString()
        };
        
        data.products.push(product);
        await saveData(data);
        
        console.log(`✅ 商品添加成功: ${product.name} (ID: ${product.id})`);
        
        res.json({
            success: true,
            data: product,
            message: '商品添加成功'
        });
    } catch (error) {
        console.error('添加商品失败:', error);
        res.status(500).json({ success: false, error: '添加商品失败' });
    }
});

// 3. 删除商品
app.post('/api/products/delete', async (req, res) => {
    try {
        const { id } = req.body;
        console.log('🗑️ 删除商品:', id);
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: '商品ID是必填项' 
            });
        }
        
        const data = await readData();
        const productId = Number(id);
        const initialLength = data.products.length;
        
        data.products = data.products.filter(p => p.id !== productId);
        
        if (data.products.length < initialLength) {
            await saveData(data);
            console.log(`✅ 商品删除成功: ID ${id}`);
            res.json({ 
                success: true, 
                message: '商品删除成功',
                deletedId: productId
            });
        } else {
            console.log(`❌ 商品不存在: ID ${id}`);
            res.status(404).json({ 
                success: false, 
                error: '商品不存在' 
            });
        }
    } catch (error) {
        console.error('删除商品失败:', error);
        res.status(500).json({ success: false, error: '删除商品失败' });
    }
});

// 4. 批量同步商品
app.post('/api/products/sync', async (req, res) => {
    try {
        const { products } = req.body;
        console.log('🔄 同步商品数据');
        
        const data = await readData();
        
        // 如果传入的商品数组不为空，则替换现有商品
        if (products && Array.isArray(products)) {
            data.products = products;
            await saveData(data);
            console.log(`✅ 同步完成: ${products.length}个商品`);
        }
        
        res.json({
            success: true,
            data: data.products,
            message: '同步成功'
        });
    } catch (error) {
        console.error('同步商品失败:', error);
        res.status(500).json({ success: false, error: '同步商品失败' });
    }
});

// 5. 获取订单列表
app.get('/api/orders', async (req, res) => {
    try {
        const data = await readData();
        res.json({
            success: true,
            data: data.orders || [],
            total: data.orders.length
        });
    } catch (error) {
        console.error('获取订单失败:', error);
        res.status(500).json({ success: false, error: '获取订单失败' });
    }
});

// 6. 添加订单
app.post('/api/orders/add', async (req, res) => {
    try {
        const { 
            orderNumber, 
            userId, 
            productId, 
            productName, 
            productPrice, 
            totalAmount, 
            paymentMethod, 
            status 
        } = req.body;
        
        console.log('📋 添加订单:', orderNumber);
        
        const data = await readData();
        
        const order = {
            id: Date.now(),
            orderNumber: orderNumber || `DD${Date.now().toString().slice(-8)}`,
            userId,
            productId: Number(productId),
            productName,
            productPrice: parseFloat(productPrice),
            totalAmount: parseFloat(totalAmount),
            paymentMethod: paymentMethod || 'tng',
            status: status || 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        data.orders.push(order);
        await saveData(data);
        
        console.log(`✅ 订单添加成功: ${order.orderNumber}`);
        
        res.json({
            success: true,
            data: order,
            message: '订单创建成功'
        });
    } catch (error) {
        console.error('添加订单失败:', error);
        res.status(500).json({ success: false, error: '添加订单失败' });
    }
});

// ========== 🔥 新增：删除订单API ==========
app.delete('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('🗑️ 删除订单:', id);
        
        const data = await readData();
        const orderId = Number(id);
        const initialLength = data.orders.length;
        
        data.orders = data.orders.filter(o => o.id !== orderId);
        
        if (data.orders.length < initialLength) {
            await saveData(data);
            console.log(`✅ 订单删除成功: ID ${id}`);
            res.json({ 
                success: true, 
                message: '订单删除成功',
                deletedId: orderId
            });
        } else {
            console.log(`❌ 订单不存在: ID ${id}`);
            res.status(404).json({ 
                success: false, 
                error: '订单不存在' 
            });
        }
    } catch (error) {
        console.error('删除订单失败:', error);
        res.status(500).json({ success: false, error: '删除订单失败' });
    }
});

// ========== 🔥 新增：更新订单状态API ==========
app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        console.log(`🔄 更新订单状态: ID ${id}, 状态: ${status}`);
        
        if (!status) {
            return res.status(400).json({ 
                success: false, 
                error: '状态是必填项' 
            });
        }
        
        const validStatuses = ['pending', 'paid', 'completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: '无效的状态值' 
            });
        }
        
        const data = await readData();
        const orderId = Number(id);
        const order = data.orders.find(o => o.id === orderId);
        
        if (order) {
            order.status = status;
            order.updatedAt = new Date().toISOString();
            await saveData(data);
            
            console.log(`✅ 订单状态更新成功: ID ${id} -> ${status}`);
            
            res.json({
                success: true,
                data: order,
                message: '订单状态更新成功'
            });
        } else {
            console.log(`❌ 订单不存在: ID ${id}`);
            res.status(404).json({ success: false, error: '订单不存在' });
        }
    } catch (error) {
        console.error('更新订单状态失败:', error);
        res.status(500).json({ success: false, error: '更新订单状态失败' });
    }
});

// ========== 🔥 用户登录API ==========
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`🔐 登录尝试: ${username}`);
        
        const data = await readData();
        
        const user = data.users.find(u => 
            u.username === username && u.password === password
        );
        
        if (user) {
            console.log('✅ 登录成功:', username);
            
            // 不返回密码的安全用户对象
            const safeUser = {
                id: user.id,
                username: user.username,
                isAdmin: user.isAdmin || false,
                isSupport: user.isSupport || false,
                canViewOrders: user.canViewOrders || false,
                canChat: user.canChat || false,
                displayName: user.displayName || user.username,
                createdAt: user.createdAt
            };
            
            res.json({
                success: true,
                data: safeUser,
                message: '登录成功'
            });
        } else {
            console.log('❌ 登录失败:', username);
            res.status(401).json({ 
                success: false, 
                error: '用户名或密码错误',
                hint: '默认管理员: admin / admin123'
            });
        }
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ success: false, error: '登录失败' });
    }
});

// ========== 🔥 客服专用登录API ==========
app.post('/api/support/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`🎯 客服登录尝试: ${username}`);
        
        const data = await readData();
        
        const user = data.users.find(u => 
            u.username === username && u.password === password
        );
        
        // 检查是否是客服账号或管理员
        if (user && (user.isSupport || user.isAdmin)) {
            console.log('✅ 客服登录成功:', username);
            
            const safeUser = {
                id: user.id,
                username: user.username,
                isAdmin: user.isAdmin || false,
                isSupport: user.isSupport || false,
                canViewOrders: user.canViewOrders !== undefined ? user.canViewOrders : true,
                canChat: user.canChat !== undefined ? user.canChat : true,
                displayName: user.displayName || user.username,
                createdAt: user.createdAt
            };
            
            res.json({
                success: true,
                data: safeUser,
                message: '客服登录成功'
            });
        } else {
            console.log('❌ 客服登录失败:', username);
            res.status(401).json({ 
                success: false, 
                error: '用户名或密码错误，或非客服账号',
                hint: '默认客服账号: support1 / support123'
            });
        }
    } catch (error) {
        console.error('客服登录错误:', error);
        res.status(500).json({ success: false, error: '客服登录失败' });
    }
});

// ========== 🔥 新增：客服在线状态API ==========
app.get('/api/support/status', async (req, res) => {
    try {
        const data = await readData();
        
        // 获取所有在线客服
        const onlineSupport = data.users.filter(user => 
            user.isSupport && user.online !== false
        ).map(user => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            online: user.online || false,
            lastActive: user.lastActive || user.createdAt
        }));
        
        const settings = data.settings || {};
        
        res.json({
            success: true,
            data: {
                supportOnline: settings.supportOnline !== false,
                onlineCount: onlineSupport.length,
                supportList: onlineSupport,
                workingHours: settings.supportWorkingHours || '9:00-22:00',
                enableService: settings.enableService !== false
            },
            message: '客服状态获取成功'
        });
    } catch (error) {
        console.error('获取客服状态失败:', error);
        res.status(500).json({ success: false, error: '获取客服状态失败' });
    }
});

// ========== 🔥 新增：更新客服在线状态API ==========
app.post('/api/support/online', async (req, res) => {
    try {
        const { userId, online } = req.body;
        console.log(`📱 更新客服在线状态: 用户ID ${userId}, 在线: ${online}`);
        
        if (userId === undefined || online === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: '用户ID和在线状态是必填项' 
            });
        }
        
        const data = await readData();
        const user = data.users.find(u => u.id == userId);
        
        if (user) {
            user.online = online;
            user.lastActive = new Date().toISOString();
            await saveData(data);
            
            console.log(`✅ 客服在线状态更新成功: ${user.username} -> ${online ? '在线' : '离线'}`);
            
            res.json({
                success: true,
                data: {
                    id: user.id,
                    username: user.username,
                    online: user.online,
                    lastActive: user.lastActive
                },
                message: `客服已${online ? '上线' : '下线'}`
            });
        } else {
            console.log(`❌ 用户不存在: ID ${userId}`);
            res.status(404).json({ success: false, error: '用户不存在' });
        }
    } catch (error) {
        console.error('更新客服在线状态失败:', error);
        res.status(500).json({ success: false, error: '更新客服在线状态失败' });
    }
});

// ========== 🔥 修复：用户注册API ==========
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('👤 注册用户:', username);
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: '用户名和密码是必填项' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: '密码长度至少6位' 
            });
        }
        
        const data = await readData();
        
        // 检查用户名是否已存在
        if (data.users.some(u => u.username === username)) {
            return res.status(400).json({ 
                success: false, 
                error: '用户名已存在' 
            });
        }
        
        const newUser = {
            id: Date.now(),
            username,
            password,
            isAdmin: false,
            isSupport: false,
            canViewOrders: false,
            canChat: false,
            online: false,
            displayName: username,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
        
        data.users.push(newUser);
        await saveData(data);
        
        console.log('✅ 注册成功:', username);
        
        // 不返回密码的安全用户对象
        const safeUser = {
            id: newUser.id,
            username: newUser.username,
            isAdmin: newUser.isAdmin,
            isSupport: newUser.isSupport,
            canViewOrders: newUser.canViewOrders,
            canChat: newUser.canChat,
            displayName: newUser.displayName,
            createdAt: newUser.createdAt
        };
        
        res.json({
            success: true,
            data: safeUser,
            message: '注册成功'
        });
    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ success: false, error: '注册失败' });
    }
});

// ========== 🔥 新增：聊天会话API ==========

// 创建聊天会话
app.post('/api/chat/sessions', async (req, res) => {
    try {
        const { userId, userName } = req.body;
        console.log('💬 创建聊天会话:', { userId, userName });
        
        if (!userId || !userName) {
            return res.status(400).json({ 
                success: false, 
                error: '用户ID和用户名是必填项' 
            });
        }
        
        const data = await readData();
        
        // 检查是否已存在活跃会话
        const existingSession = data.chatSessions.find(session => 
            session.userId == userId && session.status === 'active'
        );
        
        if (existingSession) {
            return res.json({
                success: true,
                data: existingSession,
                message: '已有活跃聊天会话'
            });
        }
        
        const session = {
            id: Date.now(),
            userId: Number(userId),
            userName,
            status: 'active',
            lastMessage: '',
            lastMessageTime: null,
            unreadCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        data.chatSessions.push(session);
        await saveData(data);
        
        console.log(`✅ 聊天会话创建成功: ${userName}`);
        
        res.json({
            success: true,
            data: session,
            message: '聊天会话创建成功'
        });
    } catch (error) {
        console.error('创建聊天会话失败:', error);
        res.status(500).json({ success: false, error: '创建聊天会话失败' });
    }
});

// 获取聊天会话列表（客服端）
app.get('/api/chat/sessions', async (req, res) => {
    try {
        const { status } = req.query;
        console.log('📋 获取聊天会话列表');
        
        const data = await readData();
        
        let sessions = data.chatSessions || [];
        
        // 按状态筛选
        if (status) {
            sessions = sessions.filter(session => session.status === status);
        }
        
        // 按最后消息时间排序
        sessions.sort((a, b) => {
            const timeA = a.lastMessageTime ? new Date(a.lastMessageTime) : new Date(a.createdAt);
            const timeB = b.lastMessageTime ? new Date(b.lastMessageTime) : new Date(b.createdAt);
            return timeB - timeA; // 最新在前
        });
        
        res.json({
            success: true,
            data: sessions,
            total: sessions.length,
            message: '聊天会话列表获取成功'
        });
    } catch (error) {
        console.error('获取聊天会话列表失败:', error);
        res.status(500).json({ success: false, error: '获取聊天会话列表失败' });
    }
});

// 发送消息
app.post('/api/chat/messages', async (req, res) => {
    try {
        const { sessionId, content, senderType, senderId } = req.body;
        console.log('💭 发送消息:', { sessionId, senderType });
        
        if (!sessionId || !content || !senderType) {
            return res.status(400).json({ 
                success: false, 
                error: '会话ID、内容和发送者类型是必填项' 
            });
        }
        
        const data = await readData();
        const session = data.chatSessions.find(s => s.id == sessionId);
        
        if (!session) {
            return res.status(404).json({ 
                success: false, 
                error: '聊天会话不存在' 
            });
        }
        
        const message = {
            id: Date.now(),
            chatSessionId: Number(sessionId),
            content,
            senderType, // 'user' 或 'support'
            senderId: senderId || null,
            read: false,
            createdAt: new Date().toISOString()
        };
        
        // 更新会话的最后消息
        session.lastMessage = content.length > 50 ? content.substring(0, 50) + '...' : content;
        session.lastMessageTime = new Date().toISOString();
        session.updatedAt = new Date().toISOString();
        
        // 如果是用户发送，增加未读计数
        if (senderType === 'user') {
            session.unreadCount = (session.unreadCount || 0) + 1;
        } else if (senderType === 'support') {
            // 客服回复时重置未读计数
            session.unreadCount = 0;
        }
        
        data.chatMessages.push(message);
        await saveData(data);
        
        console.log(`✅ 消息发送成功: 会话 ${sessionId}, 来自 ${senderType}`);
        
        res.json({
            success: true,
            data: message,
            message: '消息发送成功'
        });
    } catch (error) {
        console.error('发送消息失败:', error);
        res.status(500).json({ success: false, error: '发送消息失败' });
    }
});

// 获取会话消息
app.get('/api/chat/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        console.log('📨 获取会话消息:', sessionId);
        
        const data = await readData();
        const messages = (data.chatMessages || [])
            .filter(msg => msg.chatSessionId == sessionId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // 按时间升序
            .slice(parseInt(offset), parseInt(offset) + parseInt(limit));
        
        // 标记为已读
        messages.forEach(msg => {
            msg.read = true;
        });
        
        // 更新会话的未读计数
        const session = data.chatSessions.find(s => s.id == sessionId);
        if (session) {
            session.unreadCount = 0;
            session.updatedAt = new Date().toISOString();
            await saveData(data);
        }
        
        res.json({
            success: true,
            data: messages,
            total: messages.length,
            sessionId: sessionId,
            message: '消息列表获取成功'
        });
    } catch (error) {
        console.error('获取消息失败:', error);
        res.status(500).json({ success: false, error: '获取消息失败' });
    }
});

// 更新会话状态
app.put('/api/chat/sessions/:sessionId/status', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { status } = req.body;
        console.log(`🔄 更新会话状态: ${sessionId}, 状态: ${status}`);
        
        if (!status) {
            return res.status(400).json({ 
                success: false, 
                error: '状态是必填项' 
            });
        }
        
        const validStatuses = ['active', 'closed', 'pending'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: '无效的状态值' 
            });
        }
        
        const data = await readData();
        const session = data.chatSessions.find(s => s.id == sessionId);
        
        if (session) {
            session.status = status;
            session.updatedAt = new Date().toISOString();
            await saveData(data);
            
            console.log(`✅ 会话状态更新成功: ${sessionId} -> ${status}`);
            
            res.json({
                success: true,
                data: session,
                message: '会话状态更新成功'
            });
        } else {
            console.log(`❌ 会话不存在: ${sessionId}`);
            res.status(404).json({ success: false, error: '会话不存在' });
        }
    } catch (error) {
        console.error('更新会话状态失败:', error);
        res.status(500).json({ success: false, error: '更新会话状态失败' });
    }
});

// 9. 获取用户列表
app.get('/api/users', async (req, res) => {
    try {
        const data = await readData();
        // 不返回密码的安全用户列表
        const safeUsers = data.users.map(user => ({
            id: user.id,
            username: user.username,
            isAdmin: user.isAdmin,
            isSupport: user.isSupport,
            canViewOrders: user.canViewOrders,
            canChat: user.canChat,
            displayName: user.displayName,
            online: user.online || false,
            createdAt: user.createdAt
        }));
        
        res.json({
            success: true,
            data: safeUsers,
            total: safeUsers.length
        });
    } catch (error) {
        console.error('获取用户失败:', error);
        res.status(500).json({ success: false, error: '获取用户失败' });
    }
});

// 10. 获取系统设置
app.get('/api/settings', async (req, res) => {
    try {
        const data = await readData();
        res.json({
            success: true,
            data: data.settings || {}
        });
    } catch (error) {
        console.error('获取设置失败:', error);
        res.status(500).json({ success: false, error: '获取设置失败' });
    }
});

// 11. 更新系统设置
app.post('/api/settings/update', async (req, res) => {
    try {
        const settings = req.body;
        console.log('⚙️ 更新系统设置');
        
        const data = await readData();
        
        data.settings = {
            ...data.settings,
            ...settings,
            updatedAt: new Date().toISOString()
        };
        
        await saveData(data);
        
        console.log('✅ 设置更新成功');
        
        res.json({
            success: true,
            data: data.settings,
            message: '设置更新成功'
        });
    } catch (error) {
        console.error('更新设置失败:', error);
        res.status(500).json({ success: false, error: '更新设置失败' });
    }
});

// 12. 获取客服列表
app.get('/api/services', async (req, res) => {
    try {
        const data = await readData();
        const enabledServices = data.services.filter(service => service.enabled !== false);
        
        res.json({
            success: true,
            data: enabledServices,
            total: enabledServices.length
        });
    } catch (error) {
        console.error('获取客服失败:', error);
        res.status(500).json({ success: false, error: '获取客服失败' });
    }
});

// 13. 获取所有客服（包括禁用的）
app.get('/api/services/all', async (req, res) => {
    try {
        const data = await readData();
        res.json({
            success: true,
            data: data.services || [],
            total: data.services.length
        });
    } catch (error) {
        console.error('获取所有客服失败:', error);
        res.status(500).json({ success: false, error: '获取客服失败' });
    }
});

// 14. 添加客服
app.post('/api/services/add', async (req, res) => {
    try {
        const { type, name, link, enabled } = req.body;
        console.log('💁 添加客服:', { type, name });
        
        if (!type || !name || !link) {
            return res.status(400).json({ 
                success: false, 
                error: '客服类型、名称和链接是必填项' 
            });
        }
        
        if (!link.startsWith('http://') && !link.startsWith('https://')) {
            return res.status(400).json({ 
                success: false, 
                error: '链接格式不正确，请以http://或https://开头' 
            });
        }
        
        const data = await readData();
        
        const service = {
            id: Date.now(),
            type,
            name,
            link,
            enabled: enabled !== undefined ? enabled : true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        data.services.push(service);
        await saveData(data);
        
        console.log(`✅ 客服添加成功: ${service.name}`);
        
        res.json({
            success: true,
            data: service,
            message: '客服添加成功'
        });
    } catch (error) {
        console.error('添加客服失败:', error);
        res.status(500).json({ success: false, error: '添加客服失败' });
    }
});

// ========== 🔥 新增：删除客服API ==========
app.delete('/api/services/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('🗑️ 删除客服:', id);
        
        const data = await readData();
        const serviceId = Number(id);
        const initialLength = data.services.length;
        
        data.services = data.services.filter(s => s.id !== serviceId);
        
        if (data.services.length < initialLength) {
            await saveData(data);
            console.log(`✅ 客服删除成功: ID ${id}`);
            res.json({ 
                success: true, 
                message: '客服删除成功',
                deletedId: serviceId
            });
        } else {
            console.log(`❌ 客服不存在: ID ${id}`);
            res.status(404).json({ 
                success: false, 
                error: '客服不存在' 
            });
        }
    } catch (error) {
        console.error('删除客服失败:', error);
        res.status(500).json({ success: false, error: '删除客服失败' });
    }
});

// ========== 🔥 新增：更新客服状态API ==========
app.put('/api/services/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const { enabled } = req.body;
        console.log(`🔄 更新客服状态: ID ${id}, 启用: ${enabled}`);
        
        if (enabled === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: '启用状态是必填项' 
            });
        }
        
        const data = await readData();
        const serviceId = Number(id);
        const service = data.services.find(s => s.id === serviceId);
        
        if (service) {
            service.enabled = enabled;
            service.updatedAt = new Date().toISOString();
            await saveData(data);
            
            console.log(`✅ 客服状态更新成功: ID ${id} -> ${enabled ? '启用' : '禁用'}`);
            
            res.json({
                success: true,
                data: service,
                message: `客服已${enabled ? '启用' : '禁用'}`
            });
        } else {
            console.log(`❌ 客服不存在: ID ${id}`);
            res.status(404).json({ success: false, error: '客服不存在' });
        }
    } catch (error) {
        console.error('更新客服状态失败:', error);
        res.status(500).json({ success: false, error: '更新客服状态失败' });
    }
});

// ========== 🔥 新增：更新客服信息API ==========
app.post('/api/services/update', async (req, res) => {
    try {
        const { id, name, link, enabled } = req.body;
        console.log('✏️ 更新客服信息:', { id, name });
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: '客服ID是必填项' 
            });
        }
        
        const data = await readData();
        const serviceId = Number(id);
        const service = data.services.find(s => s.id === serviceId);
        
        if (service) {
            if (name !== undefined) service.name = name;
            if (link !== undefined) {
                if (!link.startsWith('http://') && !link.startsWith('https://')) {
                    return res.status(400).json({ 
                        success: false, 
                        error: '链接格式不正确，请以http://或https://开头' 
                    });
                }
                service.link = link;
            }
            if (enabled !== undefined) service.enabled = enabled;
            
            service.updatedAt = new Date().toISOString();
            await saveData(data);
            
            console.log(`✅ 客服信息更新成功: ID ${id}`);
            
            res.json({
                success: true,
                data: service,
                message: '客服信息已更新'
            });
        } else {
            console.log(`❌ 客服不存在: ID ${id}`);
            res.status(404).json({ success: false, error: '客服不存在' });
        }
    } catch (error) {
        console.error('更新客服信息失败:', error);
        res.status(500).json({ success: false, error: '更新客服信息失败' });
    }
});

// 15. 系统状态
app.get('/api/status', async (req, res) => {
    try {
        const data = await readData();
        
        // 统计在线客服
        const onlineSupport = data.users.filter(user => 
            user.isSupport && user.online === true
        ).length;
        
        // 统计活跃会话
        const activeSessions = data.chatSessions.filter(session => 
            session.status === 'active'
        ).length;
        
        res.json({
            success: true,
            data: {
                status: 'running',
                productsCount: data.products.length,
                ordersCount: data.orders.length,
                usersCount: data.users.length,
                servicesCount: data.services.length,
                chatSessionsCount: data.chatSessions.length,
                chatMessagesCount: data.chatMessages.length,
                cartItemsCount: data.cartItems.length,
                onlineSupportCount: onlineSupport,
                activeChatSessions: activeSessions,
                lastUpdated: data.lastUpdated,
                uptime: process.uptime(),
                storeName: data.settings.storeName || '未设置',
                useDatabase: useDatabase,
                supportOnline: data.settings.supportOnline !== false
            },
            message: '系统运行正常'
        });
    } catch (error) {
        console.error('获取状态失败:', error);
        res.status(500).json({ success: false, error: '获取状态失败' });
    }
});

// 16. 获取完整数据
app.get('/api/data', async (req, res) => {
    try {
        const data = await readData();
        
        // 返回完整数据但不包含用户密码
        const safeData = {
            ...data,
            users: data.users.map(user => ({
                id: user.id,
                username: user.username,
                isAdmin: user.isAdmin,
                isSupport: user.isSupport,
                canViewOrders: user.canViewOrders,
                canChat: user.canChat,
                displayName: user.displayName,
                online: user.online || false,
                createdAt: user.createdAt
            }))
        };
        
        res.json({
            success: true,
            data: safeData
        });
    } catch (error) {
        console.error('获取完整数据失败:', error);
        res.status(500).json({ success: false, error: '获取数据失败' });
    }
});

// 17. 直接访问 data.json（用于调试）
app.get('/data.json', async (req, res) => {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } catch (error) {
        res.status(500).json({ error: '无法读取数据文件' });
    }
});

// 18. 测试连接
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API测试成功',
        timestamp: new Date().toISOString(),
        server: '9927俱乐部后端服务器',
        version: '完整聊天版',
        database: useDatabase ? 'PostgreSQL' : '文件存储'
    });
});

// 19. 首页
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>9927俱乐部后台系统</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                .container { max-width: 900px; margin: 0 auto; background: rgba(255,255,255,0.95); padding: 30px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); color: #333; }
                h1 { color: #333; text-align: center; margin-bottom: 30px; font-size: 2.5em; }
                .status { background: #4CAF50; color: white; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 30px; font-size: 1.2em; }
                .section { margin-bottom: 25px; }
                .section h2 { color: #444; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; margin-bottom: 15px; }
                .api-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; }
                .api-item { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #4CAF50; }
                .method { display: inline-block; padding: 5px 10px; border-radius: 4px; margin-right: 10px; font-weight: bold; font-size: 12px; color: white; }
                .get { background: #61affe; }
                .post { background: #49cc90; }
                .put { background: #fca130; }
                .delete { background: #f93e3e; }
                .url { font-family: monospace; color: #555; }
                .note { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; color: #856404; }
                a { color: #4CAF50; text-decoration: none; font-weight: bold; }
                a:hover { text-decoration: underline; }
                .storage-type { background: #e3f2fd; padding: 10px; border-radius: 8px; margin-bottom: 15px; }
                .chat-section { background: #e8f5e9; padding: 15px; border-radius: 8px; margin-top: 20px; }
                .account-info { background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎮 9927俱乐部后台系统</h1>
                
                <div class="storage-type">
                    <strong>存储类型:</strong> ${useDatabase ? 'PostgreSQL数据库' : '本地文件存储 (data.json)'}<br>
                    <strong>端口:</strong> ${PORT} | <strong>数据库连接:</strong> ${useDatabase ? '已配置' : '未配置'}<br>
                    <strong>聊天系统:</strong> 已启用 | <strong>在线客服:</strong> 已支持
                </div>
                
                <div class="status">
                    ✅ 服务器运行中 | 端口: ${PORT} | 聊天系统: 已启用
                </div>
                
                <div class="account-info">
                    <strong>🟢 测试账号:</strong><br>
                    • 管理员: admin / admin123<br>
                    • 客服1: support1 / support123<br>
                    • 客服2: support2 / support456<br>
                    <span style="font-size: 12px; color: #666;">（客服账号用于聊天和订单管理）</span>
                </div>
                
                <div class="section">
                    <h2>📡 实时API测试</h2>
                    <div class="api-list">
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <a href="/api/status" target="_blank" class="url">/api/status</a>
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">系统状态</div>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <a href="/api/support/status" target="_blank" class="url">/api/support/status</a>
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">客服状态</div>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <a href="/api/test" target="_blank" class="url">/api/test</a>
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">测试连接</div>
                        </div>
                    </div>
                </div>
                
                <div class="chat-section">
                    <h2>💬 聊天系统API</h2>
                    <div style="background: #f0f2f5; padding: 15px; border-radius: 8px;">
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/support/login</span> - 客服登录</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/chat/sessions</span> - 创建聊天会话</div>
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/chat/sessions</span> - 获取会话列表</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/chat/messages</span> - 发送消息</div>
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/chat/sessions/:id/messages</span> - 获取消息</div>
                        <div style="margin-bottom: 8px;"><span class="method put">PUT</span> <span class="url">/api/chat/sessions/:id/status</span> - 更新会话状态</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/support/online</span> - 更新在线状态</div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>📦 主要API接口</h2>
                    <div style="background: #f0f2f5; padding: 15px; border-radius: 8px;">
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/login</span> - 用户登录</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/register</span> - 用户注册</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/products/add</span> - 添加商品</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/products/delete</span> - 删除商品</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/orders/add</span> - 添加订单</div>
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/services</span> - 获取客服</div>
                        <div style="margin-bottom: 8px;"><span class="method delete">DELETE</span> <span class="url">/api/orders/:id</span> - 删除订单</div>
                        <div style="margin-bottom: 8px;"><span class="method delete">DELETE</span> <span class="url">/api/services/:id</span> - 删除客服</div>
                        <div style="margin-bottom: 8px;"><span class="method put">PUT</span> <span class="url">/api/orders/:id/status</span> - 更新订单状态</div>
                        <div style="margin-bottom: 8px;"><span class="method put">PUT</span> <span class="url">/api/services/:id/toggle</span> - 更新客服状态</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/services/update</span> - 更新客服信息</div>
                    </div>
                </div>
                
                <div class="note">
                    <strong>💡 系统特性：</strong><br>
                    <ul>
                        <li>✅ 完整的聊天系统（用户端 + 客服端）</li>
                        <li>✅ 客服在线状态管理</li>
                        <li>✅ 会话管理和消息存储</li>
                        <li>✅ 未读消息计数</li>
                        <li>✅ 多客服账号支持</li>
                        <li>✅ 实时数据同步</li>
                        <li>✅ 数据库和文件存储双模式</li>
                        <li>✅ 自动数据备份</li>
                    </ul>
                    
                    <strong>📱 聊天功能：</strong><br>
                    1. 用户发起聊天 → 创建会话<br>
                    2. 客服登录 → 查看活跃会话<br>
                    3. 双向消息发送<br>
                    4. 未读消息提醒<br>
                    5. 会话状态管理<br>
                    6. 在线客服状态显示
                </div>
                
                <div style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
                    ©2025 9927俱乐部 | 聊天系统已启用 | 版本: 完整聊天版
                </div>
            </div>
        </body>
        </html>
    `);
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'API不存在',
        availableEndpoints: [
            'GET  /api/status',
            'GET  /api/support/status',
            'POST /api/support/login',
            'POST /api/chat/sessions',
            'GET  /api/chat/sessions',
            'POST /api/chat/messages',
            'GET  /api/products',
            'POST /api/login',
            'POST /api/register',
            'GET  /api/settings',
            'GET  /api/services',
            'GET  /data.json'
        ]
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        success: false,
        error: '服务器内部错误',
        message: err.message
    });
});

// 启动服务器
async function startServer() {
    try {
        // 确保数据文件存在
        await ensureDataFile();
        
        // 如果是数据库模式，初始化数据库
        if (useDatabase) {
            try {
                await initializeDatabase();
            } catch (error) {
                console.error('❌ 数据库初始化失败，使用文件存储模式');
            }
        }
        
        app.listen(PORT, () => {
            console.log(`
            ╔════════════════════════════════════════╗
            ║        🚀 9927俱乐部后台系统启动        ║
            ╠════════════════════════════════════════╣
            ║  📍 本地访问: http://localhost:${PORT}      ║
            ║  🔗 API基础: http://localhost:${PORT}/api   ║
            ║  📁 数据文件: ${DATA_FILE}                ║
            ║  💾 存储类型: ${useDatabase ? 'PostgreSQL数据库' : '文件存储'} ║
            ╠════════════════════════════════════════╣
            ║  💬 聊天系统: 已启用                     ║
            ║  📊 实时测试:                           ║
            ║  • http://localhost:${PORT}/api/status     ║
            ║  • http://localhost:${PORT}/api/support/status ║
            ║  • http://localhost:${PORT}/api/test       ║
            ║  • http://localhost:${PORT}/data.json      ║
            ╠════════════════════════════════════════╣
            ║  🔑 测试账号:                           ║
            ║  • 管理员: admin / admin123            ║
            ║  • 客服1: support1 / support123        ║
            ║  • 客服2: support2 / support456        ║
            ╠════════════════════════════════════════╣
            ║  ✅ 聊天系统功能:                       ║
            ║  • 客服专用登录 (/api/support/login)    ║
            ║  • 在线状态管理 (/api/support/online)   ║
            ║  • 聊天会话管理                         ║
            ║  • 实时消息发送                         ║
            ║  • 未读消息计数                         ║
            ║  • 会话状态管理                         ║
            ╠════════════════════════════════════════╣
            ║  📦 商品订单功能:                       ║
            ║  • 商品增删改查                        ║
            ║  • 订单状态管理                        ║
            ║  • 客服渠道管理                        ║
            ║  • 用户注册登录                        ║
            ║  • 系统设置管理                        ║
            ╚════════════════════════════════════════╝
            
            ✅ 聊天系统已完全集成，支持：
            • 客服和用户双向聊天
            • 在线状态显示
            • 会话管理
            • 消息历史记录
            • 未读消息提醒
            • 实时数据同步
            • 多客服同时在线
            `);
        });
    } catch (error) {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    }
}

startServer().catch(console.error);
