require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// 环境变量配置（合并所有需要的环境变量）
// =================================================================

// 所有需要的环境变量（合并两个代码）
const requiredEnv = [
    'FIREBASE_API_KEY',      // 两个代码都需要
    'DATABASE_URL',          // 第一个代码需要
    'CPM_BASE_URL',          // 第二个代码需要
    'ACCESS_KEY'             // 第二个代码需要
];

const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error('❌ 缺少必要环境变量：', missingEnv.join(', '));
    console.log('请确保 .env 文件中包含以下变量:');
    console.log('FIREBASE_API_KEY=你的Firebase API密钥');
    console.log('DATABASE_URL=你的PostgreSQL连接字符串');
    console.log('CPM_BASE_URL=你的CPM服务基础URL');
    console.log('ACCESS_KEY=你的访问密钥');
    process.exit(1);
}

// 环境变量赋值
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const CPM_BASE_URL = process.env.CPM_BASE_URL;
const ACCESS_KEY = process.env.ACCESS_KEY;

// =================================================================
// 中间件配置
// =================================================================

// 详细的CORS配置（使用第二个代码的配置）
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-access-key'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// 请求日志中间件（从第二个代码）
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// =================================================================
// PostgreSQL 连接（保持第一个代码的配置）
// =================================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// =================================================================
// 辅助函数（从第二个代码）
// =================================================================

