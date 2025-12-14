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

// 验证环境变量
const requiredEnv = ['FIREBASE_API_KEY', 'RANK_URL', 'DATABASE_URL'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error('❌ 缺少必要环境变量：', missingEnv.join(', '));
    process.exit(1);
}

// 超级管理员密钥（现在只存在于后端）
const SUPER_ADMIN_KEY = 'Liew1201@';

// ==================== 数据库初始化 ====================
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
                duration_hours INTEGER DEFAULT 24,
                max_bind INTEGER DEFAULT 3,
                bound_emails TEXT[] DEFAULT '{}',
                added_by VARCHAR(100),
                added_by_name VARCHAR(100),
                added_by_email VARCHAR(100),
                card_type VARCHAR(50) DEFAULT 'STANDARD',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                activation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                bound_accounts JSONB DEFAULT '[]',
                telegram_user JSONB DEFAULT NULL,
                application_info JSONB DEFAULT NULL
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
                ip_address VARCHAR(45),
                user_agent TEXT,
                log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ 数据库表初始化完成');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    }
}

// ==================== 数据操作函数 ====================
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
            is_test_card, duration_hours, max_bind, added_by, added_by_name, 
            added_by_email, card_type, bound_emails, bound_accounts, activation_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        keyData.durationHours || 24,
        keyData.maxBind || 3,
        keyData.addedBy,
        keyData.addedByName,
        keyData.addedByEmail,
        keyData.cardType || 'STANDARD',
        keyData.boundEmails || [],
        JSON.stringify(keyData.boundAccounts || []),
        keyData.activationTime || new Date().toISOString()
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
        } else {
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

async function cleanupExpiredKeys() {
    const result = await pool.query(
        'DELETE FROM access_keys WHERE expiry_time < NOW() RETURNING *'
    );
    return result.rows;
}

// ==================== 辅助函数 ====================
function formatKeyData(keyData) {
    return {
        key: keyData.key,
        remark: keyData.remark || '无',
        expiryTime: keyData.expiry_time,
        status: keyData.status,
        isActivated: keyData.status === 'active',
        boundEmails: keyData.bound_emails || [],
        maxBind: keyData.max_bind || 3,
        isTestCard: keyData.is_test_card || false,
        isAdmin: keyData.is_admin || false,
        isSuperAdmin: keyData.is_super_admin || false,
        addedByName: keyData.added_by_name || '未知',
        addedBy: keyData.added_by || 'unknown',
        addedByEmail: keyData.added_by_email,
        telegramUser: keyData.telegram_user,
        applicationInfo: keyData.application_info,
        boundAccounts: keyData.bound_accounts || [],
        durationHours: keyData.duration_hours,
        cardType: keyData.card_type,
        activationTime: keyData.activation_time,
        createdAt: keyData.created_at
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

// ==================== API 路由 ====================

// 1. 检查秘钥接口
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        console.log('🔑 检查秘钥请求:', { key: key ? '有秘钥' : '无秘钥', email });

        if (!key) {
            await addOperationLog('key_verification', email || 'unknown', 'N/A', '验证失败: 未提供秘钥');
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
                needsChoice: true
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

        console.log('📊 秘钥状态:', {
            key,
            isAdmin: keyData.is_admin,
            isTestCard: keyData.is_test_card,
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
                isTestCard: keyData.is_test_card || false
            });
        }

        // 普通用户秘钥 - 检查绑定限制
        if (remainingBinds <= 0 && !isEmailBound) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 绑定已满');
            return res.status(400).json({
                success: false,
                message: "该秘钥绑定数量已达上限",
                bindCount,
                maxBind,
                remainingBinds: 0,
                isEmailBound: false
            });
        }

        await addOperationLog('key_verification', email || 'unknown', key, '秘钥验证成功');

        res.json({
            success: true,
            message: "秘钥验证成功",
            expiryTime: keyData.expiry_time,
            isAdmin: false,
            isTestCard: keyData.is_test_card || false,
            bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            durationHours: keyData.duration_hours,
            cardType: keyData.card_type
        });

    } catch (error) {
        console.error('❌ 检查秘钥错误:', error);
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

        console.log('🔐 登录请求:', { email, key: key || '无秘钥' });

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        // 如果提供了秘钥，先验证秘钥状态
        let keyData = null;
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
                expiresIn: firebaseData.expiresIn
            },
            message: "登录成功"
        });

    } catch (error) {
        console.error('❌ 登录接口错误:', error);
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

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "请提供有效的身份令牌"
            });
        }

        const idToken = authHeader.split(' ')[1];

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
            await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败');
            return res.status(400).json({
                success: false,
                message: "刷King等级失败"
            });
        }

        await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级成功');

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

        // 检查是否是测试卡
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.is_test_card) {
                return res.status(403).json({
                    success: false,
                    message: "测试卡不支持修改邮箱功能"
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

// 6. 管理员获取秘钥列表
app.get('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 验证管理员权限
        let isSuperAdmin = false;
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { name: '超级管理员', key: SUPER_ADMIN_KEY };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown' 
            };
        }

        // 获取所有秘钥
        const allKeys = await getAllAccessKeys();
        
        // 格式化所有秘钥数据
        const formattedKeys = allKeys.map(formatKeyData);
        
        // Telegram机器人生成的秘钥
        const tgKeys = formattedKeys.filter(k => k.addedBy === 'telegram_bot');
        
        // 超级管理人生成的秘钥
        const superAdminKeys = formattedKeys.filter(k => k.isSuperAdmin && k.addedBy === SUPER_ADMIN_KEY);
        
        // 普通管理人生成的秘钥（按管理员分组）
        const normalAdminKeys = formattedKeys.filter(k => k.isAdmin && !k.isSuperAdmin && k.addedBy !== 'telegram_bot');
        
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

        await addOperationLog('fetch_keys', adminInfo.name, key, '获取秘钥列表成功');

        res.json({
            success: true,
            keys: {
                telegram: tgKeys,
                superAdmin: superAdminKeys,
                normalAdmins: normalAdmins
            }
        });

    } catch (error) {
        console.error('❌ 获取秘钥列表错误:', error);
        await addOperationLog('fetch_keys', 'unknown', 'unknown', '获取秘钥列表失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 7. 管理员添加秘钥
app.post('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;
        const { durationHours, maxBind, remark, isTestCard } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 验证管理员权限
        let isSuperAdmin = false;
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { name: '超级管理员', key: SUPER_ADMIN_KEY };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email 
            };
        }

        // 生成新秘钥
        const newKey = generateAccessKey();
        const now = new Date();
        
        // 设置过期时间
        let expiryTime = new Date(now);
        let actualDuration = durationHours || 24;
        let actualMaxBind = maxBind || 3;
        
        if (isTestCard) {
            actualDuration = 1; // 测试卡1小时
            actualMaxBind = 1;  // 测试卡只能绑定1个账号
        }
        
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        // 创建秘钥数据
        const keyData = {
            key: newKey,
            remark: remark || (isTestCard ? '测试卡' : '普通秘钥'),
            expiryTime: expiryTime.toISOString(),
            status: 'active',
            isAdmin: false,
            isSuperAdmin: false,
            isTestCard: isTestCard || false,
            durationHours: actualDuration,
            maxBind: actualMaxBind,
            boundEmails: [],
            boundAccounts: [],
            addedBy: adminInfo.key,
            addedByName: adminInfo.name,
            addedByEmail: adminInfo.email,
            cardType: isTestCard ? 'TEST_CARD' : (actualDuration >= 24 * 30 ? 'DIAMOND_EXCLUSIVE' : 'STANDARD'),
            activationTime: now.toISOString()
        };
        
        await createAccessKey(keyData);
        
        await addOperationLog('generate_key', adminInfo.name, newKey, 
               `生成${isTestCard ? '测试卡' : '秘钥'}成功：${remark || '无备注'}`);

        res.json({
            success: true,
            key: newKey,
            message: `${isTestCard ? '测试卡' : '秘钥'}生成成功`
        });

    } catch (error) {
        console.error('❌ 生成秘钥错误:', error);
        await addOperationLog('generate_key', 'unknown', 'unknown', '生成秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
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
            adminInfo = { name: '超级管理员', key: SUPER_ADMIN_KEY };
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
                key: keyData.added_by || 'unknown'
            };
        }

        const keyDataToDelete = await getAccessKey(keyToDelete);
        if (!keyDataToDelete) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查删除权限
        if (key !== SUPER_ADMIN_KEY && keyDataToDelete.added_by !== adminInfo.key) {
            return res.status(403).json({
                success: false,
                message: "只能删除自己生成的秘钥"
            });
        }

        await deleteAccessKey(keyToDelete);
        
        await addOperationLog('delete_key', adminInfo.name, keyToDelete, 
               `删除秘钥成功：${keyDataToDelete.remark || '无备注'}`);

        res.json({
            success: true,
            message: "秘钥删除成功"
        });

    } catch (error) {
        console.error('❌ 删除秘钥错误:', error);
        await addOperationLog('delete_key', 'unknown', 'unknown', '删除秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 9. 清理过期秘钥
app.post('/api/admin/cleanup-expired-keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            adminInfo = { name: '超级管理员', key: SUPER_ADMIN_KEY };
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
                key: keyData.added_by || 'unknown'
            };
        }

        const deletedKeys = await cleanupExpiredKeys();
        
        await addOperationLog('cleanup_keys', adminInfo.name, 'SYSTEM', 
               `清理过期秘钥成功，共删除 ${deletedKeys.length} 个`);

        res.json({
            success: true,
            message: `成功清理 ${deletedKeys.length} 个过期秘钥`,
            deletedCount: deletedKeys.length
        });

    } catch (error) {
        console.error('❌ 清理过期秘钥错误:', error);
        await addOperationLog('cleanup_keys', 'unknown', 'SYSTEM', '清理过期秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 10. 创建管理员秘钥
app.post('/api/admin/create-admin-key', async (req, res) => {
    try {
        const { key } = req.query;
        const { adminName, isSuperAdmin, durationHours, maxBind } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 只有超级管理员可以创建新的管理员密钥
        if (key !== SUPER_ADMIN_KEY) {
            return res.status(403).json({
                success: false,
                message: "需要超级管理员权限"
            });
        }

        // 生成新的管理员密钥
        const adminKey = generateAccessKey();
        const now = new Date();
        let expiryTime = new Date(now);
        
        // 设置管理员密钥的过期时间（默认30天）
        const actualDuration = durationHours || 720; // 30天
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        const adminKeyData = {
            key: adminKey,
            remark: `${adminName}的管理员密钥${isSuperAdmin ? '（超级管理员）' : ''}`,
            expiryTime: expiryTime.toISOString(),
            status: 'active',
            isAdmin: true,
            isSuperAdmin: isSuperAdmin || false,
            isTestCard: false,
            durationHours: actualDuration,
            maxBind: maxBind || 3,
            boundEmails: [],
            boundAccounts: [],
            addedBy: SUPER_ADMIN_KEY,
            addedByName: '超级管理员',
            addedByEmail: 'super@admin.com',
            cardType: 'ADMIN',
            activationTime: now.toISOString()
        };

        await createAccessKey(adminKeyData);

        await addOperationLog('create_admin_key', '超级管理员', adminKey, 
               `创建新的管理员密钥：${adminName} ${isSuperAdmin ? '(超级管理员)' : ''}`);

        res.json({
            success: true,
            message: "管理员密钥创建成功",
            adminKey: adminKey,
            keyData: formatKeyData(adminKeyData)
        });

    } catch (error) {
        console.error('❌ 创建管理员密钥错误:', error);
        await addOperationLog('create_admin_key', 'unknown', 'unknown', '创建管理员密钥失败');
        res.status(500).json({
            success: false,
            message: "创建管理员密钥失败"
        });
    }
});

// 11. 获取系统统计信息
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(401).json({
                success: false,
                message: "需要身份验证"
            });
        }

        // 检查权限
        if (key !== SUPER_ADMIN_KEY) {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "需要管理员权限"
                });
            }
        }

        // 获取统计数据
        const totalKeys = await pool.query('SELECT COUNT(*) FROM access_keys');
        const activeKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'active\'');
        const expiredKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'expired\'');
        const testCards = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_test_card = TRUE');
        const adminKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_admin = TRUE');
        
        const todayLogins = await pool.query(
            'SELECT COUNT(*) FROM operation_logs WHERE action = \'user_login\' AND DATE(log_time) = CURRENT_DATE'
        );
        const totalLogins = await pool.query('SELECT COUNT(*) FROM operation_logs WHERE action = \'user_login\'');

        // 获取最近7天活动
        const recentActivity = await pool.query(`
            SELECT DATE(log_time) as date, COUNT(*) as count
            FROM operation_logs 
            WHERE log_time >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(log_time)
            ORDER BY date DESC
        `);

        await addOperationLog('view_stats', 'admin', key, '查看系统统计');

        res.json({
            success: true,
            stats: {
                totalKeys: parseInt(totalKeys.rows[0].count),
                activeKeys: parseInt(activeKeys.rows[0].count),
                expiredKeys: parseInt(expiredKeys.rows[0].count),
                testCards: parseInt(testCards.rows[0].count),
                adminKeys: parseInt(adminKeys.rows[0].count),
                todayLogins: parseInt(todayLogins.rows[0].count),
                totalLogins: parseInt(totalLogins.rows[0].count)
            },
            recentActivity: recentActivity.rows,
            serverTime: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ 获取统计信息错误:', error);
        await addOperationLog('view_stats', 'unknown', 'unknown', '获取统计信息失败');
        res.status(500).json({
            success: false,
            message: "获取统计信息失败"
        });
    }
});

