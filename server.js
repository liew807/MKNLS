require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// 验证环境变量 - 只验证必要的
const requiredEnv = ['FIREBASE_API_KEY', 'RANK_URL'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error('缺少必要环境变量：', missingEnv.join(', '));
    process.exit(1); 
}

// 数据持久化功能
const DATA_FILE = path.join(__dirname, 'data.json');

// 加载持久化数据
function loadPersistentData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            console.log('从文件加载持久化数据成功');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('无法加载持久化数据，使用默认值:', error.message);
    }
    return {
        accessKeys: {},
        operationLogs: [],
        activeSessions: {},
        nextKeyId: 1,
        nextLogId: 1
    };
}

// 保存数据到文件
function savePersistentData() {
    try {
        const data = {
            accessKeys: Object.fromEntries(accessKeys),
            operationLogs: operationLogs,
            activeSessions: Object.fromEntries(activeSessions),
            nextKeyId: nextKeyId,
            nextLogId: nextLogId,
            lastSave: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('数据持久化保存成功');
    } catch (error) {
        console.error('保存数据失败:', error.message);
    }
}

// 初始化持久化数据
let persistentData = loadPersistentData();

// 使用持久化数据初始化存储
const accessKeys = new Map(Object.entries(persistentData.accessKeys));
const operationLogs = persistentData.operationLogs;
const activeSessions = new Map(Object.entries(persistentData.activeSessions));
let nextKeyId = persistentData.nextKeyId || 1;
let nextLogId = persistentData.nextLogId || 1;

// 定期保存数据（每5分钟）
setInterval(() => {
    savePersistentData();
}, 5 * 60 * 1000);

// 在进程退出时保存数据
process.on('SIGINT', () => {
    console.log('收到退出信号，保存数据...');
    savePersistentData();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('收到终止信号，保存数据...');
    savePersistentData();
    process.exit(0);
});

// 密钥生成函数
function generateAccessKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 15; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// 添加操作日志
function addLog(action, user, key, details = '') {
    const log = {
        id: nextLogId++,
        action,
        user,
        key,
        details,
        time: new Date().toISOString()
    };
    
    operationLogs.push(log);
    
    if (operationLogs.length > 1000) {
        operationLogs.splice(0, 100);
    }
    
    savePersistentData();
}

// 超级管理员密钥
const SUPER_ADMIN_KEY = 'cpmMKNLS';

// 1. 检查秘钥接口 - 对应前端的 handleCheckKey
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查是否是超级管理员秘钥
        if (key === SUPER_ADMIN_KEY) {
            const sessionId = 'super_admin_' + Date.now();
            activeSessions.set(sessionId, {
                userId: 'super_admin',
                email: 'super_admin@mknls.com',
                role: 'super_admin',
                startTime: new Date(),
                lastActivity: new Date()
            });

            addLog('super_admin_login', 'super_admin', key, '超级管理员登录');

            return res.json({
                success: true,
                message: "超级管理员登录成功",
                isAdmin: true,
                isSuperAdmin: true,
                needsChoice: true
            });
        }

        // 检查普通秘钥
        const keyData = accessKeys.get(key);
        
        if (!keyData) {
            addLog('key_verification', email || 'unknown', key, '验证失败');
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }
        
        if (keyData.status !== 'active') {
            addLog('key_verification', email || 'unknown', key, '验证失败');
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }
        
        if (new Date(keyData.expiryTime) < new Date()) {
            keyData.status = 'expired';
            savePersistentData();
            addLog('key_verification', email || 'unknown', key, '验证失败');
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查绑定状态
        const boundEmails = keyData.boundEmails || [];
        const isEmailBound = email && boundEmails.includes(email);
        const bindCount = boundEmails.length;
        const maxBind = keyData.maxBind || 3;
        const remainingBinds = Math.max(0, maxBind - bindCount);

        // 如果是管理员秘钥
        if (keyData.isAdmin) {
            const sessionId = 'admin_' + Date.now();
            activeSessions.set(sessionId, {
                userId: keyData.addedBy || 'admin',
                email: keyData.addedByEmail || 'admin@mknls.com',
                role: 'admin',
                isSuperAdmin: keyData.isSuperAdmin || false,
                startTime: new Date(),
                lastActivity: new Date()
            });

            addLog('admin_login', keyData.addedBy || 'admin', key, '管理员登录');

            return res.json({
                success: true,
                message: "管理员登录成功",
                isAdmin: true,
                isSuperAdmin: keyData.isSuperAdmin || false,
                needsChoice: true,
                isTestCard: keyData.isTestCard || false
            });
        }

        // 普通用户秘钥
        addLog('key_verification', email || 'unknown', key, '秘钥验证成功');

        res.json({
            success: true,
            message: "秘钥验证成功",
            expiryTime: keyData.expiryTime,
            isAdmin: false,
            isTestCard: keyData.isTestCard || false,
            bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            durationHours: keyData.durationHours,
            cardType: keyData.cardType
        });

    } catch (error) {
        addLog('key_verification', 'unknown', 'unknown', '验证失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 2. 登录接口 - 对应前端的 handleLogin
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
            addLog('user_login', email, key || 'N/A', '登录失败');
            return res.status(400).json({
                success: false,
                message: "登录失败，请检查账号密码"
            });
        }

        const sessionId = 'user_' + Date.now();
        activeSessions.set(sessionId, {
            userId: firebaseData.localId,
            email: firebaseData.email,
            role: 'user',
            startTime: new Date(),
            lastActivity: new Date()
        });

        // 如果提供了秘钥，绑定邮箱到秘钥
        if (key) {
            const keyData = accessKeys.get(key);
            if (keyData) {
                if (!keyData.boundEmails) {
                    keyData.boundEmails = [];
                }
                if (!keyData.boundEmails.includes(email)) {
                    if (keyData.boundEmails.length >= (keyData.maxBind || 3)) {
                        return res.status(400).json({
                            success: false,
                            message: "该秘钥绑定数量已达上限"
                        });
                    }
                    keyData.boundEmails.push(email);
                    
                    // 记录绑定账号信息
                    if (!keyData.boundAccounts) {
                        keyData.boundAccounts = [];
                    }
                    keyData.boundAccounts.push({
                        email: email,
                        password: Buffer.from(password).toString('base64'),
                        bindTime: new Date().toISOString(),
                        lastLogin: new Date().toISOString()
                    });
                    
                    savePersistentData();
                    addLog('email_binding', email, key, `邮箱绑定到秘钥`);
                } else {
                    // 更新最后登录时间
                    const account = keyData.boundAccounts.find(acc => acc.email === email);
                    if (account) {
                        account.lastLogin = new Date().toISOString();
                        savePersistentData();
                    }
                }
            }
        }

        addLog('user_login', email, key || 'N/A', '用户登录成功');

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
        addLog('user_login', email || 'unknown', key || 'N/A', '登录失败');
        res.status(400).json({
            success: false,
            message: "登录失败"
        });
    }
});

