// server.js - 完整修复版（包含消息发送功能）
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== 文件存储配置 ==========
const DATA_FILE = path.join(__dirname, 'data.json');

// 确保数据文件存在
async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ 数据文件已存在');
        
        // 读取并检查现有数据
        const data = await readData();
        console.log(`📊 当前用户数: ${data.users?.length || 0}`);
        console.log(`📦 当前商品数: ${data.products?.length || 0}`);
        console.log(`📋 当前订单数: ${data.orders?.length || 0}`);
        console.log(`💬 当前聊天会话: ${data.chatSessions?.length || 0}`);
        console.log(`💭 当前消息数: ${data.chatMessages?.length || 0}`);
        
        return true;
    } catch {
        console.log('📁 创建初始数据文件...');
        
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
                    online: true,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    lastActive: new Date().toISOString()
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
                    online: true,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    lastActive: new Date().toISOString()
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
                    online: true,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    lastActive: new Date().toISOString()
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
        console.log('🔑 默认账号:');
        console.log('   • admin / admin123 (管理员)');
        console.log('   • support1 / support123 (客服)');
        console.log('   • support2 / support456 (客服)');
        
        return true;
    }
}

// 读取数据
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

// ========== API路由 ==========

// 1. 测试连接
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API测试成功',
        timestamp: new Date().toISOString(),
        server: '9927俱乐部后台系统',
        version: '文件存储版',
        storage: 'data.json'
    });
});

// 2. 客服登录
app.post('/api/support/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`🎯 客服登录尝试: ${username}`);
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: '用户名和密码是必填项' 
            });
        }
        
        const data = await readData();
        
        const user = data.users.find(u => 
            u.username === username && u.password === password
        );
        
        // 检查是否是客服账号或管理员
        if (user && (user.isSupport === true || user.isAdmin === true)) {
            console.log('✅ 客服登录成功:', username);
            
            // 更新在线状态
            user.online = true;
            user.lastActive = new Date().toISOString();
            await saveData(data);
            
            const safeUser = {
                id: user.id,
                username: user.username,
                isAdmin: user.isAdmin || false,
                isSupport: user.isSupport || false,
                canViewOrders: user.canViewOrders !== undefined ? user.canViewOrders : true,
                canChat: user.canChat !== undefined ? user.canChat : true,
                displayName: user.displayName || user.username,
                online: true,
                createdAt: user.createdAt
            };
            
            res.json({
                success: true,
                data: safeUser,
                message: '客服登录成功'
            });
        } else {
            res.status(401).json({ 
                success: false, 
                error: '用户名或密码错误，或非客服账号',
                hint: '默认客服账号: support1 / support123'
            });
        }
    } catch (error) {
        console.error('客服登录错误:', error);
        res.status(500).json({ 
            success: false, 
            error: '客服登录失败'
        });
    }
});

// 3. 普通用户登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`🔐 用户登录尝试: ${username}`);
        
        const data = await readData();
        
        const user = data.users.find(u => 
            u.username === username && u.password === password
        );
        
        if (user) {
            console.log('✅ 用户登录成功:', username);
            
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
            res.status(401).json({ 
                success: false, 
                error: '用户名或密码错误',
                hint: '默认账号: admin / admin123'
            });
        }
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ success: false, error: '登录失败' });
    }
});

