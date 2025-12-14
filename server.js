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
const SUPER_ADMIN_KEY = 'cpmMKNLS';

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

        // 创建管理员表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                admin_key VARCHAR(50) UNIQUE NOT NULL,
                admin_name VARCHAR(100) NOT NULL,
                admin_email VARCHAR(100),
                is_super_admin BOOLEAN DEFAULT FALSE,
                permissions JSONB DEFAULT '["view_keys", "add_keys", "delete_own_keys"]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);

        // 创建统计表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_stats (
                id SERIAL PRIMARY KEY,
                date DATE UNIQUE NOT NULL,
                total_keys INTEGER DEFAULT 0,
                active_keys INTEGER DEFAULT 0,
                expired_keys INTEGER DEFAULT 0,
                test_cards INTEGER DEFAULT 0,
                total_logins INTEGER DEFAULT 0,
                total_admin_actions INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 插入默认超级管理员
        await pool.query(`
            INSERT INTO admin_users (admin_key, admin_name, admin_email, is_super_admin, permissions)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (admin_key) DO NOTHING
        `, [
            SUPER_ADMIN_KEY,
            '超级管理员',
            'super@admin.com',
            true,
            JSON.stringify(["view_keys", "add_keys", "delete_keys", "cleanup_keys", "view_stats", "manage_admins"])
        ]);

        console.log('✅ 数据库表初始化完成');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    }
}

// ==================== 数据操作函数 ====================
async function getAllAccessKeys(showExpired = false) {
    let query = 'SELECT * FROM access_keys';
    if (!showExpired) {
        query += ' WHERE expiry_time > NOW() OR status = \'active\'';
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query);
    return result.rows;
}

async function getAccessKey(key) {
    const result = await pool.query('SELECT * FROM access_keys WHERE key = $1', [key]);
    return result.rows[0];
}

async function getAdminByKey(adminKey) {
    const result = await pool.query('SELECT * FROM admin_users WHERE admin_key = $1 AND is_active = TRUE', [adminKey]);
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

async function addOperationLog(action, user, key, details = '', req = null) {
    const query = `
        INSERT INTO operation_logs (action, user_email, key_used, details, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    `;
    
    const ipAddress = req?.ip || req?.headers['x-forwarded-for'] || req?.connection?.remoteAddress;
    const userAgent = req?.headers['user-agent'];
    
    const result = await pool.query(query, [action, user, key, details, ipAddress, userAgent]);
    return result.rows[0];
}

async function cleanupExpiredKeys() {
    const result = await pool.query(
        'DELETE FROM access_keys WHERE expiry_time < NOW() AND status != \'expired\' RETURNING *'
    );
    return result.rows;
}

async function updateSystemStats() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 获取统计数据
        const totalKeys = await pool.query('SELECT COUNT(*) FROM access_keys');
        const activeKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'active\' AND expiry_time > NOW()');
        const expiredKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'expired\' OR expiry_time < NOW()');
        const testCards = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_test_card = TRUE');
        const todayLogins = await pool.query('SELECT COUNT(*) FROM operation_logs WHERE action = \'user_login\' AND DATE(log_time) = $1', [today]);
        const adminActions = await pool.query('SELECT COUNT(*) FROM operation_logs WHERE action LIKE \'admin_%\' AND DATE(log_time) = $1', [today]);

        // 更新或插入统计
        await pool.query(`
            INSERT INTO system_stats (date, total_keys, active_keys, expired_keys, test_cards, total_logins, total_admin_actions)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (date) DO UPDATE SET
                total_keys = EXCLUDED.total_keys,
                active_keys = EXCLUDED.active_keys,
                expired_keys = EXCLUDED.expired_keys,
                test_cards = EXCLUDED.test_cards,
                total_logins = EXCLUDED.total_logins,
                total_admin_actions = EXCLUDED.total_admin_actions,
                updated_at = CURRENT_TIMESTAMP
        `, [
            today,
            parseInt(totalKeys.rows[0].count),
            parseInt(activeKeys.rows[0].count),
            parseInt(expiredKeys.rows[0].count),
            parseInt(testCards.rows[0].count),
            parseInt(todayLogins.rows[0].count),
            parseInt(adminActions.rows[0].count)
        ]);
    } catch (error) {
        console.error('更新统计失败:', error);
    }
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