// 3. 刷King等级接口 - 对应前端的 handleKingRank
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
            addLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败');
            return res.status(400).json({
                success: false,
                message: "刷King等级失败"
            });
        }

        // 记录操作日志
        const sessionId = Object.keys(Object.fromEntries(activeSessions)).find(sid => {
            const session = activeSessions.get(sid);
            return session && session.idToken === idToken;
        });
        
        if (sessionId) {
            const session = activeSessions.get(sessionId);
            addLog('set_king_rank', session.email, 'N/A', '刷King等级成功');
        }

        res.json({
            success: true,
            message: "刷King等级成功"
        });

    } catch (error) {
        addLog('set_king_rank', 'unknown', 'N/A', '刷King等级失败');
        res.status(400).json({
            success: false,
            message: "刷King等级失败"
        });
    }
});

// 4. 修改邮箱接口 - 对应前端的 handleChangeEmail
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
            const keyData = accessKeys.get(key);
            if (keyData && keyData.isTestCard) {
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
            addLog('change_email', oldEmail || 'unknown', key || 'N/A', '修改邮箱失败');
            return res.status(400).json({
                success: false,
                message: "修改邮箱失败"
            });
        }

        // 更新秘钥绑定的邮箱信息
        if (key && oldEmail) {
            const keyData = accessKeys.get(key);
            if (keyData && keyData.boundEmails) {
                const emailIndex = keyData.boundEmails.indexOf(oldEmail);
                if (emailIndex !== -1) {
                    keyData.boundEmails[emailIndex] = newEmail;
                    
                    // 更新绑定账号信息
                    if (keyData.boundAccounts) {
                        const account = keyData.boundAccounts.find(acc => acc.email === oldEmail);
                        if (account) {
                            account.email = newEmail;
                        }
                    }
                    savePersistentData();
                }
            }
        }

        addLog('change_email', oldEmail || 'unknown', key || 'N/A', `修改邮箱成功：${oldEmail} -> ${newEmail}`);

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                idToken: firebaseData.idToken
            },
            message: "修改邮箱成功"
        });

    } catch (error) {
        addLog('change_email', 'unknown', 'N/A', '修改邮箱失败');
        res.status(400).json({
            success: false,
            message: "修改邮箱失败"
        });
    }
});