// ========== 🔥 修复：聊天会话API ==========

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
            console.log('✅ 使用现有会话:', existingSession.id);
            return res.json({
                success: true,
                data: existingSession,
                message: '已有活跃聊天会话'
            });
        }
        
        const sessionId = Date.now();
        const session = {
            id: sessionId,
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
        
        console.log(`✅ 聊天会话创建成功: ID ${sessionId}, 用户: ${userName}`);
        
        res.json({
            success: true,
            data: session,
            message: '聊天会话创建成功'
        });
    } catch (error) {
        console.error('创建聊天会话失败:', error);
        res.status(500).json({ 
            success: false, 
            error: '创建聊天会话失败',
            details: error.message 
        });
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

// ========== 🔥 修复：发送消息API ==========
app.post('/api/chat/messages', async (req, res) => {
    try {
        const { sessionId, content, senderType, senderId, senderName } = req.body;
        console.log('💭 发送消息请求:', { 
            sessionId, 
            contentLength: content?.length,
            senderType,
            senderId,
            senderName
        });
        
        // 验证必填字段
        if (!sessionId) {
            console.log('❌ 缺少sessionId');
            return res.status(400).json({ 
                success: false, 
                error: '会话ID是必填项' 
            });
        }
        
        if (!content || content.trim() === '') {
            console.log('❌ 内容为空');
            return res.status(400).json({ 
                success: false, 
                error: '消息内容不能为空' 
            });
        }
        
        if (!senderType || !['user', 'support'].includes(senderType)) {
            console.log('❌ 无效的发送者类型:', senderType);
            return res.status(400).json({ 
                success: false, 
                error: '发送者类型必须是user或support' 
            });
        }
        
        const data = await readData();
        
        // 检查会话是否存在
        const session = data.chatSessions.find(s => s.id == sessionId);
        console.log('🔍 查找会话结果:', { 
            sessionId, 
            found: !!session,
            totalSessions: data.chatSessions.length 
        });
        
        if (!session) {
            console.log('❌ 聊天会话不存在:', sessionId);
            return res.status(404).json({ 
                success: false, 
                error: '聊天会话不存在',
                suggestion: '请先创建聊天会话 (/api/chat/sessions)'
            });
        }
        
        // 创建消息ID
        const messageId = Date.now();
        
        const message = {
            id: messageId,
            chatSessionId: Number(sessionId),
            content: content.trim(),
            senderType, // 'user' 或 'support'
            senderId: senderId || null,
            senderName: senderName || (senderType === 'user' ? session.userName : '客服'),
            read: false,
            createdAt: new Date().toISOString()
        };
        
        console.log('📝 创建消息对象:', {
            messageId,
            sessionId,
            senderType,
            contentPreview: content.length > 30 ? content.substring(0, 30) + '...' : content
        });
        
        // 更新会话的最后消息
        session.lastMessage = content.length > 50 ? content.substring(0, 50) + '...' : content;
        session.lastMessageTime = new Date().toISOString();
        session.updatedAt = new Date().toISOString();
        
        // 如果是用户发送，增加未读计数
        if (senderType === 'user') {
            session.unreadCount = (session.unreadCount || 0) + 1;
            console.log(`📈 用户消息，未读计数: ${session.unreadCount}`);
        } else if (senderType === 'support') {
            // 客服回复时重置未读计数
            session.unreadCount = 0;
            console.log('✅ 客服回复，重置未读计数');
        }
        
        // 确保chatMessages数组存在
        if (!data.chatMessages) {
            data.chatMessages = [];
        }
        
        // 添加消息
        data.chatMessages.push(message);
        
        // 保存数据
        const saveResult = await saveData(data);
        
        if (!saveResult) {
            throw new Error('保存数据失败');
        }
        
        console.log(`✅ 消息发送成功: 会话 ${sessionId}, 消息ID ${messageId}, 来自 ${senderType}`);
        console.log(`📊 当前总消息数: ${data.chatMessages.length}`);
        
        res.json({
            success: true,
            data: message,
            session: {
                id: session.id,
                userName: session.userName,
                unreadCount: session.unreadCount,
                lastMessageTime: session.lastMessageTime
            },
            message: '消息发送成功'
        });
    } catch (error) {
        console.error('❌ 发送消息失败:', error);
        console.error('错误详情:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: '发送消息失败',
            details: error.message 
        });
    }
});