function getCardType(durationHours, isTestCard) {
    if (isTestCard) return 'TEST_CARD';
    if (durationHours >= 24 * 30) return 'DIAMOND_EXCLUSIVE';
    if (durationHours >= 24 * 7) return 'PLATINUM';
    if (durationHours >= 24) return 'GOLD';
    return 'SILVER';
}

// ==================== 中间件 ====================
async function authMiddleware(req, res, next) {
    try {
        const { key } = req.query;
        
        if (!key) {
            return res.status(401).json({
                success: false,
                message: "未提供身份验证密钥"
            });
        }

        // 检查是否是超级管理员
        if (key === SUPER_ADMIN_KEY) {
            req.adminInfo = {
                adminKey: SUPER_ADMIN_KEY,
                adminName: '超级管理员',
                isSuperAdmin: true,
                permissions: ['view_keys', 'add_keys', 'delete_keys', 'cleanup_keys', 'view_stats', 'manage_admins']
            };
            return next();
        }

        // 检查普通管理员
        const adminData = await getAdminByKey(key);
        if (!adminData) {
            // 检查是否是普通密钥
            const keyData = await getAccessKey(key);
            if (!keyData) {
                return res.status(401).json({
                    success: false,
                    message: "身份验证失败"
                });
            }
            
            if (keyData.status !== 'active') {
                return res.status(401).json({
                    success: false,
                    message: "密钥未激活"
                });
            }
            
            if (new Date(keyData.expiry_time) < new Date()) {
                await updateAccessKey(key, { status: 'expired' });
                return res.status(401).json({
                    success: false,
                    message: "密钥已过期"
                });
            }
            
            req.keyData = keyData;
            return next();
        }

        req.adminInfo = {
            adminKey: adminData.admin_key,
            adminName: adminData.admin_name,
            isSuperAdmin: adminData.is_super_admin,
            permissions: adminData.permissions || []
        };
        next();
    } catch (error) {
        console.error('身份验证错误:', error);
        res.status(500).json({
            success: false,
            message: "身份验证失败"
        });
    }
}

async function adminAuthMiddleware(req, res, next) {
    await authMiddleware(req, res, () => {
        if (!req.adminInfo) {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }
        next();
    });
}

// ==================== API 路由 ====================