// 移除颜色代码的函数
function removeColorCodes(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\[[0-9A-F]{6}\]/g, '');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 通用请求函数
async function sendCPMRequest(url, payload, headers, params = {}) {
    try {
        const fullUrl = url + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
        
        const response = await axios({
            method: 'post',
            url: fullUrl,
            data: payload,
            headers: headers,
            timeout: 60000,
            validateStatus: function (status) {
                return status >= 200 && status < 600;
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Request error:', error.message);
        return null;
    }
}

// 生成随机ID
function generateRandomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// =================================================================
// 超级管理员密钥（使用第一个代码的简单密钥）
// =================================================================

const SUPER_ADMIN_KEY = 'Liew1201@';

// =================================================================
// 数据库修复函数（从第一个代码）
// =================================================================

async function fixMissingColumns() {
    try {
        console.log('🔍 检查数据库表结构...');
        
        const columnsToCheck = [
            { name: 'is_password_card', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'is_telegram_generated', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'kuaishou_code', type: 'VARCHAR(100) DEFAULT NULL' },
            { name: 'applied_via', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'original_key', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'copied_times', type: 'INTEGER DEFAULT 0' }
        ];
        
        for (const column of columnsToCheck) {
            try {
                const checkResult = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='access_keys' AND column_name='${column.name}'
                `);
                
                if (checkResult.rows.length === 0) {
                    console.log(`   ➕ 添加缺失字段: ${column.name}`);
                    await pool.query(`
                        ALTER TABLE access_keys 
                        ADD COLUMN ${column.name} ${column.type}
                    `);
                    console.log(`   ✅ ${column.name} 字段已添加`);
                }
            } catch (error) {
                console.error(`   ❌ 检查/添加 ${column.name} 字段失败:`, error.message);
            }
        }
        
        console.log('✅ 数据库表结构检查完成');
    } catch (error) {
        console.error('❌ 数据库表结构修复失败:', error);
    }
}

// =================================================================
// 数据库初始化（保持第一个代码）
// =================================================================

async function initDatabase() {
    try {
        console.log('🔄 初始化数据库表...');
        
        // 创建访问密钥表（增强版，包含所有字段）
        await pool.query(`
            CREATE TABLE IF NOT EXISTS access_keys (
                id SERIAL PRIMARY KEY,
                key VARCHAR(50) UNIQUE NOT NULL,
                remark TEXT,
                expiry_time TIMESTAMP NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                is_admin BOOLEAN DEFAULT FALSE,
                is_super_admin BOOLEAN DEFAULT FALSE,
                is_test_card BOOLEAN DEFAULT FALSE,
                is_password_card BOOLEAN DEFAULT FALSE,
                duration_hours INTEGER DEFAULT 24,
                max_bind INTEGER DEFAULT 3,
                bound_emails TEXT[] DEFAULT '{}',
                added_by VARCHAR(100),
                added_by_name VARCHAR(100),
                added_by_email VARCHAR(100),
                card_type VARCHAR(50) DEFAULT 'FULL',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                activation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                bound_accounts JSONB DEFAULT '[]',
                telegram_user JSONB DEFAULT NULL,
                application_info JSONB DEFAULT NULL
            )
        `);
        
        console.log('✅ 基础表结构创建完成');
        
        // 修复可能缺失的列
        await fixMissingColumns();
        
        // 创建操作日志表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS operation_logs (
                id SERIAL PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                user_email VARCHAR(100) NOT NULL,
                key_used VARCHAR(50),
                details TEXT,
                log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建管理员操作记录表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_operations (
                id SERIAL PRIMARY KEY,
                admin_email VARCHAR(100) NOT NULL,
                admin_name VARCHAR(100) NOT NULL,
                operation_type VARCHAR(50) NOT NULL,
                target_key VARCHAR(50),
                target_admin VARCHAR(100),
                details TEXT,
                ip_address VARCHAR(50),
                user_agent TEXT,
                operation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ 所有数据库表初始化完成');
        
        // 检查并创建超级管理员密钥
        const superAdminCheck = await pool.query(
            'SELECT * FROM access_keys WHERE key = $1', 
            [SUPER_ADMIN_KEY]
        );
        
        if (superAdminCheck.rows.length === 0) {
            const expiryTime = new Date();
            expiryTime.setFullYear(expiryTime.getFullYear() + 10);
            
            await pool.query(`
                INSERT INTO access_keys (
                    key, remark, expiry_time, status, is_admin, is_super_admin,
                    is_test_card, is_password_card, duration_hours, max_bind,
                    added_by, added_by_name, added_by_email, card_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [
                SUPER_ADMIN_KEY,
                '系统超级管理员密钥',
                expiryTime.toISOString(),
                'active',
                true,
                true,
                false,
                false,
                24 * 365 * 10,
                999,
                'system',
                '系统管理员',
                'admin@mknls.com',
                'DIAMOND'
            ]);
            
            console.log('✅ 超级管理员密钥已创建');
        }

    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    }
}

// =================================================================
// 数据库操作函数（保持第一个代码）
// =================================================================

async function getAllAccessKeys() {
    const result = await pool.query('SELECT * FROM access_keys ORDER BY created_at DESC');
    return result.rows;
}

async function getAccessKey(key) {
    const result = await pool.query('SELECT * FROM access_keys WHERE key = $1', [key]);
    const row = result.rows[0];
    
    if (row) {
        // 确保新增字段有默认值
        row.is_password_card = row.is_password_card || false;
        row.is_telegram_generated = row.is_telegram_generated || false;
        row.kuaishou_code = row.kuaishou_code || null;
        row.applied_via = row.applied_via || null;
        row.original_key = row.original_key || null;
        row.copied_times = row.copied_times || 0;
    }
    
    return row;
}

async function createAccessKey(keyData) {
    const fullKeyData = {
        key: keyData.key,
        remark: keyData.remark || '无',
        expiryTime: keyData.expiryTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: keyData.status || 'active',
        isAdmin: keyData.isAdmin || false,
        isSuperAdmin: keyData.isSuperAdmin || false,
        isTestCard: keyData.isTestCard || false,
        isPasswordCard: keyData.isPasswordCard || false,
        durationHours: keyData.durationHours || 24,
        maxBind: keyData.maxBind || 3,
        boundEmails: keyData.boundEmails || [],
        addedBy: keyData.addedBy || 'unknown',
        addedByName: keyData.addedByName || '未知',
        addedByEmail: keyData.addedByEmail || 'unknown@mknls.com',
        cardType: keyData.cardType || 'FULL',
        boundAccounts: keyData.boundAccounts || [],
        activationTime: keyData.activationTime || new Date().toISOString(),
        originalKey: keyData.originalKey || null,
        copiedTimes: keyData.copiedTimes || 0,
        isTelegramGenerated: keyData.isTelegramGenerated || false,
        kuaishouCode: keyData.kuaishouCode || null,
        appliedVia: keyData.appliedVia || null
    };
    
    const fields = [
        'key', 'remark', 'expiry_time', 'status', 'is_admin', 'is_super_admin',
        'is_test_card', 'is_password_card', 'duration_hours', 'max_bind',
        'added_by', 'added_by_name', 'added_by_email', 'card_type',
        'bound_emails', 'bound_accounts', 'activation_time',
        'original_key', 'copied_times', 'is_telegram_generated',
        'kuaishou_code', 'applied_via', 'created_at'
    ];
    
    const values = [
        fullKeyData.key,
        fullKeyData.remark,
        fullKeyData.expiryTime,
        fullKeyData.status,
        fullKeyData.isAdmin,
        fullKeyData.isSuperAdmin,
        fullKeyData.isTestCard,
        fullKeyData.isPasswordCard,
        fullKeyData.durationHours,
        fullKeyData.maxBind,
        fullKeyData.addedBy,
        fullKeyData.addedByName,
        fullKeyData.addedByEmail,
        fullKeyData.cardType,
        fullKeyData.boundEmails,
        JSON.stringify(fullKeyData.boundAccounts),
        fullKeyData.activationTime,
        fullKeyData.originalKey,
        fullKeyData.copiedTimes,
        fullKeyData.isTelegramGenerated,
        fullKeyData.kuaishouCode,
        fullKeyData.appliedVia,
        new Date().toISOString()
    ];
    
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const query = `
        INSERT INTO access_keys (${fields.join(', ')})
        VALUES (${placeholders})
        RETURNING *
    `;
    
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function updateAccessKey(key, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [field, value] of Object.entries(updates)) {
        let dbField;
        let dbValue = value;
        
        switch (field) {
            case 'boundAccounts': dbField = 'bound_accounts'; dbValue = JSON.stringify(value); break;
            case 'boundEmails': dbField = 'bound_emails'; dbValue = JSON.stringify(value); break;
            case 'expiryTime': dbField = 'expiry_time'; break;
            case 'durationHours': dbField = 'duration_hours'; break;
            case 'maxBind': dbField = 'max_bind'; break;
            case 'isTestCard': dbField = 'is_test_card'; break;
            case 'isPasswordCard': dbField = 'is_password_card'; break;
            case 'cardType': dbField = 'card_type'; break;
            case 'isAdmin': dbField = 'is_admin'; break;
            case 'isSuperAdmin': dbField = 'is_super_admin'; break;
            case 'activationTime': dbField = 'activation_time'; break;
            case 'originalKey': dbField = 'original_key'; break;
            case 'copiedTimes': dbField = 'copied_times'; break;
            case 'isTelegramGenerated': dbField = 'is_telegram_generated'; break;
            case 'kuaishouCode': dbField = 'kuaishou_code'; break;
            case 'appliedVia': dbField = 'applied_via'; break;
            default: dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        }
        
        fields.push(`${dbField} = $${paramCount}`);
        values.push(dbValue);
        paramCount++;
    }

    values.push(key);
    
    const query = `UPDATE access_keys SET ${fields.join(', ')} WHERE key = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function deleteAccessKey(key) {
    const result = await pool.query('DELETE FROM access_keys WHERE key = $1 RETURNING *', [key]);
    return result.rows[0];
}

async function addOperationLog(action, user, key, details = '') {
    try {
        const query = `
            INSERT INTO operation_logs (action, user_email, key_used, details)
            VALUES ($1, $2, $3, $4)
        `;
        
        await pool.query(query, [action, user, key, details]);
    } catch (error) {
        console.error('记录操作日志失败:', error);
    }
}

async function addAdminOperation(operation) {
    try {
        const query = `
            INSERT INTO admin_operations (
                admin_email, admin_name, operation_type, target_key, target_admin, 
                details, ip_address, user_agent
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        
        const values = [
            operation.adminEmail || 'unknown',
            operation.adminName || '未知管理员',
            operation.operationType || 'unknown',
            operation.targetKey || null,
            operation.targetAdmin || null,
            operation.details || '',
            operation.ipAddress || 'unknown',
            operation.userAgent || 'unknown'
        ];
        
        await pool.query(query, values);
    } catch (error) {
        console.error('记录管理员操作失败:', error);
    }
}

function formatKeyData(keyData) {
    return {
        key: keyData.key,
        isActivated: keyData.status === 'active',
        expiryTime: keyData.expiry_time,
        boundEmails: keyData.bound_emails || [],
        maxBind: keyData.max_bind || 3,
        isTestCard: keyData.is_test_card || false,
        isPasswordCard: keyData.is_password_card || false,
        remark: keyData.remark || '无',
        addedByName: keyData.added_by_name || '未知',
        telegramUser: keyData.telegram_user,
        applicationInfo: keyData.application_info,
        boundAccounts: keyData.bound_accounts || [],
        durationHours: keyData.duration_hours,
        cardType: keyData.card_type,
        isAdmin: keyData.is_admin,
        isSuperAdmin: keyData.is_super_admin,
        activationTime: keyData.activation_time,
        addedBy: keyData.added_by,
        originalKey: keyData.original_key || null,
        copiedTimes: keyData.copied_times || 0,
        isTelegramGenerated: keyData.is_telegram_generated || false,
        kuaishouCode: keyData.kuaishou_code || null,
        appliedVia: keyData.applied_via || null,
        createdAt: keyData.created_at,
        status: keyData.status
    };
}

function generateAccessKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 15; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// =================================================================
// 密钥验证中间件（从第二个代码）
// =================================================================

const verifyAccessKey = (req, res, next) => {
    // 跳过某些公共端点
    const publicPaths = [
        '/api/verify-key', 
        '/health', 
        '/api/test', 
        '/',
        '/api/check-key',        // 第一个代码的检查秘钥接口
        '/api/king-rank'         // 第一个代码的刷等级接口
    ];
    
    if (publicPaths.includes(req.path)) {
        return next();
    }
    
    // 从请求头获取访问密钥
    const clientKey = req.headers['x-access-key'];
    
    if (!clientKey) {
        return res.status(401).json({
            ok: false,
            error: 401,
            message: "访问被拒绝：缺少访问密钥"
        });
    }
    
    if (clientKey !== ACCESS_KEY) {
        return res.status(403).json({
            ok: false,
            error: 403,
            message: "访问被拒绝：无效的访问密钥"
        });
    }
    
    next();
};

// =================================================================
// API 接口（合并两个代码的功能）
// =================================================================

// ========== 第一个代码的API接口 ==========

// 1. 检查秘钥接口
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        console.log('检查秘钥请求:', { key: key ? '有秘钥' : '无秘钥', email });

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查是否是超级管理员秘钥
        if (key === SUPER_ADMIN_KEY) {
            await addOperationLog('super_admin_login', 'super_admin', key, '超级管理员登录');

            return res.json({
                success: true,
                message: "超级管理员登录成功",
                isAdmin: true,
                isSuperAdmin: true,
                needsChoice: true,
                isTestCard: false,
                isPasswordCard: false
            });
        }

        // 检查普通秘钥
        const keyData = await getAccessKey(key);
        
        if (!keyData) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥不存在');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥不存在"
            });
        }
        
        if (keyData.status !== 'active') {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥未激活');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥未激活"
            });
        }
        
        if (new Date(keyData.expiry_time) < new Date()) {
            await updateAccessKey(key, { status: 'expired' });
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥已过期');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥已过期"
            });
        }

        // 检查绑定状态
        const boundEmails = keyData.bound_emails || [];
        const isEmailBound = email && boundEmails.includes(email);
        const bindCount = boundEmails.length;
        const maxBind = keyData.max_bind || 3;
        const remainingBinds = Math.max(0, maxBind - bindCount);

        console.log('秘钥状态:', {
            key,
            isAdmin: keyData.is_admin,
            isTestCard: keyData.is_test_card,
            isPasswordCard: keyData.is_password_card,
            boundCount: bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            expiry: keyData.expiry_time
        });

        // 如果是管理员秘钥
        if (keyData.is_admin) {
            await addOperationLog('admin_login', keyData.added_by || 'admin', key, '管理员登录');

            return res.json({
                success: true,
                message: "管理员登录成功",
                isAdmin: true,
                isSuperAdmin: keyData.is_super_admin || false,
                needsChoice: true,
                isTestCard: keyData.is_test_card || false,
                isPasswordCard: keyData.is_password_card || false
            });
        }

        // 检查是否测试卡或改密卡
        const isTestCard = keyData.is_test_card || false;
        const isPasswordCard = keyData.is_password_card || false;

        // 普通用户秘钥 - 检查绑定限制
        if (remainingBinds <= 0 && !isEmailBound) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 绑定已满');
            return res.status(400).json({
                success: false,
                message: "该秘钥绑定数量已达上限",
                bindCount,
                maxBind,
                remainingBinds: 0,
                isEmailBound: false,
                isTestCard,
                isPasswordCard
            });
        }

        await addOperationLog('key_verification', email || 'unknown', key, '秘钥验证成功');

        res.json({
            success: true,
            message: "秘钥验证成功",
            expiryTime: keyData.expiry_time,
            isAdmin: false,
            isTestCard: isTestCard,
            isPasswordCard: isPasswordCard,
            bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            durationHours: keyData.duration_hours,
            cardType: keyData.card_type
        });

    } catch (error) {
        console.error('检查秘钥错误:', error);
        await addOperationLog('key_verification', 'unknown', 'unknown', '验证失败: 服务器错误');
        res.status(400).json({
            success: false,
            message: "验证失败: 服务器错误"
        });
    }
});