// 获取会话消息
app.get('/api/chat/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        console.log('📨 获取会话消息:', sessionId);
        
        const data = await readData();
        
        // 确保chatMessages数组存在
        const chatMessages = data.chatMessages || [];
        
        const messages = chatMessages
            .filter(msg => msg.chatSessionId == sessionId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // 按时间升序
            .slice(parseInt(offset), parseInt(offset) + parseInt(limit));
        
        console.log(`📊 找到 ${messages.length} 条消息 (会话 ${sessionId})`);
        
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

// ========== 🔥 客服账号管理API ==========

// 1. 获取所有客服账号
app.get('/api/support/accounts', async (req, res) => {
    try {
        console.log('📋 获取客服账号列表');
        
        const data = await readData();
        
        // 筛选客服账号（包括管理员，因为管理员也可以当客服）
        const supportAccounts = data.users
            .filter(user => user.isSupport === true || user.isAdmin === true)
            .map(user => ({
                id: user.id,
                username: user.username,
                displayName: user.displayName || user.username,
                isAdmin: user.isAdmin || false,
                isSupport: user.isSupport || false,
                canViewOrders: user.canViewOrders !== undefined ? user.canViewOrders : true,
                canChat: user.canChat !== undefined ? user.canChat : true,
                online: user.online || false,
                status: user.status || 'active',
                createdAt: user.createdAt,
                lastActive: user.lastActive
            }));
        
        res.json({
            success: true,
            data: supportAccounts,
            total: supportAccounts.length,
            message: '客服账号列表获取成功'
        });
    } catch (error) {
        console.error('获取客服账号失败:', error);
        res.status(500).json({ success: false, error: '获取客服账号失败' });
    }
});

// 2. 添加客服账号
app.post('/api/support/accounts', async (req, res) => {
    try {
        const { 
            username, 
            password, 
            displayName, 
            canViewOrders = true, 
            canChat = true 
        } = req.body;
        
        console.log('👤 添加客服账号:', { username, displayName });
        
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
        
        const newSupport = {
            id: Date.now(),
            username,
            password,
            displayName: displayName || username,
            isAdmin: false,
            isSupport: true,
            canViewOrders,
            canChat,
            online: false,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
        
        data.users.push(newSupport);
        await saveData(data);
        
        console.log(`✅ 客服账号添加成功: ${username}`);
        
        // 不返回密码的安全信息
        const safeSupport = {
            id: newSupport.id,
            username: newSupport.username,
            displayName: newSupport.displayName,
            isSupport: newSupport.isSupport,
            canViewOrders: newSupport.canViewOrders,
            canChat: newSupport.canChat,
            online: newSupport.online,
            createdAt: newSupport.createdAt
        };
        
        res.json({
            success: true,
            data: safeSupport,
            message: '客服账号添加成功'
        });
    } catch (error) {
        console.error('添加客服账号失败:', error);
        res.status(500).json({ success: false, error: '添加客服账号失败' });
    }
});

// 3. 更新客服账号信息
app.put('/api/support/accounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            displayName, 
            password, 
            canViewOrders, 
            canChat,
            status 
        } = req.body;
        
        console.log('✏️ 更新客服账号:', { id, displayName });
        
        const data = await readData();
        const user = data.users.find(u => u.id == id);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: '客服账号不存在' 
            });
        }
        
        // 只允许更新客服账号
        if (!user.isSupport && !user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                error: '只能更新客服或管理员账号' 
            });
        }
        
        // 更新信息
        if (displayName !== undefined) user.displayName = displayName;
        if (password !== undefined) {
            if (password.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    error: '密码长度至少6位' 
                });
            }
            user.password = password;
        }
        if (canViewOrders !== undefined) user.canViewOrders = canViewOrders;
        if (canChat !== undefined) user.canChat = canChat;
        if (status !== undefined) user.status = status;
        
        user.lastActive = new Date().toISOString();
        await saveData(data);
        
        console.log(`✅ 客服账号更新成功: ${user.username}`);
        
        const safeUser = {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            isSupport: user.isSupport,
            canViewOrders: user.canViewOrders,
            canChat: user.canChat,
            status: user.status,
            online: user.online,
            lastActive: user.lastActive
        };
        
        res.json({
            success: true,
            data: safeUser,
            message: '客服账号更新成功'
        });
    } catch (error) {
        console.error('更新客服账号失败:', error);
        res.status(500).json({ success: false, error: '更新客服账号失败' });
    }
});

