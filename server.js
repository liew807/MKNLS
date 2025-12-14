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

// 超级管理员密钥 - 已移除前端硬编码，后端可自行设置
const SUPER_ADMIN_KEY = 'Liew1201@'; // 您可以修改这个值

// 初始化数据库表
async function initDatabase() {
    try {
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
                application_info JSONB DEFAULT NULL,
                original_key VARCHAR(50) DEFAULT NULL,
                copied_times INTEGER DEFAULT 0,
                is_telegram_generated BOOLEAN DEFAULT FALSE,
                kuaishou_code VARCHAR(100) DEFAULT NULL,
                applied_via VARCHAR(50) DEFAULT NULL
            )
        `);

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

        console.log('✅ 数据库表初始化完成');
        
        // 检查是否已有超级管理员密钥，如果没有则创建
        const superAdminCheck = await pool.query(
            'SELECT * FROM access_keys WHERE key = $1', 
            [SUPER_ADMIN_KEY]
        );
        
        if (superAdminCheck.rows.length === 0) {
            const expiryTime = new Date();
            expiryTime.setFullYear(expiryTime.getFullYear() + 10); // 10年有效期
            
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
                24 * 365 * 10, // 10年
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
    return result.rows[0];
}

async function createAccessKey(keyData) {
    const query = `
        INSERT INTO access_keys (
            key, remark, expiry_time, status, is_admin, is_super_admin, 
            is_test_card, is_password_card, duration_hours, max_bind, 
            added_by, added_by_name, added_by_email, card_type, 
            bound_emails, bound_accounts, activation_time,
            original_key, copied_times, is_telegram_generated,
            kuaishou_code, applied_via, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING *
    `;
    
    const values = [
        keyData.key,
        keyData.remark || '无',
        keyData.expiryTime,
        keyData.status || 'active',
        keyData.isAdmin || false,
        keyData.isSuperAdmin || false,
        keyData.isTestCard || false,
        keyData.isPasswordCard || false,
        keyData.durationHours || 24,
        keyData.maxBind || 3,
        keyData.addedBy || 'unknown',
        keyData.addedByName || '未知',
        keyData.addedByEmail || 'unknown@mknls.com',
        keyData.cardType || 'FULL',
        keyData.boundEmails || [],
        JSON.stringify(keyData.boundAccounts || []),
        keyData.activationTime || new Date().toISOString(),
        keyData.originalKey || null,
        keyData.copiedTimes || 0,
        keyData.isTelegramGenerated || false,
        keyData.kuaishouCode || null,
        keyData.appliedVia || null,
        new Date().toISOString()
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function updateAccessKey(key, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updates).forEach(field => {
        if (field === 'boundAccounts' || field === 'boundEmails') {
            fields.push(`${field === 'boundAccounts' ? 'bound_accounts' : 'bound_emails'} = $${paramCount}`);
            values.push(JSON.stringify(updates[field]));
        } else if (field === 'expiryTime') {
            fields.push(`expiry_time = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'durationHours') {
            fields.push(`duration_hours = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'maxBind') {
            fields.push(`max_bind = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'isTestCard') {
            fields.push(`is_test_card = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'isPasswordCard') {
            fields.push(`is_password_card = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'cardType') {
            fields.push(`card_type = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'isAdmin') {
            fields.push(`is_admin = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'isSuperAdmin') {
            fields.push(`is_super_admin = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'remark') {
            fields.push(`remark = $${paramCount}`);
            values.push(updates[field]);
        } else if (field === 'status') {
            fields.push(`status = $${paramCount}`);
            values.push(updates[field]);
        } else {
            // 自动转换驼峰为下划线
            const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
            fields.push(`${dbField} = $${paramCount}`);
            values.push(updates[field]);
        }
        paramCount++;
    });

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
    const query = `
        INSERT INTO operation_logs (action, user_email, key_used, details)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `;
    
    const result = await pool.query(query, [action, user, key, details]);
    return result.rows[0];
}

async function addAdminOperation(operation) {
    const query = `
        INSERT INTO admin_operations (
            admin_email, admin_name, operation_type, target_key, target_admin, 
            details, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;
    
    const values = [
        operation.adminEmail,
        operation.adminName,
        operation.operationType,
        operation.targetKey,
        operation.targetAdmin,
        operation.details,
        operation.ipAddress || 'unknown',
        operation.userAgent || 'unknown'
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function cleanupExpiredKeys() {
    const result = await pool.query(
        'DELETE FROM access_keys WHERE expiry_time < NOW() RETURNING *'
    );
    return result.rows;
}

// 格式化秘钥数据
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
        originalKey: keyData.original_key,
        copiedTimes: keyData.copied_times || 0,
        isTelegramGenerated: keyData.is_telegram_generated || false,
        kuaishouCode: keyData.kuaishou_code,
        appliedVia: keyData.applied_via,
        createdAt: keyData.created_at,
        status: keyData.status
    };
}

// 密钥生成函数
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
                message: "验证失败: 请输入秘钥"
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

// 2. 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, key } = req.body;

        console.log('登录请求:', { email, key: key || '无秘钥' });

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        // 如果提供了秘钥，先验证秘钥状态
        let keyData = null;
        let isTestCard = false;
        let isPasswordCard = false;
        
        if (key) {
            keyData = await getAccessKey(key);
            
            if (!keyData) {
                return res.status(400).json({
                    success: false,
                    message: "无效的秘钥"
                });
            }
            
            if (keyData.status !== 'active') {
                return res.status(400).json({
                    success: false,
                    message: "秘钥未激活"
                });
            }
            
            if (new Date(keyData.expiry_time) < new Date()) {
                await updateAccessKey(key, { status: 'expired' });
                return res.status(400).json({
                    success: false,
                    message: "秘钥已过期"
                });
            }
            
            // 设置卡类型标志
            isTestCard = keyData.is_test_card || false;
            isPasswordCard = keyData.is_password_card || false;
            
            // 检查绑定限制（只有普通秘钥才需要检查）
            if (!keyData.is_admin) {
                const boundEmails = keyData.bound_emails || [];
                const maxBind = keyData.max_bind || 3;
                
                // 如果邮箱已绑定，直接通过
                const isEmailBound = boundEmails.includes(email);
                
                if (!isEmailBound && boundEmails.length >= maxBind) {
                    return res.status(400).json({
                        success: false,
                        message: "该秘钥绑定数量已达上限"
                    });
                }
            }
        }

        // 验证Firebase账号
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
        if (key && keyData) {
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

        await addOperationLog('user_login', email, key || 'N/A', '用户登录成功');

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                role: 'user',
                expiresIn: firebaseData.expiresIn,
                isTestCard: isTestCard,
                isPasswordCard: isPasswordCard
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

// 6. 管理员获取分类秘钥列表
app.get('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
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

        // 获取所有秘钥
        const allKeys = await getAllAccessKeys();
        
        // 格式化所有秘钥数据
        const formattedKeys = allKeys.map(formatKeyData);
        
        // Telegram机器人生成的秘钥
        const tgKeys = formattedKeys.filter(k => k.isTelegramGenerated);
        
        // 超级管理人生成的秘钥
        const superAdminKeys = formattedKeys.filter(k => k.isSuperAdmin && k.addedBy === SUPER_ADMIN_KEY);
        
        // 普通管理人生成的秘钥（按管理员分组）
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
        await addOperationLog('fetch_keys', 'unknown', 'unknown', '获取秘钥列表失败');
        res.status(400).json({
            success: false,
            message: "验证失败: 服务器错误"
        });
    }
});

// 7. 管理员添加秘钥（修复版）
app.post('/api/admin/keys', async (req, res) => {
    try {
        const adminKey = req.query.key;
        const { durationHours, maxBind, remark, isTestCard, isPasswordCard } = req.body;

        console.log('生成秘钥请求:', { adminKey, durationHours, maxBind, remark, isTestCard, isPasswordCard });

        if (!adminKey) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        let isSuperAdmin = false;
        let adminInfo = null;

        if (adminKey === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY, 
                email: 'super_admin@mknls.com' 
            };
        } else {
            const keyData = await getAccessKey(adminKey);
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

        // 普通管理员只能生成测试卡和改密卡
        if (!isSuperAdmin && (isTestCard === false && isPasswordCard === false)) {
            return res.status(403).json({
                success: false,
                message: "普通管理员只能生成测试卡和改密卡"
            });
        }

        // 生成新秘钥
        const newKey = generateAccessKey();
        const now = new Date();
        
        // 设置参数
        let actualDuration = 24;
        let actualMaxBind = 3;
        let actualCardType = 'FULL';
        let actualRemark = remark;
        
        if (isTestCard) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'TEST';
            actualRemark = actualRemark || '测试卡';
        } else if (isPasswordCard) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'PASSWORD';
            actualRemark = actualRemark || '改密卡';
        } else {
            // 全功能卡
            actualDuration = durationHours || 24;
            actualMaxBind = maxBind || 3;
            actualCardType = 'FULL';
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
        }
        
        const expiryTime = new Date(now);
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        // 创建秘钥数据
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
            activationTime: now.toISOString(),
            originalKey: null,
            copiedTimes: 0,
            isTelegramGenerated: false
        };
        
        const createdKey = await createAccessKey(keyData);
        
        let cardName = '';
        if (isTestCard) {
            cardName = '测试卡';
        } else if (isPasswordCard) {
            cardName = '改密卡';
        } else {
            cardName = actualCardType + '卡';
        }
        
        await addOperationLog('generate_key', adminInfo.name, newKey, 
               `生成${cardName}成功：${actualRemark}`);
        
        // 记录管理员操作
        await addAdminOperation({
            adminEmail: adminInfo.email,
            adminName: adminInfo.name,
            operationType: 'generate_key',
            targetKey: newKey,
            targetAdmin: null,
            details: `生成秘钥: ${newKey}, 类型: ${cardName}, 时长: ${actualDuration}小时, 绑定: ${actualMaxBind}个`
        });

        res.json({
            success: true,
            key: newKey,
            message: `${cardName}生成成功`,
            cardInfo: {
                type: actualCardType,
                duration: actualDuration,
                maxBind: actualMaxBind,
                isTestCard: isTestCard,
                isPasswordCard: isPasswordCard
            }
        });

    } catch (error) {
        console.error('生成秘钥错误:', error);
        await addOperationLog('generate_key', 'unknown', 'unknown', '生成秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败: " + error.message
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
                message: "验证失败: 需要提供管理员密钥和目标秘钥"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
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
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
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
            message: "验证失败: " + error.message
        });
    }
});

// 9. 新增：获取秘钥详情接口（适配前端详情功能）
app.get('/api/admin/key-details', async (req, res) => {
    try {
        const { key, targetKey } = req.query;

        if (!key || !targetKey) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥和目标秘钥"
            });
        }

        // 验证管理员权限
        if (key !== SUPER_ADMIN_KEY) {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
        }

        const keyData = await getAccessKey(targetKey);
        if (!keyData) {
            return res.status(404).json({
                success: false,
                message: "秘钥不存在"
            });
        }

        // 格式化详情数据
        const detailedData = formatKeyData(keyData);
        
        // 添加额外的详情信息
        detailedData.createdAt = keyData.created_at;
        detailedData.status = keyData.status;
        
        // 解析绑定账号的详细信息
        if (detailedData.boundAccounts && Array.isArray(detailedData.boundAccounts)) {
            detailedData.boundAccounts = detailedData.boundAccounts.map(account => {
                if (typeof account === 'string') {
                    try {
                        return JSON.parse(account);
                    } catch (e) {
                        return { email: account };
                    }
                }
                return account;
            });
        }

        res.json({
            success: true,
            keyData: detailedData,
            message: "获取秘钥详情成功"
        });

    } catch (error) {
        console.error('获取秘钥详情错误:', error);
        res.status(400).json({
            success: false,
            message: "获取详情失败: " + error.message
        });
    }
});