// 12. 获取操作日志
app.get('/api/admin/logs', async (req, res) => {
    try {
        const { key, limit = 50 } = req.query;

        if (!key) {
            return res.status(401).json({
                success: false,
                message: "需要身份验证"
            });
        }

        // 检查权限
        if (key !== SUPER_ADMIN_KEY) {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "需要管理员权限"
                });
            }
        }

        const logs = await pool.query(
            'SELECT * FROM operation_logs ORDER BY log_time DESC LIMIT $1',
            [limit]
        );

        await addOperationLog('view_logs', 'admin', key, '查看操作日志');

        res.json({
            success: true,
            logs: logs.rows,
            total: logs.rows.length
        });

    } catch (error) {
        console.error('❌ 获取日志错误:', error);
        await addOperationLog('view_logs', 'unknown', 'unknown', '获取日志失败');
        res.status(500).json({
            success: false,
            message: "获取日志失败"
        });
    }
});

// 13. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        const logsCount = await pool.query('SELECT COUNT(*) FROM operation_logs');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            timestamp: new Date().toISOString(),
            database: 'connected',
            stats: {
                accessKeys: parseInt(keysCount.rows[0].count),
                operationLogs: parseInt(logsCount.rows[0].count)
            },
            version: '3.0.0',
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        console.error('健康检查错误:', error);
        res.status(500).json({
            status: 'error',
            message: '数据库连接失败',
            error: error.message
        });
    }
});