// 1. 检查秘钥接口
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        console.log('🔑 检查秘钥请求:', { key: key ? '有秘钥' : '无秘钥', email });

        if (!key) {
            await addOperationLog('key_verification', email || 'unknown', 'N/A', '验证失败: 未提供秘钥', req);
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查是否是超级管理员秘钥
        if (key === SUPER_ADMIN_KEY) {
            await addOperationLog('super_admin_login', 'super_admin', key, '超级管理员登录', req);

            return res.json({
                success: true,
                message: "超级管理员登录成功",
                isAdmin: true,
                isSuperAdmin: true,
                needsChoice: true
            });
        }

        // 检查管理员密钥
        const adminData = await getAdminByKey(key);
        if (adminData) {
            await addOperationLog('admin_login', adminData.admin_name || 'admin', key, '管理员登录', req);

            return res.json({
                success: true,
                message: "管理员登录成功",
                isAdmin: true,
                isSuperAdmin: adminData.is_super_admin || false,
                needsChoice: true
            });
        }

        // 检查普通秘钥
        const keyData = await getAccessKey(key);
        
        if (!keyData) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥不存在', req);
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥不存在"
            });
        }
        
        if (keyData.status !== 'active') {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥未激活', req);
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥未激活"
            });
        }
        
        if (new Date(keyData.expiry_time) < new Date()) {
            await updateAccessKey(key, { status: 'expired' });
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥已过期', req);
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
            isTestCard: keyData.is_test_card,
            boundCount: bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            expiry: keyData.expiry_time
        });

        // 普通用户秘钥 - 检查绑定限制
        if (remainingBinds <= 0 && !isEmailBound) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 绑定已满', req);
            return res.status(400).json({
                success: false,
                message: "该秘钥绑定数量已达上限",
                bindCount,
                maxBind,
                remainingBinds: 0,
                isEmailBound: false
            });
        }

        await addOperationLog('key_verification', email || 'unknown', key, '秘钥验证成功', req);

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
        await addOperationLog('key_verification', 'unknown', 'unknown', '验证失败: 服务器错误', req);
        res.status(500).json({
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
            await addOperationLog('user_login', email || 'unknown', key || 'N/A', '登录失败: 缺少参数', req);
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
                await addOperationLog('user_login', email, key, '登录失败: 无效秘钥', req);
                return res.status(400).json({
                    success: false,
                    message: "无效的秘钥"
                });
            }
            
            if (keyData.status !== 'active') {
                await addOperationLog('user_login', email, key, '登录失败: 秘钥未激活', req);
                return res.status(400).json({
                    success: false,
                    message: "秘钥未激活"
                });
            }
            
            if (new Date(keyData.expiry_time) < new Date()) {
                await updateAccessKey(key, { status: 'expired' });
                await addOperationLog('user_login', email, key, '登录失败: 秘钥已过期', req);
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
                    await addOperationLog('user_login', email, key, '登录失败: 绑定已达上限', req);
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
            await addOperationLog('user_login', email, key || 'N/A', `登录失败: ${errorMsg}`, req);
            
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
                
                await addOperationLog('email_binding', email, key, `邮箱绑定到秘钥成功`, req);
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

        // 更新管理员最后登录时间
        if (keyData?.is_admin) {
            await pool.query(
                'UPDATE admin_users SET last_login = NOW() WHERE admin_key = $1',
                [keyData.added_by]
            );
        }

        await addOperationLog('user_login', email, key || 'N/A', '用户登录成功', req);

        // 更新系统统计
        await updateSystemStats();

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
        await addOperationLog('user_login', 'unknown', 'N/A', '登录接口错误', req);
        res.status(500).json({
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

        const rankData = await rankResponse.json();

        if (!rankResponse.ok) {
            await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败', req);
            return res.status(400).json({
                success: false,
                message: "刷King等级失败",
                error: rankData
            });
        }

        await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级成功', req);

        res.json({
            success: true,
            message: "刷King等级成功",
            data: rankData
        });

    } catch (error) {
        console.error('❌ 刷King等级错误:', error);
        await addOperationLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败', req);
        res.status(500).json({
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
            await addOperationLog('change_email', oldEmail || 'unknown', key || 'N/A', '修改邮箱失败', req);
            return res.status(400).json({
                success: false,
                message: firebaseData.error?.message || "修改邮箱失败"
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

        await addOperationLog('change_email', oldEmail || 'unknown', key || 'N/A', `修改邮箱成功：${oldEmail} -> ${newEmail}`, req);

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                idToken: firebaseData.idToken
            },
            message: "修改邮箱成功"
        });

    } catch (error) {
        console.error('❌ 修改邮箱错误:', error);
        await addOperationLog('change_email', 'unknown', 'N/A', '修改邮箱失败', req);
        res.status(500).json({
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
            await addOperationLog('change_password', email || 'unknown', key || 'N/A', '修改密码失败', req);
            return res.status(400).json({
                success: false,
                message: firebaseData.error?.message || "修改密码失败"
            });
        }

        await addOperationLog('change_password', email || 'unknown', key || 'N/A', '修改密码成功', req);

        res.json({
            success: true,
            data: {
                idToken: firebaseData.idToken
            },
            message: "修改密码成功"
        });

    } catch (error) {
        console.error('❌ 修改密码错误:', error);
        await addOperationLog('change_password', 'unknown', 'N/A', '修改密码失败', req);
        res.status(500).json({
            success: false,
            message: "修改密码失败"
        });
    }
});

// ==================== 管理员API ====================

// 6. 获取所有管理员（仅超级管理员）
app.get('/api/admin/admins', adminAuthMiddleware, async (req, res) => {
    try {
        if (!req.adminInfo.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: "需要超级管理员权限"
            });
        }

        const admins = await pool.query('SELECT * FROM admin_users ORDER BY created_at DESC');
        const formattedAdmins = admins.rows.map(admin => ({
            adminKey: admin.admin_key,
            adminName: admin.admin_name,
            adminEmail: admin.admin_email,
            isSuperAdmin: admin.is_super_admin,
            permissions: admin.permissions,
            isActive: admin.is_active,
            createdAt: admin.created_at,
            lastLogin: admin.last_login
        }));

        await addOperationLog('get_admins', req.adminInfo.adminName, req.adminInfo.adminKey, '获取管理员列表', req);

        res.json({
            success: true,
            admins: formattedAdmins
        });

    } catch (error) {
        console.error('❌ 获取管理员错误:', error);
        await addOperationLog('get_admins', req.adminInfo.adminName, req.adminInfo.adminKey, '获取管理员列表失败', req);
        res.status(500).json({
            success: false,
            message: "获取管理员列表失败"
        });
    }
});

// 7. 创建新管理员（仅超级管理员）
app.post('/api/admin/admins', adminAuthMiddleware, async (req, res) => {
    try {
        if (!req.adminInfo.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: "需要超级管理员权限"
            });
        }

        const { adminName, adminEmail, permissions, isSuperAdmin } = req.body;
        
        if (!adminName) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员名称"
            });
        }

        // 生成管理员密钥
        const adminKey = generateAccessKey();
        const defaultPermissions = ['view_keys', 'add_keys', 'delete_own_keys'];

        await pool.query(`
            INSERT INTO admin_users (admin_key, admin_name, admin_email, is_super_admin, permissions)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            adminKey,
            adminName,
            adminEmail || null,
            isSuperAdmin || false,
            JSON.stringify(permissions || defaultPermissions)
        ]);

        await addOperationLog('create_admin', req.adminInfo.adminName, req.adminInfo.adminKey, `创建新管理员: ${adminName}`, req);

        res.json({
            success: true,
            message: "管理员创建成功",
            adminKey: adminKey
        });

    } catch (error) {
        console.error('❌ 创建管理员错误:', error);
        await addOperationLog('create_admin', req.adminInfo.adminName, req.adminInfo.adminKey, '创建管理员失败', req);
        res.status(500).json({
            success: false,
            message: "创建管理员失败"
        });
    }
});

// 8. 管理员获取秘钥列表
app.get('/api/admin/keys', adminAuthMiddleware, async (req, res) => {
    try {
        const { showExpired } = req.query;
        const { adminInfo } = req;

        console.log('📋 获取秘钥列表请求:', { adminName: adminInfo.adminName, isSuperAdmin: adminInfo.isSuperAdmin });

        // 获取所有秘钥
        const allKeys = await getAllAccessKeys(showExpired === 'true');
        
        // 格式化所有秘钥数据
        const formattedKeys = allKeys.map(formatKeyData);
        
        // 按来源分组
        const result = {
            telegram: [],      // Telegram机器人
            superAdmin: [],    // 超级管理员
            normalAdmins: {}   // 普通管理员（按管理员分组）
        };

        // 分类处理密钥
        formattedKeys.forEach(keyData => {
            if (keyData.addedBy === 'telegram_bot') {
                result.telegram.push(keyData);
            } else if (keyData.isSuperAdmin && keyData.addedBy === SUPER_ADMIN_KEY) {
                result.superAdmin.push(keyData);
            } else if (keyData.isAdmin || keyData.addedBy === adminInfo.adminKey) {
                // 按管理员分组
                const adminKey = keyData.addedBy;
                if (!result.normalAdmins[adminKey]) {
                    result.normalAdmins[adminKey] = {
                        adminKey: adminKey,
                        adminName: keyData.addedByName || '未知管理员',
                        keys: []
                    };
                }
                result.normalAdmins[adminKey].keys.push(keyData);
            }
        });

        // 获取统计数据
        const stats = await getSystemStats();

        await addOperationLog('fetch_keys', adminInfo.adminName, adminInfo.adminKey, '获取秘钥列表成功', req);

        res.json({
            success: true,
            keys: result,
            stats: stats
        });

    } catch (error) {
        console.error('❌ 获取秘钥列表错误:', error);
        await addOperationLog('fetch_keys', req.adminInfo.adminName, req.adminInfo.adminKey, '获取秘钥列表失败', req);
        res.status(500).json({
            success: false,
            message: "获取秘钥列表失败"
        });
    }
});

// 9. 生成新密钥
app.post('/api/admin/keys', adminAuthMiddleware, async (req, res) => {
    try {
        const { durationHours, maxBind, remark, isTestCard } = req.body;
        const { adminInfo } = req;

        if (!adminInfo.permissions.includes('add_keys')) {
            return res.status(403).json({
                success: false,
                message: "没有生成密钥的权限"
            });
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
            addedBy: adminInfo.adminKey,
            addedByName: adminInfo.adminName,
            addedByEmail: null,
            cardType: getCardType(actualDuration, isTestCard),
            activationTime: now.toISOString()
        };
        
        await createAccessKey(keyData);
        
        await addOperationLog('generate_key', adminInfo.adminName, newKey, 
               `生成${isTestCard ? '测试卡' : '秘钥'}成功：${remark || '无备注'}`, req);

        res.json({
            success: true,
            key: newKey,
            message: `${isTestCard ? '测试卡' : '秘钥'}生成成功`,
            keyData: formatKeyData(keyData)
        });

    } catch (error) {
        console.error('❌ 生成秘钥错误:', error);
        await addOperationLog('generate_key', req.adminInfo.adminName, 'unknown', '生成秘钥失败', req);
        res.status(500).json({
            success: false,
            message: "生成秘钥失败"
        });
    }
});

// 10. 删除密钥
app.delete('/api/admin/keys', adminAuthMiddleware, async (req, res) => {
    try {
        const { keyToDelete } = req.query;
        const { adminInfo } = req;

        if (!keyToDelete) {
            return res.status(400).json({
                success: false,
                message: "请提供要删除的密钥"
            });
        }

        // 获取要删除的密钥信息
        const keyData = await getAccessKey(keyToDelete);
        if (!keyData) {
            return res.status(404).json({
                success: false,
                message: "密钥不存在"
            });
        }

        // 权限检查
        const canDelete = checkDeletePermission(adminInfo, keyData);
        if (!canDelete) {
            return res.status(403).json({
                success: false,
                message: "没有删除该密钥的权限"
            });
        }

        // 删除密钥
        await deleteAccessKey(keyToDelete);
        
        await addOperationLog('delete_key', adminInfo.adminName, keyToDelete, 
               `删除秘钥成功：${keyData.remark || '无备注'}`, req);

        res.json({
            success: true,
            message: "密钥删除成功",
            deletedKey: keyToDelete
        });

    } catch (error) {
        console.error('❌ 删除密钥错误:', error);
        await addOperationLog('delete_key', req.adminInfo.adminName, 'unknown', '删除密钥失败', req);
        res.status(500).json({
            success: false,
            message: "删除密钥失败"
        });
    }
});

// 11. 清理过期密钥
app.post('/api/admin/cleanup-expired-keys', adminAuthMiddleware, async (req, res) => {
    try {
        const { adminInfo } = req;

        if (!adminInfo.permissions.includes('cleanup_keys')) {
            return res.status(403).json({
                success: false,
                message: "没有清理过期密钥的权限"
            });
        }

        const deletedKeys = await cleanupExpiredKeys();
        
        await addOperationLog('cleanup_keys', adminInfo.adminName, 'SYSTEM', 
               `清理过期秘钥成功，共删除 ${deletedKeys.length} 个`, req);

        res.json({
            success: true,
            message: `成功清理 ${deletedKeys.length} 个过期密钥`,
            deletedCount: deletedKeys.length,
            deletedKeys: deletedKeys.map(k => k.key)
        });

    } catch (error) {
        console.error('❌ 清理过期密钥错误:', error);
        await addOperationLog('cleanup_keys', req.adminInfo.adminName, 'SYSTEM', '清理过期密钥失败', req);
        res.status(500).json({
            success: false,
            message: "清理过期密钥失败"
        });
    }
});

// 12. 获取系统统计
app.get('/api/admin/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const { adminInfo } = req;

        if (!adminInfo.permissions.includes('view_stats')) {
            return res.status(403).json({
                success: false,
                message: "没有查看统计的权限"
            });
        }

        const stats = await getSystemStats();
        const recentLogs = await getRecentLogs(50);

        await addOperationLog('view_stats', adminInfo.adminName, adminInfo.adminKey, '查看系统统计', req);

        res.json({
            success: true,
            stats: stats,
            recentLogs: recentLogs,
            adminInfo: adminInfo
        });

    } catch (error) {
        console.error('❌ 获取统计错误:', error);
        await addOperationLog('view_stats', req.adminInfo.adminName, req.adminInfo.adminKey, '获取统计失败', req);
        res.status(500).json({
            success: false,
            message: "获取统计失败"
        });
    }
});

// ==================== 辅助函数 ====================
async function getSystemStats() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 获取今日统计
        const todayStats = await pool.query(
            'SELECT * FROM system_stats WHERE date = $1',
            [today]
        );
        
        // 获取总体统计
        const totalKeys = await pool.query('SELECT COUNT(*) FROM access_keys');
        const activeKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'active\' AND expiry_time > NOW()');
        const expiredKeys = await pool.query('SELECT COUNT(*) FROM access_keys WHERE status = \'expired\' OR expiry_time < NOW()');
        const testCards = await pool.query('SELECT COUNT(*) FROM access_keys WHERE is_test_card = TRUE');
        const totalLogins = await pool.query('SELECT COUNT(*) FROM operation_logs WHERE action = \'user_login\'');
        const totalAdmins = await pool.query('SELECT COUNT(*) FROM admin_users WHERE is_active = TRUE');

        // 获取最近7天登录趋势
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const loginTrend = await pool.query(`
            SELECT DATE(log_time) as date, COUNT(*) as count
            FROM operation_logs 
            WHERE action = 'user_login' AND log_time >= $1
            GROUP BY DATE(log_time)
            ORDER BY date DESC
            LIMIT 7
        `, [sevenDaysAgo]);

        return {
            today: todayStats.rows[0] || {},
            totals: {
                totalKeys: parseInt(totalKeys.rows[0].count),
                activeKeys: parseInt(activeKeys.rows[0].count),
                expiredKeys: parseInt(expiredKeys.rows[0].count),
                testCards: parseInt(testCards.rows[0].count),
                totalLogins: parseInt(totalLogins.rows[0].count),
                totalAdmins: parseInt(totalAdmins.rows[0].count)
            },
            loginTrend: loginTrend.rows
        };
    } catch (error) {
        console.error('获取系统统计错误:', error);
        return {};
    }
}

async function getRecentLogs(limit = 50) {
    try {
        const result = await pool.query(
            'SELECT * FROM operation_logs ORDER BY log_time DESC LIMIT $1',
            [limit]
        );
        
        return result.rows.map(log => ({
            id: log.id,
            action: log.action,
            user: log.user_email,
            key: log.key_used,
            details: log.details,
            time: log.log_time,
            ip: log.ip_address
        }));
    } catch (error) {
        console.error('获取日志错误:', error);
        return [];
    }
}

function checkDeletePermission(adminInfo, keyData) {
    // 超级管理员可以删除所有密钥
    if (adminInfo.isSuperAdmin) return true;
    
    // 检查是否有delete_keys权限
    if (adminInfo.permissions.includes('delete_keys')) return true;
    
    // 检查是否有delete_own_keys权限且密钥是自己生成的
    if (adminInfo.permissions.includes('delete_own_keys') && keyData.added_by === adminInfo.adminKey) {
        return true;
    }
    
    return false;
}

// ==================== 其他API ====================

// 13. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        const logsCount = await pool.query('SELECT COUNT(*) FROM operation_logs');
        const adminsCount = await pool.query('SELECT COUNT(*) FROM admin_users');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            timestamp: new Date().toISOString(),
            database: 'connected',
            stats: {
                accessKeys: parseInt(keysCount.rows[0].count),
                operationLogs: parseInt(logsCount.rows[0].count),
                adminUsers: parseInt(adminsCount.rows[0].count)
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

// 14. 获取服务器时间
app.get('/api/time', (req, res) => {
    res.json({
        serverTime: new Date().toISOString(),
        timestamp: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
});

// 15. 重置测试数据（仅开发环境）
if (process.env.NODE_ENV === 'development') {
    app.post('/api/dev/reset-test-data', async (req, res) => {
        try {
            // 清除所有数据
            await pool.query('DELETE FROM access_keys');
            await pool.query('DELETE FROM operation_logs');
            await pool.query('DELETE FROM system_stats');
            
            // 创建一些测试密钥
            const testKeys = [
                {
                    key: generateAccessKey(),
                    remark: '测试卡 - 1小时',
                    durationHours: 1,
                    maxBind: 1,
                    isTestCard: true
                },
                {
                    key: generateAccessKey(),
                    remark: '24小时密钥',
                    durationHours: 24,
                    maxBind: 3
                },
                {
                    key: generateAccessKey(),
                    remark: '7天密钥',
                    durationHours: 168,
                    maxBind: 5
                }
            ];
            
            for (const keyData of testKeys) {
                const now = new Date();
                const expiryTime = new Date(now);
                expiryTime.setHours(expiryTime.getHours() + keyData.durationHours);
                
                await createAccessKey({
                    key: keyData.key,
                    remark: keyData.remark,
                    expiryTime: expiryTime.toISOString(),
                    status: 'active',
                    isAdmin: false,
                    isTestCard: keyData.isTestCard || false,
                    durationHours: keyData.durationHours,
                    maxBind: keyData.maxBind,
                    boundEmails: [],
                    boundAccounts: [],
                    addedBy: SUPER_ADMIN_KEY,
                    addedByName: '超级管理员',
                    addedByEmail: null,
                    cardType: getCardType(keyData.durationHours, keyData.isTestCard),
                    activationTime: now.toISOString()
                });
            }
            
            res.json({
                success: true,
                message: '测试数据重置成功',
                testKeys: testKeys.map(k => k.key)
            });
        } catch (error) {
            console.error('重置测试数据错误:', error);
            res.status(500).json({
                success: false,
                message: '重置测试数据失败'
            });
        }
    });
}

// ==================== 错误处理中间件 ====================
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: `找不到路由: ${req.originalUrl}`,
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    console.error('❌ 服务器错误:', err);
    
    addOperationLog('server_error', 'system', 'N/A', `服务器错误: ${err.message}`, req);
    
    res.status(500).json({
        success: false,
        message: '服务器内部错误',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
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
    console.log('║ 🔑 超级管理员密钥已安全存储在服务器端            ║');
    console.log('║ 📊 数据库连接: 初始化中...                       ║');
    console.log('╠══════════════════════════════════════════════════╣');
    
    await initDatabase();
    
    console.log('║ ✅ 数据库初始化完成                              ║');
    console.log('║ ✅ 环境变量验证通过                              ║');
    console.log('║ ✅ 中间件加载完成                                ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║ 🌐 服务地址: http://localhost:' + PORT + '         ║');
    console.log('║ 📍 健康检查: http://localhost:' + PORT + '/api/health ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('\n🎯 服务已就绪，等待请求...');
    console.log('📝 日志输出已启用，按 Ctrl+C 停止服务\n');
});

// 优雅关闭
process.on('SIGINT', async () => {
    console.log('\n🔻 正在关闭服务...');
    try {
        await pool.end();
        console.log('✅ 数据库连接已关闭');
        process.exit(0);
    } catch (err) {
        console.error('❌ 关闭数据库连接失败:', err);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🔻 收到终止信号，正在关闭服务...');
    try {
        await pool.end();
        console.log('✅ 数据库连接已关闭');
        process.exit(0);
    } catch (err) {
        console.error('❌ 关闭数据库连接失败:', err);
        process.exit(1);
    }
});