// 10. 清理过期秘钥
app.post('/api/admin/cleanup-expired-keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
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
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        const deletedKeys = await cleanupExpiredKeys();
        
        await addOperationLog('cleanup_keys', adminInfo.name, 'SYSTEM', 
               `清理过期秘钥成功，共删除 ${deletedKeys.length} 个`);
        
        // 记录管理员操作
        await addAdminOperation({
            adminEmail: adminInfo.email,
            adminName: adminInfo.name,
            operationType: 'cleanup_keys',
            targetKey: null,
            targetAdmin: null,
            details: `清理过期秘钥: 共删除 ${deletedKeys.length} 个过期秘钥`
        });

        res.json({
            success: true,
            message: `成功清理 ${deletedKeys.length} 个过期秘钥`,
            deletedCount: deletedKeys.length,
            deletedKeys: deletedKeys.map(formatKeyData)
        });

    } catch (error) {
        console.error('清理过期秘钥错误:', error);
        await addOperationLog('cleanup_keys', 'unknown', 'SYSTEM', '清理过期秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败: " + error.message
        });
    }
});

// 11. 获取卡类型列表
app.get('/api/card-types', async (req, res) => {
    try {
        const cardTypesList = [
            {
                id: 'BRONZE',
                name: '青铜VIP',
                durationHours: 24,
                maxBind: 3,
                features: ['基础功能权限', '24小时有效期'],
                color: '#CD7F32',
                level: 'BRONZE'
            },
            {
                id: 'SILVER',
                name: '白银VIP',
                durationHours: 24 * 3,
                maxBind: 5,
                features: ['基础功能权限', '3天有效期', '更多绑定数量'],
                color: '#C0C0C0',
                level: 'SILVER'
            },
            {
                id: 'GOLD',
                name: '黄金VIP',
                durationHours: 24 * 7,
                maxBind: 10,
                features: ['完整功能权限', '7天有效期', '更多绑定数量'],
                color: '#FFD700',
                level: 'GOLD'
            },
            {
                id: 'PLATINUM',
                name: '白金VIP',
                durationHours: 24 * 30,
                maxBind: 20,
                features: ['完整功能权限', '30天有效期', '大量绑定数量', '优先支持'],
                color: '#E5E4E2',
                level: 'PLATINUM'
            },
            {
                id: 'DIAMOND',
                name: '至尊VIP',
                durationHours: 24 * 90,
                maxBind: 50,
                features: ['完整功能权限', '90天有效期', '超大绑定数量', '专属支持'],
                color: '#B9F2FF',
                level: 'DIAMOND'
            },
            {
                id: 'TEST',
                name: '测试卡',
                durationHours: 1,
                maxBind: 1,
                features: ['仅支持解锁成就功能', '不支持修改邮箱密码'],
                color: '#FF2D55',
                level: 'TEST',
                isTestCard: true
            },
            {
                id: 'PASSWORD',
                name: '改密卡',
                durationHours: 1,
                maxBind: 1,
                features: ['仅支持修改密码功能', '不支持King等级和修改邮箱'],
                color: '#34C759',
                level: 'PASSWORD',
                isPasswordCard: true
            },
            {
                id: 'FULL',
                name: '全功能卡',
                durationHours: 24,
                maxBind: 3,
                features: ['所有功能权限', '可自定义时长', '可自定义绑定数量'],
                color: '#007AFF',
                level: 'FULL'
            }
        ];

        res.json({
            success: true,
            data: cardTypesList
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 12. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        const logsCount = await pool.query('SELECT COUNT(*) FROM operation_logs');
        const operationsCount = await pool.query('SELECT COUNT(*) FROM admin_operations');
        
        // 获取卡类型统计
        const testCards = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_test_card = true');
        const passwordCards = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_password_card = true');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            database: 'connected',
            accessKeys: parseInt(keysCount.rows[0].count),
            operationLogs: parseInt(logsCount.rows[0].count),
            adminOperations: parseInt(operationsCount.rows[0].count),
            testCards: parseInt(testCards.rows[0].count),
            passwordCards: parseInt(passwordCards.rows[0].count),
            features: [
                '支持测试卡和改密卡',
                '分类秘钥管理',
                '管理员操作记录',
                '详情查看功能',
                '多语言支持'
            ]
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: '数据库连接失败: ' + error.message
        });
    }
});