// 14. 获取服务器信息
app.get('/api/server-info', (req, res) => {
    res.json({
        serverTime: new Date().toISOString(),
        uptime: process.uptime(),
        version: '3.0.0',
        apiEndpoints: [
            '/api/check-key',
            '/api/login',
            '/api/king-rank',
            '/api/change-email',
            '/api/change-password',
            '/api/admin/keys',
            '/api/admin/stats',
            '/api/admin/logs',
            '/api/health'
        ]
    });
});

// 15. 重置密钥状态（开发使用）
if (process.env.NODE_ENV === 'development') {
    app.post('/api/dev/reset-key', async (req, res) => {
        try {
            const { key } = req.body;
            
            if (!key) {
                return res.status(400).json({
                    success: false,
                    message: "请提供密钥"
                });
            }

            const keyData = await getAccessKey(key);
            if (!keyData) {
                return res.status(404).json({
                    success: false,
                    message: "密钥不存在"
                });
            }

            // 重置绑定和状态
            await updateAccessKey(key, {
                status: 'active',
                bound_emails: [],
                bound_accounts: []
            });

            await addOperationLog('dev_reset_key', 'developer', key, '开发环境重置密钥');

            res.json({
                success: true,
                message: "密钥状态已重置",
                key: key
            });

        } catch (error) {
            console.error('❌ 重置密钥错误:', error);
            res.status(500).json({
                success: false,
                message: "重置密钥失败"
            });
        }
    });
}