// 2. 登录接口（保持第一个代码的版本）
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, key } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        const firebaseResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            }
        );

        const firebaseData = await firebaseResponse.json();

        if (!firebaseResponse.ok) {
            const errorMsg = firebaseData.error?.message || '登录失败';
            await addOperationLog('user_login', email, key || 'N/A', `登录失败: ${errorMsg}`);
            
            return res.status(400).json({
                success: false,
                message: errorMsg
            });
        }

        // 如果提供了有效的秘钥，绑定邮箱到秘钥
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData) {
                const boundEmails = keyData.bound_emails || [];
                if (!boundEmails.includes(email)) {
                    // 添加到绑定邮箱列表
                    const newBoundEmails = [...boundEmails, email];
                    
                    // 添加到绑定账号列表
                    const boundAccounts = keyData.bound_accounts || [];
                    boundAccounts.push({
                        email: email,
                        password: Buffer.from(password).toString('base64'),
                        bindTime: new Date().toISOString(),
                        lastLogin: new Date().toISOString()
                    });
                    
                    await updateAccessKey(key, {
                        bound_emails: newBoundEmails,
                        bound_accounts: boundAccounts
                    });
                    
                    await addOperationLog('email_binding', email, key, `邮箱绑定到秘钥成功`);
                } else {
                    // 更新最后登录时间
                    const boundAccounts = keyData.bound_accounts || [];
                    const accountIndex = boundAccounts.findIndex(acc => acc.email === email);
                    if (accountIndex !== -1) {
                        boundAccounts[accountIndex].lastLogin = new Date().toISOString();
                        await updateAccessKey(key, {
                            bound_accounts: boundAccounts
                        });
                    }
                }
            }
        }

        await addOperationLog('user_login', email, key || 'N/A', '用户登录成功');

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                role: 'user',
                expiresIn: firebaseData.expiresIn
            },
            message: "登录成功"
        });

    } catch (error) {
        console.error('登录接口错误:', error);
        await addOperationLog('user_login', 'unknown', 'N/A', '登录接口错误');
        res.status(400).json({
            success: false,
            message: "登录失败"
        });
    }
});

// 3. 刷King等级接口
app.post('/api/king-rank', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const { key } = req.body;  // 从前端传递秘钥

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "请提供有效的身份令牌"
            });
        }

        const idToken = authHeader.split(' ')[1];

        // 检查是否是改密卡
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.is_password_card) {
                return res.status(403).json({
                    success: false,
                    message: "改密卡不支持国王等级功能"
                });
            }
        }

        const ratingData = {
            "cars": 100000, "car_fix": 100000, "car_collided": 100000, "car_exchange": 100000,
            "car_trade": 100000, "car_wash": 100000, "slicer_cut": 100000, "drift_max": 100000,
            "drift": 100000, "cargo": 100000, "delivery": 100000, "taxi": 100000, "levels": 100000,
            "gifts": 100000, "fuel": 100000, "offroad": 100000, "speed_banner": 100000,
            "reactions": 100000, "police": 100000, "run": 100000, "real_estate": 100000,
            "t_distance": 100000, "treasure": 100000, "block_post": 100000, "push_ups": 100000,
            "burnt_tire": 100000, "passanger_distance": 100000, "time": 10000000000, "race_win": 3000
        };

        const rankResponse = await fetch(process.env.RANK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
                'User-Agent': 'okhttp/3.12.13'
            },
            body: JSON.stringify({
                data: JSON.stringify({ RatingData: ratingData })
            })
        });

        if (!rankResponse.ok) {
            await addOperationLog('set_king_rank', 'unknown', key || 'N/A', '刷King等级失败');
            return res.status(400).json({
                success: false,
                message: "刷King等级失败"
            });
        }

        await addOperationLog('set_king_rank', 'unknown', key || 'N/A', '刷King等级成功');

        res.json({
            success: true,
            message: "刷King等级成功"
        });

    } catch (error) {
        await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败');
        res.status(400).json({
            success: false,
            message: "刷King等级失败"
        });
    }
});

