require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL 连接
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 卡类型配置
const CARD_TYPES = {
    TEST: {
        name: '测试卡',
        durationHours: 1,
        maxBind: 1,
        features: ['仅支持解锁成就功能', '不支持修改邮箱密码'],
        color: '#FF2D55',
        level: 'TEST'
    },
    BRONZE: {
        name: '青铜VIP',
        durationHours: 24,
        maxBind: 3,
        features: ['基础功能权限', '24小时有效期'],
        color: '#CD7F32',
        level: 'BRONZE'
    },
    SILVER: {
        name: '白银VIP',
        durationHours: 24 * 3,
        maxBind: 5,
        features: ['基础功能权限', '3天有效期', '更多绑定数量'],
        color: '#C0C0C0',
        level: 'SILVER'
    },
    GOLD: {
        name: '黄金VIP',
        durationHours: 24 * 7,
        maxBind: 10,
        features: ['完整功能权限', '7天有效期', '更多绑定数量'],
        color: '#FFD700',
        level: 'GOLD'
    },
    PLATINUM: {
        name: '白金VIP',
        durationHours: 24 * 30,
        maxBind: 20,
        features: ['完整功能权限', '30天有效期', '大量绑定数量', '优先支持'],
        color: '#E5E4E2',
        level: 'PLATINUM'
    },
    DIAMOND: {
        name: '至尊VIP',
        durationHours: 24 * 90,
        maxBind: 50,
        features: ['完整功能权限', '90天有效期', '超大绑定数量', '专属支持'],
        color: '#B9F2FF',
        level: 'DIAMOND'
    }
};

// 根据时长自动确定卡类型
function getCardTypeByDuration(durationHours, isTestCard = false) {
    if (isTestCard) return CARD_TYPES.TEST;
    
    if (durationHours >= 24 * 90) return CARD_TYPES.DIAMOND;
    if (durationHours >= 24 * 30) return CARD_TYPES.PLATINUM;
    if (durationHours >= 24 * 7) return CARD_TYPES.GOLD;
    if (durationHours >= 24 * 3) return CARD_TYPES.SILVER;
    return CARD_TYPES.BRONZE;
}

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
                duration_hours INTEGER DEFAULT 24,
                max_bind INTEGER DEFAULT 3,
                bound_emails TEXT[] DEFAULT '{}',
                added_by VARCHAR(100),
                added_by_name VARCHAR(100),
                added_by_email VARCHAR(100),
                card_type VARCHAR(50) DEFAULT 'BRONZE',
                card_level VARCHAR(50) DEFAULT 'BRONZE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                bound_accounts JSONB DEFAULT '[]'
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

        // 创建活跃会话表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS active_sessions (
                session_id VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL,
                role VARCHAR(20) NOT NULL,
                is_super_admin BOOLEAN DEFAULT FALSE,
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ 数据库表初始化完成');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    }
}

// 数据操作函数
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
            added_by_email, card_type, card_level, bound_emails, bound_accounts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
    `;
    
    const values = [
        keyData.key,
        keyData.remark,
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
        keyData.cardType || 'BRONZE',
        keyData.cardLevel || 'BRONZE',
        keyData.boundEmails || [],
        JSON.stringify(keyData.boundAccounts || [])
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function updateAccessKey(key, updates) {
    const setClause = [];
    const values = [];
    let paramCount = 1;

    for (const [field, value] of Object.entries(updates)) {
        if (field === 'boundAccounts') {
            setClause.push(`bound_accounts = $${paramCount}`);
            values.push(JSON.stringify(value));
        } else if (field === 'boundEmails') {
            setClause.push(`bound_emails = $${paramCount}`);
            values.push(value);
        } else {
            setClause.push(`${field} = $${paramCount}`);
            values.push(value);
        }
        paramCount++;
    }

    values.push(key);
    const query = `UPDATE access_keys SET ${setClause.join(', ')} WHERE key = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function deleteAccessKey(key) {
    const result = await pool.query('DELETE FROM access_keys WHERE key = $1', [key]);
    return result.rowCount > 0;
}

async function addOperationLog(log) {
    const query = `
        INSERT INTO operation_logs (action, user_email, key_used, details, log_time)
        VALUES ($1, $2, $3, $4, $5)
    `;
    
    const values = [
        log.action,
        log.user,
        log.key,
        log.details,
        log.time
    ];
    
    await pool.query(query, values);
}

async function getOperationLogs(limit = 100) {
    const result = await pool.query(
        'SELECT * FROM operation_logs ORDER BY log_time DESC LIMIT $1',
        [limit]
    );
    return result.rows;
}