// 4. 删除客服账号
app.delete('/api/support/accounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('🗑️ 删除客服账号:', id);
        
        const data = await readData();
        const userId = Number(id);
        
        // 不能删除自己
        const currentUser = data.users.find(u => u.id === userId);
        if (currentUser && currentUser.username === 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: '不能删除管理员账号' 
            });
        }
        
        const initialLength = data.users.length;
        data.users = data.users.filter(u => u.id !== userId);
        
        if (data.users.length < initialLength) {
            await saveData(data);
            console.log(`✅ 客服账号删除成功: ID ${id}`);
            res.json({ 
                success: true, 
                message: '客服账号删除成功',
                deletedId: userId
            });
        } else {
            console.log(`❌ 客服账号不存在: ID ${id}`);
            res.status(404).json({ 
                success: false, 
                error: '客服账号不存在' 
            });
        }
    } catch (error) {
        console.error('删除客服账号失败:', error);
        res.status(500).json({ success: false, error: '删除客服账号失败' });
    }
});

// 5. 更新客服在线状态
app.post('/api/support/accounts/:id/online', async (req, res) => {
    try {
        const { id } = req.params;
        const { online } = req.body;
        console.log(`📱 更新客服在线状态: ID ${id}, 在线: ${online}`);
        
        if (online === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: '在线状态是必填项' 
            });
        }
        
        const data = await readData();
        const user = data.users.find(u => u.id == id);
        
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
            console.log(`❌ 客服不存在: ID ${id}`);
            res.status(404).json({ success: false, error: '客服不存在' });
        }
    } catch (error) {
        console.error('更新客服在线状态失败:', error);
        res.status(500).json({ success: false, error: '更新客服在线状态失败' });
    }
});

// 6. 获取客服在线状态
app.get('/api/support/status', async (req, res) => {
    try {
        const data = await readData();
        
        // 获取所有在线客服
        const onlineSupport = data.users
            .filter(user => (user.isSupport || user.isAdmin) && user.online === true)
            .map(user => ({
                id: user.id,
                username: user.username,
                displayName: user.displayName || user.username,
                online: user.online || false,
                lastActive: user.lastActive || user.createdAt,
                canChat: user.canChat
            }));
        
        const settings = data.settings || {};
        
        res.json({
            success: true,
            data: {
                supportOnline: settings.supportOnline !== false,
                onlineCount: onlineSupport.length,
                supportList: onlineSupport,
                workingHours: settings.supportWorkingHours || '9:00-22:00',
                enableService: settings.enableService !== false,
                totalSupport: data.users.filter(u => u.isSupport || u.isAdmin).length
            },
            message: '客服状态获取成功'
        });
    } catch (error) {
        console.error('获取客服状态失败:', error);
        res.status(500).json({ success: false, error: '获取客服状态失败' });
    }
});

// ========== 其他API ==========

// 获取系统设置
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

// 更新系统设置
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

// 系统状态
app.get('/api/status', async (req, res) => {
    try {
        const data = await readData();
        
        // 统计在线客服
        const onlineSupport = data.users.filter(user => 
            (user.isSupport || user.isAdmin) && user.online === true
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
                storage: 'data.json'
            },
            message: '系统运行正常'
        });
    } catch (error) {
        console.error('获取状态失败:', error);
        res.status(500).json({ success: false, error: '获取状态失败' });
    }
});