// 4. 修改邮箱接口
app.post('/api/change-email', async (req, res) => {
    try {
        const { idToken, newEmail, oldEmail, key } = req.body;

        if (!idToken || !newEmail) {
            return res.status(400).json({
                success: false,
                message: "请提供完整的参数"
            });
        }

        if (!/^[\w.-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(newEmail)) {
            return res.status(400).json({
                success: false,
                message: "请输入有效的邮箱格式"
            });
        }

        // 检查是否测试卡或改密卡
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData) {
                if (keyData.is_test_card) {
                    return res.status(403).json({
                        success: false,
                        message: "测试卡不支持修改邮箱功能"
                    });
                }
                if (keyData.is_password_card) {
                    return res.status(403).json({
                        success: false,
                        message: "改密卡不支持修改邮箱功能"
                    });
                }
            }
        }

        const firebaseResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${process.env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idToken,
                    email: newEmail,
                    returnSecureToken: true
                })
            }
        );

        const firebaseData = await firebaseResponse.json();

        if (!firebaseResponse.ok) {
            await addOperationLog('change_email', oldEmail || 'unknown', key || 'N/A', '修改邮箱失败');
            return res.status(400).json({
                success: false,
                message: "修改邮箱失败"
            });
        }

        // 更新秘钥绑定的邮箱信息
        if (key && oldEmail) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.bound_emails) {
                const emailIndex = keyData.bound_emails.indexOf(oldEmail);
                if (emailIndex !== -1) {
                    const newBoundEmails = [...keyData.bound_emails];
                    newBoundEmails[emailIndex] = newEmail;
                    
                    // 更新绑定账号信息
                    const boundAccounts = keyData.bound_accounts || [];
                    const accountIndex = boundAccounts.findIndex(acc => acc.email === oldEmail);
                    if (accountIndex !== -1) {
                        boundAccounts[accountIndex].email = newEmail;
                    }
                    
                    await updateAccessKey(key, {
                        bound_emails: newBoundEmails,
                        bound_accounts: boundAccounts
                    });
                }
            }
        }

        await addOperationLog('change_email', oldEmail || 'unknown', key || 'N/A', `修改邮箱成功：${oldEmail} -> ${newEmail}`);

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                idToken: firebaseData.idToken
            },
            message: "修改邮箱成功"
        });

    } catch (error) {
        await addOperationLog('change_email', 'unknown', 'N/A', '修改邮箱失败');
        res.status(400).json({
            success: false,
            message: "修改邮箱失败"
        });
    }
});

// 5. 修改密码接口
app.post('/api/change-password', async (req, res) => {
    try {
        const { idToken, newPassword, email, key } = req.body;

        if (!idToken || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "请提供完整的参数"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "密码长度不能少于6位"
            });
        }

        // 检查是否是测试卡
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.is_test_card) {
                return res.status(403).json({
                    success: false,
                    message: "测试卡不支持修改密码功能"
                });
            }
        }

        const firebaseResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${process.env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idToken,
                    password: newPassword,
                    returnSecureToken: true
                })
            }
        );

        const firebaseData = await firebaseResponse.json();

        if (!firebaseResponse.ok) {
            await addOperationLog('change_password', email || 'unknown', key || 'N/A', '修改密码失败');
            return res.status(400).json({
                success: false,
                message: "修改密码失败"
            });
        }

        // 更新秘钥绑定的密码信息
        if (key && email) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.bound_accounts) {
                const boundAccounts = keyData.bound_accounts || [];
                const accountIndex = boundAccounts.findIndex(acc => acc.email === email);
                if (accountIndex !== -1) {
                    boundAccounts[accountIndex].password = Buffer.from(newPassword).toString('base64');
                    await updateAccessKey(key, {
                        bound_accounts: boundAccounts
                    });
                }
            }
        }

        await addOperationLog('change_password', email || 'unknown', key || 'N/A', '修改密码成功');

        res.json({
            success: true,
            data: {
                idToken: firebaseData.idToken
            },
            message: "修改密码成功"
        });

    } catch (error) {
        await addOperationLog('change_password', 'unknown', 'N/A', '修改密码失败');
        res.status(400).json({
            success: false,
            message: "修改密码失败"
        });
    }
});