async function addActiveSession(session) {
    const query = `
        INSERT INTO active_sessions (session_id, user_id, email, role, is_super_admin, start_time, last_activity)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_id) 
        DO UPDATE SET last_activity = $7
    `;
    
    const values = [
        session.sessionId,
        session.userId,
        session.email,
        session.role,
        session.isSuperAdmin || false,
        session.startTime,
        session.lastActivity
    ];
    
    await pool.query(query, values);
}

async function getActiveSession(sessionId) {
    const result = await pool.query('SELECT * FROM active_sessions WHERE session_id = $1', [sessionId]);
    return result.rows[0];
}

async function deleteActiveSession(sessionId) {
    await pool.query('DELETE FROM active_sessions WHERE session_id = $1', [sessionId]);
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

// 超级管理员密钥
const SUPER_ADMIN_KEY = 'cpmMKNLS';

// 初始化数据库
initDatabase();

// 1. 检查秘钥接口
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "请提供访问秘钥"
            });
        }

        // 检查是否是超级管理员秘钥
        if (key === SUPER_ADMIN_KEY) {
            const sessionId = 'super_admin_' + Date.now();
            await addActiveSession({
                sessionId,
                userId: 'super_admin',
                email: 'super_admin@mknls.com',
                role: 'super_admin',
                isSuperAdmin: true,
                startTime: new Date(),
                lastActivity: new Date()
            });

            await addOperationLog({
                action: 'super_admin_login',
                user: 'super_admin',
                key: key,
                details: '超级管理员登录',
                time: new Date().toISOString()
            });

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
            return res.status(400).json({
                success: false,
                message: "秘钥不存在"
            });
        }
        
        if (keyData.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: "秘钥已失效"
            });
        }
        
        // 检查是否过期
        if (new Date(keyData.expiry_time) < new Date()) {
            await updateAccessKey(key, { status: 'expired' });
            return res.status(400).json({
                success: false,
                message: "秘钥已过期"
            });
        }

        // 检查绑定状态
        const boundEmails = keyData.bound_emails || [];
        const isEmailBound = email && boundEmails.includes(email);
        const bindCount = boundEmails.length;
        const maxBind = keyData.max_bind || 3;
        const remainingBinds = Math.max(0, maxBind - bindCount);

        // 获取卡类型信息
        const cardType = CARD_TYPES[keyData.card_level] || CARD_TYPES.BRONZE;

        // 如果是管理员秘钥
        if (keyData.is_admin) {
            const sessionId = 'admin_' + Date.now();
            await addActiveSession({
                sessionId,
                userId: keyData.added_by || 'admin',
                email: keyData.added_by_email || 'admin@mknls.com',
                role: 'admin',
                isSuperAdmin: keyData.is_super_admin || false,
                startTime: new Date(),
                lastActivity: new Date()
            });

            await addOperationLog({
                action: 'admin_login',
                user: keyData.added_by || 'admin',
                key: key,
                details: '管理员登录',
                time: new Date().toISOString()
            });

            return res.json({
                success: true,
                message: "管理员登录成功",
                isAdmin: true,
                isSuperAdmin: keyData.is_super_admin || false,
                needsChoice: true,
                isTestCard: keyData.is_test_card || false
            });
        }

        // 普通用户秘钥
        await addOperationLog({
            action: 'key_verification',
            user: email || 'unknown',
            key: key,
            details: '秘钥验证成功',
            time: new Date().toISOString()
        });

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
            cardType: keyData.card_type,
            cardLevel: keyData.card_level,
            cardName: cardType.name
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 2. 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, key } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        // 验证Firebase账号
        const firebaseResponse = await fetch(
            `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${process.env.FIREBASE_API_KEY}`,
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
            throw new Error(
                firebaseData.error?.message || "登录失败，请检查账号密码"
            );
        }

        // 如果提供了秘钥，绑定邮箱到秘钥
        if (key) {
            const keyData = await getAccessKey(key);
            if (keyData) {
                const boundEmails = keyData.bound_emails || [];
                if (!boundEmails.includes(email)) {
                    if (boundEmails.length >= (keyData.max_bind || 3)) {
                        throw new Error("该秘钥绑定数量已达上限");
                    }
                    
                    const newBoundEmails = [...boundEmails, email];
                    let boundAccounts = keyData.bound_accounts || [];
                    if (typeof boundAccounts === 'string') {
                        boundAccounts = JSON.parse(boundAccounts);
                    }
                    
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
                    
                    await addOperationLog({
                        action: 'email_binding',
                        user: email,
                        key: key,
                        details: '邮箱绑定到秘钥',
                        time: new Date().toISOString()
                    });
                } else {
                    // 更新最后登录时间
                    let boundAccounts = keyData.bound_accounts || [];
                    if (typeof boundAccounts === 'string') {
                        boundAccounts = JSON.parse(boundAccounts);
                    }
                    
                    const account = boundAccounts.find(acc => acc.email === email);
                    if (account) {
                        account.lastLogin = new Date().toISOString();
                        await updateAccessKey(key, {
                            bound_accounts: boundAccounts
                        });
                    }
                }
            }
        }

        const sessionId = 'user_' + Date.now();
        await addActiveSession({
            sessionId,
            userId: firebaseData.localId,
            email: firebaseData.email,
            role: 'user',
            startTime: new Date(),
            lastActivity: new Date()
        });

        await addOperationLog({
            action: 'user_login',
            user: email,
            key: key || 'N/A',
            details: '用户登录成功',
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                sessionId,
                role: 'user',
                expiresIn: firebaseData.expiresIn
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 3. 管理员添加秘钥 - 支持多种卡类型
app.post('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;
        const { durationHours, maxBind, remark, isTestCard, cardType } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员秘钥"
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
                    message: "无管理员权限"
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
        
        // 根据卡类型设置参数
        let actualDuration, actualMaxBind, actualCardType, actualCardLevel;
        
        if (isTestCard) {
            // 测试卡
            actualDuration = CARD_TYPES.TEST.durationHours;
            actualMaxBind = CARD_TYPES.TEST.maxBind;
            actualCardType = CARD_TYPES.TEST.name;
            actualCardLevel = CARD_TYPES.TEST.level;
        } else if (cardType && CARD_TYPES[cardType]) {
            // 指定卡类型
            const selectedCard = CARD_TYPES[cardType];
            actualDuration = durationHours || selectedCard.durationHours;
            actualMaxBind = maxBind || selectedCard.maxBind;
            actualCardType = selectedCard.name;
            actualCardLevel = selectedCard.level;
        } else {
            // 根据时长自动确定卡类型
            const autoCardType = getCardTypeByDuration(durationHours || 24);
            actualDuration = durationHours || autoCardType.durationHours;
            actualMaxBind = maxBind || autoCardType.maxBind;
            actualCardType = autoCardType.name;
            actualCardLevel = autoCardType.level;
        }
        
        const expiryTime = new Date(now);
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        const keyData = {
            key: newKey,
            remark: remark || actualCardType,
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
            cardType: actualCardType,
            cardLevel: actualCardLevel
        };

        await createAccessKey(keyData);
        
        await addOperationLog({
            action: 'generate_key',
            user: adminInfo.name,
            key: newKey,
            details: `生成${actualCardType}：时长${actualDuration}小时，绑定${actualMaxBind}个`,
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            key: newKey,
            message: `${actualCardType}生成成功`,
            cardInfo: {
                type: actualCardType,
                level: actualCardLevel,
                duration: actualDuration,
                maxBind: actualMaxBind
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 4. 获取卡类型列表
app.get('/api/card-types', async (req, res) => {
    try {
        const cardTypesList = Object.entries(CARD_TYPES).map(([key, config]) => ({
            id: key,
            name: config.name,
            durationHours: config.durationHours,
            maxBind: config.maxBind,
            features: config.features,
            color: config.color,
            level: config.level
        }));

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

// 5. 管理员获取秘钥列表
app.get('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员秘钥"
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
                    message: "无管理员权限"
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
        
        // 分类秘钥
        const tgKeys = allKeys.filter(k => k.added_by === 'telegram_bot');
        const superAdminKeys = allKeys.filter(k => k.is_super_admin);
        const normalAdminKeys = allKeys.filter(k => k.is_admin && !k.is_super_admin && k.added_by !== 'telegram_bot');
        
        const normalAdmins = {};
        normalAdminKeys.forEach(keyData => {
            const adminKey = keyData.added_by;
            if (!normalAdmins[adminKey]) {
                normalAdmins[adminKey] = {
                    adminKey: adminKey,
                    adminName: keyData.added_by_name || '未知管理员',
                    keys: []
                };
            }
            normalAdmins[adminKey].keys.push(keyData);
        });

        await addOperationLog({
            action: 'fetch_keys',
            user: adminInfo.name,
            key: key,
            details: '获取秘钥列表',
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            keys: {
                telegram: tgKeys,
                superAdmin: superAdminKeys,
                normalAdmins: normalAdmins
            },
            cardTypes: CARD_TYPES
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 6. 管理员删除秘钥
app.delete('/api/admin/keys', async (req, res) => {
    try {
        const { key, keyToDelete } = req.query;

        if (!key || !keyToDelete) {
            return res.status(400).json({
                success: false,
                message: "请提供必要的参数"
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
                    message: "无管理员权限"
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
                message: "要删除的秘钥不存在"
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
        
        await addOperationLog({
            action: 'delete_key',
            user: adminInfo.name,
            key: keyToDelete,
            details: `删除秘钥：${keyDataToDelete.remark || '无备注'} (${keyDataToDelete.card_type})`,
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            message: "秘钥删除成功"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 7. 清理过期秘钥（手动触发）
app.post('/api/admin/cleanup-expired-keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员秘钥"
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
                    message: "无管理员权限"
                });
            }
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown'
            };
        }

        const result = await pool.query(
            'DELETE FROM access_keys WHERE expiry_time < $1 AND status = $2',
            [new Date(), 'active']
        );

        await addOperationLog({
            action: 'cleanup_keys',
            user: adminInfo.name,
            key: 'SYSTEM',
            details: `清理过期秘钥，共删除 ${result.rowCount} 个`,
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `成功清理 ${result.rowCount} 个过期秘钥`,
            deletedCount: result.rowCount
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 8. 修改邮箱接口
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
            throw new Error(
                firebaseData.error?.message || "修改邮箱失败"
            );
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
                    let boundAccounts = keyData.bound_accounts || [];
                    if (typeof boundAccounts === 'string') {
                        boundAccounts = JSON.parse(boundAccounts);
                    }
                    
                    const account = boundAccounts.find(acc => acc.email === oldEmail);
                    if (account) {
                        account.email = newEmail;
                    }
                    
                    await updateAccessKey(key, {
                        bound_emails: newBoundEmails,
                        bound_accounts: boundAccounts
                    });
                }
            }
        }

        await addOperationLog({
            action: 'change_email',
            user: oldEmail || 'unknown',
            key: key || 'N/A',
            details: `修改邮箱到 ${newEmail}`,
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                idToken: firebaseData.idToken
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 9. 修改密码接口
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
            throw new Error(
                firebaseData.error?.message || "修改密码失败"
            );
        }

        // 更新秘钥绑定的密码信息
        if (key && email) {
            const keyData = await getAccessKey(key);
            if (keyData && keyData.bound_accounts) {
                let boundAccounts = keyData.bound_accounts;
                if (typeof boundAccounts === 'string') {
                    boundAccounts = JSON.parse(boundAccounts);
                }
                
                const account = boundAccounts.find(acc => acc.email === email);
                if (account) {
                    account.password = Buffer.from(newPassword).toString('base64');
                    await updateAccessKey(key, {
                        bound_accounts: boundAccounts
                    });
                }
            }
        }

        await addOperationLog({
            action: 'change_password',
            user: email || 'unknown',
            key: key || 'N/A',
            details: '修改密码',
            time: new Date().toISOString()
        });

        res.json({
            success: true,
            data: {
                idToken: firebaseData.idToken
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 10. 设置国王等级接口
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
            throw new Error(`等级设置接口返回错误：${rankResponse.statusText}`);
        }

        // 记录操作日志
        const allSessions = await pool.query('SELECT * FROM active_sessions');
        const session = allSessions.rows.find(s => s.idToken === idToken);
        
        if (session) {
            await addOperationLog({
                action: 'set_king_rank',
                user: session.email,
                key: 'N/A',
                details: '设置国王等级成功',
                time: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: "国王等级设置成功"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 健康检查接口
app.get('/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        const logsCount = await pool.query('SELECT COUNT(*) FROM operation_logs');
        const sessionsCount = await pool.query('SELECT COUNT(*) FROM active_sessions');
        
        // 统计各卡类型数量
        const cardStats = await pool.query(`
            SELECT card_type, COUNT(*) as count 
            FROM access_keys 
            WHERE status = 'active' 
            GROUP BY card_type
        `);
        
        res.json({ 
            status: 'ok', 
            message: 'Backend is running with Multiple Card Types',
            accessKeys: parseInt(keysCount.rows[0].count),
            operationLogs: parseInt(logsCount.rows[0].count),
            activeSessions: parseInt(sessionsCount.rows[0].count),
            cardTypes: Object.keys(CARD_TYPES).length,
            cardStats: cardStats.rows,
            database: 'PostgreSQL'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 启动服务
app.listen(PORT, async () => {
    console.log(`🚀 后端服务已启动，端口：${PORT}`);
    console.log(`🎫 支持 ${Object.keys(CARD_TYPES).length} 种卡类型:`);
    Object.values(CARD_TYPES).forEach(card => {
        console.log(`   • ${card.name} - ${card.durationHours}小时 - ${card.maxBind}绑定`);
    });
    console.log('✅ 所有定时清除功能已删除 - 数据永久保存！');
    console.log(`🔑 超级管理员密钥: ${SUPER_ADMIN_KEY}`);
});