// ==================== 错误处理 ====================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `找不到路由: ${req.originalUrl}`,
        timestamp: new Date().toISOString()
    });
});

// ==================== 启动服务 ====================
app.listen(PORT, async () => {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║           🚀 MKNLS 工具平台 V3.0                 ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║ 端口: ${PORT}                                      ║`);
    console.log(`║ 环境: ${process.env.NODE_ENV || 'development'}      ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║ 🔑 超级管理员密钥: cpmMKNLS                      ║');
    console.log('║ 📊 数据库连接: 初始化中...                       ║');
    
    try {
        await initDatabase();
        console.log('║ ✅ 数据库初始化完成                              ║');
        console.log('║ ✅ 环境变量验证通过                              ║');
        console.log('╠══════════════════════════════════════════════════╣');
        console.log('║ 🌐 服务地址: http://localhost:' + PORT + '         ║');
        console.log('║ 📍 API 地址: http://localhost:' + PORT + '/api/health ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log('\n🎯 服务已就绪，等待请求...\n');
    } catch (error) {
        console.error('║ ❌ 启动失败:', error);
        console.log('╚══════════════════════════════════════════════════╝');
        process.exit(1);
    }
});

// 进程退出时的处理
process.on('SIGINT', () => {
    console.log('\n\n🔻 正在关闭 MKNLS 服务...');
    console.log('👋 服务已停止');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n🔻 收到终止信号，正在关闭服务...');
    console.log('👋 服务已停止');
    process.exit(0);
});