// 6. 管理员添加秘钥接口
app.post('/api/admin/keys', async (req, res) => {
    try {
        // 从查询参数获取管理员密钥，从body获取其他参数
        const adminKey = req.query.key;
        const { 
            durationHours = 24, 
            maxBind = 3, 
            remark = '', 
            isTestCard = false, 
            isPasswordCard = false 
        } = req.body;

        console.log('🔑 生成秘钥请求:', { 
            adminKey: adminKey ? adminKey.substring(0, 4) + '...' : '无密钥',
            durationHours,
            maxBind,
            remark,
            isTestCard,
            isPasswordCard
        });

        // 验证管理员密钥
        if (!adminKey) {
            return res.status(400).json({
                success: false,
                message: "错误: 需要提供管理员密钥"
            });
        }

        let isSuperAdmin = false;
        let adminInfo = null;

        // 检查是否是超级管理员
        if (adminKey === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY, 
                email: 'super_admin@mknls.com' 
            };
            console.log('✅ 验证: 超级管理员身份');
        } else {
            // 检查普通管理员
            const keyData = await getAccessKey(adminKey);
            if (!keyData) {
                return res.status(403).json({
                    success: false,
                    message: "错误: 管理员密钥不存在"
                });
            }
            
            if (keyData.status !== 'active') {
                return res.status(403).json({
                    success: false,
                    message: "错误: 管理员密钥未激活"
                });
            }
            
            if (!keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "错误: 非管理员密钥"
                });
            }
            
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
            console.log('✅ 验证: 普通管理员身份');
        }

        // 参数验证
        let actualDuration = parseInt(durationHours) || 24;
        let actualMaxBind = parseInt(maxBind) || 3;
        let actualCardType = 'FULL';
        let actualRemark = remark || '';

        // 确定卡类型
        if (isTestCard === true) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'TEST';
            actualRemark = actualRemark || '测试卡';
            console.log('📋 生成测试卡');
        } else if (isPasswordCard === true) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'PASSWORD';
            actualRemark = actualRemark || '改密卡';
            console.log('📋 生成改密卡');
        } else {
            // 全功能卡
            if (!isSuperAdmin) {
                return res.status(403).json({
                    success: false,
                    message: "错误: 普通管理员只能生成测试卡和改密卡"
                });
            }
            
            actualRemark = actualRemark || '全功能卡';
            
            // 根据时长设置卡类型
            if (actualDuration >= 24 * 90) {
                actualCardType = 'DIAMOND';
            } else if (actualDuration >= 24 * 30) {
                actualCardType = 'PLATINUM';
            } else if (actualDuration >= 24 * 7) {
                actualCardType = 'GOLD';
            } else if (actualDuration >= 24 * 3) {
                actualCardType = 'SILVER';
            } else {
                actualCardType = 'BRONZE';
            }
            console.log('📋 生成全功能卡:', actualCardType);
        }

        // 生成新秘钥
        const newKey = generateAccessKey();
        const now = new Date();
        const expiryTime = new Date(now);
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        console.log('🔑 生成秘钥信息:', {
            密钥: newKey,
            类型: actualCardType,
            时长: `${actualDuration}小时`,
            到期: expiryTime.toLocaleString(),
            绑定数: actualMaxBind
        });

        // 准备秘钥数据
        const keyData = {
            key: newKey,
            remark: actualRemark,
            expiryTime: expiryTime.toISOString(),
            status: 'active',
            isAdmin: false,
            isSuperAdmin: false,
            isTestCard: isTestCard || false,
            isPasswordCard: isPasswordCard || false,
            durationHours: actualDuration,
            maxBind: actualMaxBind,
            boundEmails: [],
            boundAccounts: [],
            addedBy: adminInfo.key,
            addedByName: adminInfo.name,
            addedByEmail: adminInfo.email,
            cardType: actualCardType,
            activationTime: now.toISOString()
        };

        // 保存到数据库
        const createdKey = await createAccessKey(keyData);
        
        if (!createdKey) {
            throw new Error('创建秘钥失败');
        }

        // 记录日志
        const cardName = isTestCard ? '测试卡' : (isPasswordCard ? '改密卡' : actualCardType + '卡');
        
        await addOperationLog('generate_key', adminInfo.name, newKey, 
               `生成${cardName}成功：${actualRemark}`);
        
        await addAdminOperation({
            adminEmail: adminInfo.email,
            adminName: adminInfo.name,
            operationType: 'generate_key',
            targetKey: newKey,
            details: `生成秘钥: ${newKey}, 类型: ${cardName}, 时长: ${actualDuration}小时, 绑定: ${actualMaxBind}个`
        });

        console.log('✅ 秘钥生成成功:', newKey);

        // 返回成功响应
        res.json({
            success: true,
            key: newKey,
            message: `${cardName}生成成功！`,
            cardInfo: {
                type: actualCardType,
                duration: actualDuration,
                maxBind: actualMaxBind,
                isTestCard: isTestCard,
                isPasswordCard: isPasswordCard,
                expiryTime: expiryTime.toISOString()
            }
        });

    } catch (error) {
        console.error('❌ 生成秘钥错误:', error);
        
        // 返回详细的错误信息
        res.status(400).json({
            success: false,
            message: `生成秘钥失败: ${error.message}`,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 7. 管理员获取分类秘钥列表
app.get('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        let isSuperAdmin = false;
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY,
                email: 'super_admin@mknls.com'
            };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        const allKeys = await getAllAccessKeys();
        const formattedKeys = allKeys.map(formatKeyData);
        
        const tgKeys = formattedKeys.filter(k => k.isTelegramGenerated);
        const superAdminKeys = formattedKeys.filter(k => k.isSuperAdmin && k.addedBy === SUPER_ADMIN_KEY);
        const normalAdminKeys = formattedKeys.filter(k => k.isAdmin && !k.isSuperAdmin && !k.isTelegramGenerated);
        
        const normalAdmins = {};
        normalAdminKeys.forEach(keyData => {
            const adminKey = keyData.addedBy;
            if (!normalAdmins[adminKey]) {
                normalAdmins[adminKey] = {
                    adminKey: adminKey,
                    adminName: keyData.addedByName || '未知管理员',
                    keys: []
                };
            }
            normalAdmins[adminKey].keys.push(keyData);
        });

        await addOperationLog('fetch_keys', adminInfo.name, key, '获取分类秘钥列表成功');

        res.json({
            success: true,
            keys: {
                telegram: tgKeys,
                superAdmin: superAdminKeys,
                normalAdmins: normalAdmins
            },
            adminInfo: {
                name: adminInfo.name,
                key: adminInfo.key,
                isSuperAdmin: isSuperAdmin
            }
        });

    } catch (error) {
        console.error('获取秘钥列表错误:', error);
        res.status(400).json({
            success: false,
            message: "验证失败: 服务器错误"
        });
    }
});

// 8. 管理员删除秘钥
app.delete('/api/admin/keys', async (req, res) => {
    try {
        const { key, keyToDelete } = req.query;

        if (!key || !keyToDelete) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            adminInfo = { name: '超级管理员', key: SUPER_ADMIN_KEY, email: 'super_admin@mknls.com' };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email
            };
        }

        const keyDataToDelete = await getAccessKey(keyToDelete);
        if (!keyDataToDelete) {
            return res.status(400).json({
                success: false,
                message: "要删除的秘钥不存在"
            });
        }

        // 检查删除权限（超级管理员可以删除任何秘钥，普通管理员只能删除自己生成的秘钥）
        if (key !== SUPER_ADMIN_KEY && keyDataToDelete.added_by !== adminInfo.key) {
            return res.status(403).json({
                success: false,
                message: "只能删除自己生成的秘钥"
            });
        }

        const deletedKey = await deleteAccessKey(keyToDelete);
        
        await addOperationLog('delete_key', adminInfo.name, keyToDelete, 
               `删除秘钥成功：${keyDataToDelete.remark || '无备注'}`);
        
        // 记录管理员操作
        await addAdminOperation({
            adminEmail: adminInfo.email,
            adminName: adminInfo.name,
            operationType: 'delete_key',
            targetKey: keyToDelete,
            targetAdmin: keyDataToDelete.added_by,
            details: `删除秘钥: ${keyToDelete}, 备注: ${keyDataToDelete.remark || '无'}`
        });

        res.json({
            success: true,
            message: "秘钥删除成功",
            deletedKey: formatKeyData(deletedKey)
        });

    } catch (error) {
        console.error('删除秘钥错误:', error);
        await addOperationLog('delete_key', 'unknown', 'unknown', '删除秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// ========== 第二个代码的API接口 ==========

// 9. 密钥验证API端点（从第二个代码）
app.post('/api/verify-key', (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.json({
            ok: false,
            message: "请输入访问密钥"
        });
    }
    
    // 验证密钥
    if (key === ACCESS_KEY) {
        res.json({
            ok: true,
            message: "密钥验证成功"
        });
    } else {
        res.json({
            ok: false,
            message: "密钥错误，请重新输入"
        });
    }
});

// 10. CPM账号登录（从第二个代码）
app.post('/api/cpm-login', async (req, res) => {
    console.log('CPM Login attempt:', { email: req.body.email });
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.json({
            ok: false,
            error: 400,
            message: "Missing email or password"
        });
    }

    const url = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
    const payload = {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: "CLIENT_TYPE_ANDROID"
    };
    
    const headers = {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    
    const params = { key: FIREBASE_API_KEY };
    
    try {
        const response = await sendCPMRequest(url, payload, headers, params);
        
        if (response && response.idToken) {
            console.log('CPM Login successful for:', email);
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                auth: response.idToken,
                refreshToken: response.refreshToken,
                expiresIn: response.expiresIn,
                localId: response.localId,
                email: email, 
                password: password
            });
        } else {
            const error = response?.error?.message || "UNKNOWN_ERROR";
            console.log('CPM Login failed:', error);
            res.json({
                ok: false,
                error: 401,
                message: error,
                auth: null
            });
        }
    } catch (error) {
        console.error('CPM Login server error:', error);
        res.json({
            ok: false,
            error: 500,
            message: "Server error: " + error.message
        });
    }
});