// 13. 新增：批量操作接口
app.post('/api/admin/batch-operations', async (req, res) => {
    try {
        const { key, operation, keys } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        if (key !== SUPER_ADMIN_KEY) {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin || !keyData.is_super_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 需要超级管理员权限"
                });
            }
        }

        if (!operation || !keys || !Array.isArray(keys)) {
            return res.status(400).json({
                success: false,
                message: "参数错误: 需要提供操作类型和秘钥列表"
            });
        }

        const results = [];
        const errors = [];

        for (const targetKey of keys) {
            try {
                switch (operation) {
                    case 'delete':
                        const deleted = await deleteAccessKey(targetKey);
                        results.push({
                            key: targetKey,
                            operation: 'delete',
                            success: true,
                            data: formatKeyData(deleted)
                        });
                        break;
                        
                    case 'extend':
                        // 延长30天
                        const keyData = await getAccessKey(targetKey);
                        if (keyData) {
                            const newExpiry = new Date(keyData.expiry_time);
                            newExpiry.setDate(newExpiry.getDate() + 30);
                            const updated = await updateAccessKey(targetKey, {
                                expiryTime: newExpiry.toISOString(),
                                durationHours: keyData.duration_hours + 24 * 30
                            });
                            results.push({
                                key: targetKey,
                                operation: 'extend',
                                success: true,
                                newExpiry: newExpiry.toISOString()
                            });
                        }
                        break;
                        
                    default:
                        errors.push({
                            key: targetKey,
                            error: `不支持的操作类型: ${operation}`
                        });
                }
            } catch (error) {
                errors.push({
                    key: targetKey,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `批量操作完成: 成功 ${results.length} 个, 失败 ${errors.length} 个`,
            results: results,
            errors: errors
        });

    } catch (error) {
        console.error('批量操作错误:', error);
        res.status(400).json({
            success: false,
            message: "批量操作失败: " + error.message
        });
    }
});

// 启动服务
app.listen(PORT, async () => {
    console.log(`🚀 MKNLS 后端服务已启动，端口：${PORT}`);
    await initDatabase();
    console.log('✅ 环境变量验证通过');
    console.log('✅ 数据库连接成功');
    console.log('🎯 新增功能已适配：');
    console.log('   • 支持测试卡和改密卡两种类型');
    console.log('   • 分类秘钥管理（TG/超级管理员/普通管理员）');
    console.log('   • 测试卡和改密卡的功能限制');
    console.log('   • 秘钥详情查看功能');
    console.log('   • 批量操作支持');
    console.log('🔑 超级管理员密钥:', SUPER_ADMIN_KEY);
    console.log('🎯 服务已就绪，等待请求...');
});