// 首页
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
                .account-info { background: #e8f5e9; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
                .debug-info { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎮 9927俱乐部后台系统</h1>
                
                <div class="status">
                    ✅ 服务器运行中 | 端口: ${PORT} | 聊天系统: 已启用 | 存储: data.json
                </div>
                
                <div class="account-info">
                    <strong>🟢 测试账号:</strong><br>
                    • 管理员: admin / admin123<br>
                    • 客服1: support1 / support123<br>
                    • 客服2: support2 / support456<br>
                    <span style="font-size: 12px; color: #666;">（客服账号用于聊天和订单管理）</span>
                </div>
                
                <div class="section">
                    <h2>🔍 调试端点</h2>
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
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <a href="/data.json" target="_blank" class="url">/data.json</a>
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">查看数据文件</div>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>💬 聊天系统API</h2>
                    <div style="background: #f0f2f5; padding: 15px; border-radius: 8px;">
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/support/login</span> - 客服登录</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/chat/sessions</span> - 创建聊天会话</div>
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/chat/sessions</span> - 获取会话列表</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/chat/messages</span> - 发送消息</div>
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/chat/sessions/:id/messages</span> - 获取消息</div>
                        <div style="margin-bottom: 8px;"><span class="method put">PUT</span> <span class="url">/api/chat/sessions/:id/status</span> - 更新会话状态</div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>👥 客服账号管理API</h2>
                    <div style="background: #f0f2f5; padding: 15px; border-radius: 8px;">
                        <div style="margin-bottom: 8px;"><span class="method get">GET</span> <span class="url">/api/support/accounts</span> - 获取客服账号</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/support/accounts</span> - 添加客服账号</div>
                        <div style="margin-bottom: 8px;"><span class="method put">PUT</span> <span class="url">/api/support/accounts/:id</span> - 更新客服账号</div>
                        <div style="margin-bottom: 8px;"><span class="method delete">DELETE</span> <span class="url">/api/support/accounts/:id</span> - 删除客服账号</div>
                        <div style="margin-bottom: 8px;"><span class="method post">POST</span> <span class="url">/api/support/accounts/:id/online</span> - 更新在线状态</div>
                    </div>
                </div>
                
                <div class="debug-info">
                    <strong>🐛 消息发送调试步骤:</strong><br>
                    1. 先创建会话: POST /api/chat/sessions<br>
                    2. 发送消息: POST /api/chat/messages<br>
                    3. 检查data.json中是否有消息记录<br>
                    4. 查看控制台日志获取错误信息
                </div>
                
                <div class="note">
                    <strong>💡 使用说明:</strong><br>
                    1. 所有数据保存在 <strong>data.json</strong> 文件中<br>
                    2. 客服登录: <strong>/api/support/login</strong><br>
                    3. 创建会话后才能发送消息<br>
                    4. 支持多客服同时在线<br>
                    5. 实时数据自动保存<br>
                    6. 消息发送失败时查看控制台日志
                </div>
                
                <div style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
                    ©2025 9927俱乐部 | 版本: 完整修复版 | 修复消息发送功能
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
            'POST /api/chat/messages',
            'GET  /api/chat/sessions/:id/messages',
            'GET  /api/support/accounts',
            'POST /api/support/accounts',
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
        
        app.listen(PORT, () => {
            console.log(`
            ╔════════════════════════════════════════╗
            ║        🚀 9927俱乐部后台系统启动        ║
            ╠════════════════════════════════════════╣
            ║  📍 本地访问: http://localhost:${PORT}      ║
            ║  🔗 API基础: http://localhost:${PORT}/api   ║
            ║  📁 数据文件: data.json                   ║
            ╠════════════════════════════════════════╣
            ║  💬 聊天系统: 已启用                     ║
            ║  🐛 调试端点:                           ║
            ║  • http://localhost:${PORT}/api/status     ║
            ║  • http://localhost:${PORT}/api/test       ║
            ║  • http://localhost:${PORT}/data.json      ║
            ╠════════════════════════════════════════╣
            ║  🔑 测试账号:                           ║
            ║  • 管理员: admin / admin123            ║
            ║  • 客服1: support1 / support123        ║
            ║  • 客服2: support2 / support456        ║
            ╠════════════════════════════════════════╣
            ║  🔧 消息发送修复:                       ║
            ║  • 验证会话存在性                      ║
            ║  • 详细的错误日志                      ║
            ║  • 自动创建data.json                   ║
            ║  • 验证发送者类型                      ║
            ╚════════════════════════════════════════╝
            
            ✅ 消息发送功能已修复：
            • 必须先创建会话 (/api/chat/sessions)
            • 发送者类型必须是 "user" 或 "support"
            • 详细的控制台日志
            • 自动保存到 data.json
            
            🐛 调试方法：
            1. 检查会话是否存在
            2. 查看控制台日志
            3. 检查 data.json 文件
            4. 使用测试端点验证
            `);
        });
    } catch (error) {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    }
}

startServer().catch(console.error);