// 11. 获取账号数据（从第二个代码）
app.post('/api/get-account-data', async (req, res) => {
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const url = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const payload = { data: null };
    const headers = {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    };
    
    try {
        const response = await sendCPMRequest(url, payload, headers);
        
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "UNKNOWN_ERROR", data: [] });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: "Server error" });
    }
});

// 12. 获取所有车辆（从第二个代码）
app.post('/api/get-all-cars', async (req, res) => {
    const { authToken } = req.body;
    if (!authToken) return res.json({ ok: false, error: 401, message: "Missing auth token" });
    
    const url = `${CPM_BASE_URL}/TestGetAllCars`;
    const payload = { data: null };
    const headers = {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    };
    
    try {
        const response = await sendCPMRequest(url, payload, headers);
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "UNKNOWN_ERROR", data: [] });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: "Server error" });
    }
});

// 13. 修改当前账号ID（从第二个代码）
app.post('/api/change-localid', async (req, res) => {
    console.log('Change local ID request received');
    const { sourceEmail, sourcePassword, newLocalId, authToken: providedToken } = req.body;
    
    if (!newLocalId) {
        return res.json({ ok: false, result: 0, message: "Missing new local ID" });
    }
    
    let authToken = providedToken;
    let loginNeeded = !authToken;

    try {
        // 步骤 1: 验证或获取 Token
        console.log('Step 1: Authenticating...');
        
        if (authToken) {
            const checkUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
            const checkRes = await sendCPMRequest(checkUrl, { data: null }, {
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            });
            if (!checkRes || !checkRes.result) {
                console.log('Provided token is invalid or expired, falling back to credentials');
                loginNeeded = true;
            } else {
                console.log('Token is valid, skipping re-login');
            }
        }

        if (loginNeeded) {
            if (!sourceEmail || !sourcePassword) {
                return res.json({ ok: false, result: 0, message: "Token expired and no credentials provided" });
            }
            const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
            const loginPayload = {
                email: sourceEmail,
                password: sourcePassword,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            };
            const loginParams = { key: FIREBASE_API_KEY };
            const loginResponse = await sendCPMRequest(loginUrl, loginPayload, {
                "Content-Type": "application/json"
            }, loginParams);
            
            if (!loginResponse?.idToken) {
                return res.json({ ok: false, result: 0, message: "Login failed. Check credentials." });
            }
            authToken = loginResponse.idToken;
            console.log('Re-login successful');
        }
        
        // 步骤 2: 获取账号数据
        console.log('Step 2: Getting source account data');
        const url1 = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const headers1 = {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        };
        
        const accountResponse = await sendCPMRequest(url1, { data: null }, headers1);
        if (!accountResponse?.result) {
            return res.json({ ok: false, result: 0, message: "Failed to get account data" });
        }
        
        let accountData;
        try { 
            accountData = JSON.parse(accountResponse.result); 
        } catch (e) { 
            console.error('Parse account data error:', e);
            return res.json({ ok: false, result: 0, message: "Invalid account data format" });
        }
        
        let oldLocalId = accountData.localID || accountData.localId;
        const cleanOldLocalId = removeColorCodes(oldLocalId);
        
        if (newLocalId === cleanOldLocalId) {
            return res.json({ ok: false, result: 0, message: "New ID is same as old ID" });
        }
        
        // 步骤 3: 获取所有车辆
        console.log('Step 3: Getting all cars');
        const url2 = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url2, { data: null }, headers1);
        let carsData = [];
        if (carsResponse?.result) {
            try { 
                carsData = JSON.parse(carsResponse.result); 
            } catch (e) { 
                console.error('Parse cars data error:', e);
                carsData = [];
            }
        }
        console.log(`Account has ${Array.isArray(carsData) ? carsData.length : '0'} cars`);
        
        // 步骤 4: 更新账号ID
        console.log('Step 4: Updating account data with new local ID');
        
        // 深度清理账号数据
        const cleanAccountData = {
            localID: newLocalId,
            localId: newLocalId,
            money: accountData.money || 500000000,
            Name: accountData.Name || "Player",
            allData: accountData.allData || {},
            platesData: accountData.platesData || {},
            premium: accountData.premium || false,
            exp: accountData.exp || 0,
            wins: accountData.wins || 0,
            level: accountData.level || 0,
            pfp: accountData.pfp || "",
            bio: accountData.bio || "",
            xp: accountData.xp || 0,
            playerCar: accountData.playerCar || "",
            players: accountData.players || {},
            daily: accountData.daily || {},
            tags: accountData.tags || []
        };
        
        // 删除所有可能的数据库字段
        const databaseFields = ['_id', 'id', 'createdAt', 'updatedAt', '__v', '$__', 'isNew', '_doc', 'errors', 'schema'];
        databaseFields.forEach(field => {
            delete cleanAccountData[field];
        });
        
        console.log('Cleaned account data structure:', Object.keys(cleanAccountData));
        
        const url3 = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const payload3 = { data: JSON.stringify(cleanAccountData) };
        
        const saveAccountResponse = await sendCPMRequest(url3, payload3, headers1);
        console.log('Save account data response:', saveAccountResponse);
        
        // 检查保存结果
        if (!saveAccountResponse) {
            return res.json({
                ok: false,
                result: 0,
                message: "Failed to save account data: No response from server"
            });
        }
        
        // 处理不同的响应格式
        const resultValue = saveAccountResponse.result;
        if (resultValue === 1 || resultValue === "1" || 
            resultValue === '{"result":1}' || 
            (typeof resultValue === 'string' && resultValue.includes('"result":1'))) {
            console.log('Account data saved successfully');
        } else {
            console.error('Save account data failed, response:', resultValue);
            return res.json({
                ok: false,
                result: 0,
                message: `Failed to save account data. Server returned: ${JSON.stringify(resultValue)}`
            });
        }
        
        // 步骤 5: 更新车辆
        let updatedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(carsData) && carsData.length > 0) {
            console.log(`Updating ${carsData.length} cars...`);
            
            for (let i = 0; i < carsData.length; i++) {
                const car = carsData[i];
                
                try {
                    // 深度复制并清理车辆数据
                    let carCopy = JSON.parse(JSON.stringify(car));
                    
                    // 清理数据库字段
                    databaseFields.forEach(field => {
                        delete carCopy[field];
                    });
                    
                    // 替换Local ID
                    if (oldLocalId && cleanOldLocalId) {
                        const carStr = JSON.stringify(carCopy);
                        let newCarStr = carStr;
                        
                        if (oldLocalId) {
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                        }
                        if (cleanOldLocalId && cleanOldLocalId !== oldLocalId) {
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                        }
                        
                        try { 
                            carCopy = JSON.parse(newCarStr); 
                        } catch (parseError) {
                            console.log('Car parse after replace, using original');
                        }
                    }
                    
                    // 更新CarID字段
                    if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                        if (oldLocalId && carCopy.CarID.includes(oldLocalId)) {
                            carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                        }
                        if (cleanOldLocalId && carCopy.CarID.includes(cleanOldLocalId)) {
                            carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                        }
                    }
                    
                    const url4 = `${CPM_BASE_URL}/SaveCars`;
                    const randomNum = Math.floor(Math.random() * (888889 - 111111) + 111111);
                    const payload4 = { data: JSON.stringify(carCopy) };
                    const headers4 = {
                        "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                        "Authorization": `Bearer ${authToken}`,
                        "firebase-instance-id-token": "fdEMFcKoR2iSrZAzViyFkh:APA91bEQsP8kAGfBuPTL_ATg25AmnqpssGTkc7IAS2CgLiILjBbneFuSEzOJr2a97eDvQOPGxlphSIV7gCk2k4Wl0UxMK5x298LrJYa5tJmVRqdyz0j3KDSKLCtCbldkRFwNnjU3lwfP",
                        "Content-Type": "application/json; charset=utf-8",
                        "User-Agent": `Dalvik/2.1.0 (Linux; U; Android 8.1.0; ASUS_X00TD MIUI/16.2017.2009.087-20${randomNum})`
                    };
                    
                    const saveCarResponse = await sendCPMRequest(url4, payload4, headers4);
                    if (saveCarResponse && (saveCarResponse.success === true || saveCarResponse.result === 1 || saveCarResponse.result === "1")) {
                        updatedCars++;
                        console.log(`Car ${i+1}/${carsData.length} updated successfully`);
                    } else {
                        failedCars++;
                        console.log(`Car ${i+1}/${carsData.length} failed:`, saveCarResponse);
                    }
                    
                    // 添加延迟避免请求过多
                    if (i < carsData.length - 1) {
                        await new Promise(r => setTimeout(r, 300));
                    }
                    
                } catch (e) {
                    failedCars++;
                    console.error(`Error processing car ${i+1}:`, e.message);
                }
            }
        }
        
        res.json({
            ok: true,
            result: 1,
            message: "Local ID changed successfully!",
            details: {
                oldLocalId: cleanOldLocalId,
                newLocalId: newLocalId,
                carsUpdated: updatedCars,
                carsFailed: failedCars,
                totalCars: Array.isArray(carsData) ? carsData.length : 0
            }
        });
        
    } catch (error) {
        console.error('Change local ID process error:', error);
        res.json({ 
            ok: false, 
            result: 0, 
            message: `Process failed: ${error.message}` 
        });
    }
});