// 5. 修改密码接口 - 对应前端的 handleChangePassword
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
            const keyData = accessKeys.get(key);
            if (keyData && keyData.isTestCard) {
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
            addLog('change_password', email || 'unknown', key || 'N/A', '修改密码失败');
            return res.status(400).json({
                success: false,
                message: "修改密码失败"
            });
        }

        // 更新秘钥绑定的密码信息
        if (key && email) {
            const keyData = accessKeys.get(key);
            if (keyData && keyData.boundAccounts) {
                const account = keyData.boundAccounts.find(acc => acc.email === email);
                if (account) {
                    account.password = Buffer.from(newPassword).toString('base64');
                    savePersistentData();
                }
            }
        }

        addLog('change_password', email || 'unknown', key || 'N/A', '修改密码成功');

        res.json({
            success: true,
            data: {
                idToken: firebaseData.idToken
            },
            message: "修改密码成功"
        });

    } catch (error) {
        addLog('change_password', 'unknown', 'N/A', '修改密码失败');
        res.status(400).json({
            success: false,
            message: "修改密码失败"
        });
    }
});

// 6. 管理员获取秘钥列表 - 对应前端的 fetchKeys
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
            const keyData = accessKeys.get(key);
            if (!keyData || !keyData.isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            isSuperAdmin = keyData.isSuperAdmin || false;
            adminInfo = { 
                name: keyData.addedByName || '管理员', 
                key: keyData.addedBy || 'unknown' 
            };
        }

        // 分类获取秘钥
        const allKeys = Array.from(accessKeys.values());
        
        // Telegram机器人生成的秘钥
        const tgKeys = allKeys.filter(k => k.addedBy === 'telegram_bot');
        
        // 超级管理人生成的秘钥
        const superAdminKeys = allKeys.filter(k => k.isSuperAdmin);
        
        // 普通管理人生成的秘钥（按管理员分组）
        const normalAdminKeys = allKeys.filter(k => k.isAdmin && !k.isSuperAdmin && k.addedBy !== 'telegram_bot');
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

        addLog('fetch_keys', adminInfo.name, key, '获取秘钥列表成功');

        res.json({
            success: true,
            keys: {
                telegram: tgKeys,
                superAdmin: superAdminKeys,
                normalAdmins: normalAdmins
            }
        });

    } catch (error) {
        addLog('fetch_keys', 'unknown', 'unknown', '获取秘钥列表失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 7. 管理员添加秘钥 - 对应前端的 handleAddKey
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
            const keyData = accessKeys.get(key);
            if (!keyData || !keyData.isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            isSuperAdmin = keyData.isSuperAdmin || false;
            adminInfo = { 
                name: keyData.addedByName || '管理员', 
                key: keyData.addedBy || 'unknown',
                email: keyData.addedByEmail 
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

        const keyData = {
            id: nextKeyId++,
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
            createdAt: now.toISOString(),
            cardType: isTestCard ? 'TEST_CARD' : (actualDuration >= 24 * 30 ? 'DIAMOND_EXCLUSIVE' : 'STANDARD')
        };
        
        accessKeys.set(newKey, keyData);
        
        addLog('generate_key', adminInfo.name, newKey, 
               `生成${isTestCard ? '测试卡' : '秘钥'}成功：${remark || '无备注'}`);

        res.json({
            success: true,
            key: newKey,
            message: `${isTestCard ? '测试卡' : '秘钥'}生成成功`
        });

    } catch (error) {
        addLog('generate_key', 'unknown', 'unknown', '生成秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 8. 管理员删除秘钥 - 对应前端的 handleDeleteKey
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
            const keyData = accessKeys.get(key);
            if (!keyData || !keyData.isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            adminInfo = { 
                name: keyData.addedByName || '管理员', 
                key: keyData.addedBy || 'unknown'
            };
        }

        const keyDataToDelete = accessKeys.get(keyToDelete);
        if (!keyDataToDelete) {
            return res.status(400).json({
                success: false,
                message: "验证失败"
            });
        }

        // 检查删除权限
        if (key !== SUPER_ADMIN_KEY && keyDataToDelete.addedBy !== adminInfo.key) {
            return res.status(403).json({
                success: false,
                message: "只能删除自己生成的秘钥"
            });
        }

        accessKeys.delete(keyToDelete);
        
        addLog('delete_key', adminInfo.name, keyToDelete, 
               `删除秘钥成功：${keyDataToDelete.remark || '无备注'}`);

        res.json({
            success: true,
            message: "秘钥删除成功"
        });

    } catch (error) {
        addLog('delete_key', 'unknown', 'unknown', '删除秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 9. 清理过期秘钥 - 对应前端的 handleCleanupExpiredKeys
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
            const keyData = accessKeys.get(key);
            if (!keyData || !keyData.isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败"
                });
            }
            adminInfo = { 
                name: keyData.addedByName || '管理员', 
                key: keyData.addedBy || 'unknown'
            };
        }

        const now = new Date();
        let deletedCount = 0;

        for (const [keyValue, keyData] of accessKeys.entries()) {
            if (new Date(keyData.expiryTime) < now) {
                accessKeys.delete(keyValue);
                deletedCount++;
            }
        }

        addLog('cleanup_keys', adminInfo.name, 'SYSTEM', 
               `清理过期秘钥成功，共删除 ${deletedCount} 个`);

        res.json({
            success: true,
            message: `成功清理 ${deletedCount} 个过期秘钥`,
            deletedCount: deletedCount
        });

    } catch (error) {
        addLog('cleanup_keys', 'unknown', 'SYSTEM', '清理过期秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败"
        });
    }
});

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Backend is running',
        activeSessions: activeSessions.size,
        accessKeys: accessKeys.size,
        operationLogs: operationLogs.length,
        persistence: true
    });
});

// 启动服务
app.listen(PORT, () => {
    console.log(`🚀 后端服务已启动，端口：${PORT}`);
    console.log(`🔑 超级管理员密钥: ${SUPER_ADMIN_KEY}`);
    console.log('✅ 环境变量验证通过');
    console.log('✅ 数据持久化已启用');
    console.log('🎯 服务已就绪，等待请求...');
});