// 14. 克隆账号功能（从第二个代码）
app.post('/api/clone-account', async (req, res) => {
    console.log('Clone account request received');
    const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
        return res.json({
            ok: false,
            error: 400,
            message: "Missing required parameters"
        });
    }
    
    try {
        console.log('Step 1: Getting source account data');
        const url1 = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const accountResponse = await sendCPMRequest(url1, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        if (!accountResponse?.result) {
            return res.json({
                ok: false,
                error: 404,
                message: "Failed to get source account data"
            });
        }
        
        let sourceData;
        try { 
            sourceData = JSON.parse(accountResponse.result); 
        } catch (e) { 
            console.error('Parse source data error:', e);
            return res.json({
                ok: false,
                error: 500,
                message: "Invalid source account data format"
            });
        }
        
        let from_id = sourceData.localID || sourceData.localId;
        console.log(`Source account localID (raw): ${from_id}`);
        
        const clean_from_id = removeColorCodes(from_id);
        console.log(`Source account localID (cleaned): ${clean_from_id}`);
        
        console.log('Step 2: Getting source cars');
        const url2 = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url2, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        let sourceCars = [];
        if (carsResponse?.result) {
            try { 
                sourceCars = JSON.parse(carsResponse.result); 
            } catch (e) { 
                console.error('Parse source cars error:', e);
                sourceCars = [];
            }
        }
        
        console.log(`Source account has ${Array.isArray(sourceCars) ? sourceCars.length : 0} cars`);
        
        console.log('Step 3: Logging into target account');
        const url3 = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
        const loginResponse = await sendCPMRequest(url3, {
            email: targetEmail,
            password: targetPassword,
            returnSecureToken: true,
            clientType: "CLIENT_TYPE_ANDROID"
        }, {
            "Content-Type": "application/json"
        }, { key: FIREBASE_API_KEY });
        
        if (!loginResponse?.idToken) {
            const error = loginResponse?.error?.message || "UNKNOWN_ERROR";
            return res.json({
                ok: false,
                error: 401,
                message: `Failed to login to target account: ${error}`
            });
        }
        
        const targetAuth = loginResponse.idToken;
        const targetLocalId = loginResponse.localId;
        console.log(`Target account logged in, localId: ${targetLocalId}`);
        
        console.log('Step 4: Preparing target account data');
        let to_id;
        if (customLocalId && customLocalId.trim() !== '') {
            to_id = customLocalId.trim();
            console.log(`Using custom localID: ${to_id}`);
        } else {
            to_id = generateRandomId().toUpperCase();
            console.log(`Generated random localID: ${to_id}`);
        }
        
        // 清理目标账号数据
        const targetAccountData = {
            localID: to_id,
            localId: to_id,
            money: sourceData.money || 500000000,
            Name: sourceData.Name || "TELMunn",
            allData: sourceData.allData || {},
            platesData: sourceData.platesData || {},
            premium: sourceData.premium || false,
            exp: sourceData.exp || 0,
            wins: sourceData.wins || 0,
            level: sourceData.level || 0,
            pfp: sourceData.pfp || "",
            bio: sourceData.bio || "",
            xp: sourceData.xp || 0,
            playerCar: sourceData.playerCar || "",
            players: sourceData.players || {},
            daily: sourceData.daily || {},
            tags: sourceData.tags || []
        };
        
        console.log('Step 5: Saving target account data');
        const url5 = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const saveDataResponse = await sendCPMRequest(url5, { data: JSON.stringify(targetAccountData) }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${targetAuth}`,
            "Content-Type": "application/json"
        });
        
        console.log('Save account data response:', saveDataResponse);
        
        if (!saveDataResponse) {
            return res.json({
                ok: false,
                error: 500,
                message: "Failed to save target account data: No response"
            });
        }
        
        const resultValue = saveDataResponse.result;
        if (!(resultValue === 1 || resultValue === "1" || 
              resultValue === '{"result":1}' || 
              (typeof resultValue === 'string' && resultValue.includes('"result":1')))) {
            return res.json({
                ok: false,
                error: 500,
                message: `Failed to save target account data. Response: ${JSON.stringify(resultValue)}`
            });
        }
        
        console.log('Step 6: Cloning cars');
        let clonedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(sourceCars) && sourceCars.length > 0) {
            console.log(`Cloning ${sourceCars.length} cars...`);
            
            const databaseFields = ['_id', 'id', 'createdAt', 'updatedAt', '__v', '$__', 'isNew', '_doc', 'errors', 'schema'];
            
            for (let i = 0; i < sourceCars.length; i++) {
                const car = sourceCars[i];
                
                try {
                    let carCopy = JSON.parse(JSON.stringify(car));
                    
                    // 清理数据库字段
                    databaseFields.forEach(field => {
                        delete carCopy[field];
                    });
                    
                    // 替换Local ID
                    if (from_id) {
                        const carStr = JSON.stringify(carCopy);
                        let newCarStr = carStr;
                        
                        if (from_id) {
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                        }
                        if (clean_from_id && clean_from_id !== from_id) {
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                        }
                        
                        try { 
                            carCopy = JSON.parse(newCarStr); 
                        } catch (parseError) {
                            console.log('Car parse after replace, using original');
                        }
                    }
                    
                    // 更新CarID字段
                    if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                        if (from_id && carCopy.CarID.includes(from_id)) {
                            carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                        }
                        if (clean_from_id && carCopy.CarID.includes(clean_from_id)) {
                            carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                        }
                    }
                    
                    const url6 = `${CPM_BASE_URL}/SaveCars`;
                    const randomNum = Math.floor(Math.random() * (888889 - 111111) + 111111);
                    const saveCarResponse = await sendCPMRequest(url6, { data: JSON.stringify(carCopy) }, {
                        "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                        "Authorization": `Bearer ${targetAuth}`,
                        "firebase-instance-id-token": "fdEMFcKoR2iSrZAzViyFkh:APA91bEQsP8kAGfBuPTL_ATg25AmnqpssGTkc7IAS2CgLiILjBbneFuSEzOJr2a97eDvQOPGxlphSIV7gCk2k4Wl0UxMK5x298LrJYa5tJmVRqdyz0j3KDSKLCtCbldkRFwNnjU3lwfP",
                        "Content-Type": "application/json; charset=utf-8",
                        "User-Agent": `Dalvik/2.1.0 (Linux; U; Android 8.1.0; ASUS_X00TD MIUI/16.2017.2009.087-20${randomNum})`
                    });
                    
                    if (saveCarResponse && (saveCarResponse.success === true || saveCarResponse.result === 1 || saveCarResponse.result === "1")) {
                        clonedCars++;
                        console.log(`Car ${i+1}/${sourceCars.length} cloned successfully`);
                    } else {
                        failedCars++;
                        console.log(`Car ${i+1}/${sourceCars.length} failed:`, saveCarResponse);
                    }
                    
                    // 添加延迟
                    if (i < sourceCars.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    
                } catch (carError) {
                    console.error(`Error processing car ${i + 1}:`, carError.message);
                    failedCars++;
                }
            }
            
            console.log(`Successfully cloned ${clonedCars} cars, failed: ${failedCars}`);
            
            res.json({
                ok: true,
                error: 0,
                message: "Account cloned successfully!",
                details: {
                    targetAccount: targetEmail,
                    carsCloned: clonedCars,
                    carsFailed: failedCars,
                    newLocalId: to_id,
                    totalCars: sourceCars.length
                }
            });
            
        } else {
            console.log('No cars to clone');
            res.json({
                ok: true,
                error: 0,
                message: "Account cloned successfully (no cars to clone)!",
                details: {
                    targetAccount: targetEmail,
                    carsCloned: 0,
                    carsFailed: 0,
                    newLocalId: to_id,
                    totalCars: 0
                }
            });
        }
        
    } catch (error) {
        console.error('Clone process error:', error);
        res.json({
            ok: false,
            error: 500,
            message: `Clone failed: ${error.message}`
        });
    }
});

// =================================================================
// 公共API接口
// =================================================================

// 15. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            database: 'connected',
            accessKeys: parseInt(keysCount.rows[0].count),
            superAdminKey: SUPER_ADMIN_KEY,
            timestamp: new Date().toISOString(),
            features: [
                '支持测试卡和改密卡',
                '分类秘钥管理',
                '多语言支持',
                '管理员操作记录',
                '修改邮箱和密码功能',
                'CPM账号克隆功能',
                '车辆数据管理'
            ]
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: '数据库连接失败'
        });
    }
});

// 16. 测试端点（从第二个代码）
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'MKNLS CPM服务运行正常',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        firebase_key: FIREBASE_API_KEY ? 'Set' : 'Not set',
        access_key: ACCESS_KEY ? 'Set' : 'Not set',
        cpm_base_url: CPM_BASE_URL ? 'Set' : 'Not set'
    });
});

// 17. 健康检查（从第二个代码）
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'MKNLS CPM综合服务',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '2.3.0'
    });
});

// 18. 主页
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 19. 应用密钥验证中间件到CPM相关接口
app.use('/api/cpm-*', verifyAccessKey);

// =================================================================
// 错误处理
// =================================================================

// 404处理
app.use((req, res) => {
    res.status(404).json({ 
        success: false,
        error: 'Not Found', 
        path: req.path 
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ 
        success: false,
        error: 'Internal Server Error', 
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// =================================================================
// 启动服务
// =================================================================

app.listen(PORT, async () => {
    console.log(`🚀 MKNLS CPM综合服务启动中，端口：${PORT}`);
    console.log('✅ 所有环境变量验证通过');
    console.log(`🔑 Firebase API Key: ${FIREBASE_API_KEY ? 'Set ✓' : 'Not set ✗'}`);
    console.log(`🔐 CPM Access Key: ${ACCESS_KEY ? 'Set ✓' : 'Not set ✗'}`);
    console.log(`🌐 CPM Base URL: ${CPM_BASE_URL ? 'Set ✓' : 'Not set ✗'}`);
    console.log(`💾 Database: ${DATABASE_URL ? 'Connected ✓' : 'Not set ✗'}`);
    
    try {
        await initDatabase();
        console.log('✅ 数据库初始化完成');
        console.log('👑 超级管理员密钥:', SUPER_ADMIN_KEY);
        console.log('🎯 服务已就绪，等待请求...');
        console.log('===========================================');
        console.log(`🌐 访问地址: http://localhost:${PORT}`);
        console.log(`🏥 健康检查: http://localhost:${PORT}/health`);
        console.log(`⚡ 环境: ${process.env.NODE_ENV || 'development'}`);
        console.log(`✨ 版本: 2.3.0 - MKNLS与CPM功能合并版`);
        console.log('===========================================');
    } catch (error) {
        console.error('❌ 服务启动失败:', error);
        process.exit(1);
    }
});
