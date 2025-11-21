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

// 验证环境变量
const requiredEnv = ['FIREBASE_API_KEY', 'RANK_URL', 'ADMIN_EMAILS', 'ADMIN_LOGIN_KEY'];
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
        licenseKeys: {},
        userKeyBindings: {}, // 用户ID -> 密钥
        keyUserBindings: {}, // 密钥 -> 用户ID数组（支持多用户）
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
            licenseKeys: Object.fromEntries(licenseKeys),
            userKeyBindings: userKeyBindings,
            keyUserBindings: keyUserBindings,
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
const licenseKeys = new Map(Object.entries(persistentData.licenseKeys));
const userKeyBindings = persistentData.userKeyBindings || {};
const keyUserBindings = persistentData.keyUserBindings || {};
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
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
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

// 1. 验证用户许可证密钥
app.post('/api/verify-key', async (req, res) => {
    try {
        const { licenseKey, keyType = 'user' } = req.body;

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                message: "请提供许可证密钥"
            });
        }

        // 管理员密钥验证
        if (keyType === 'admin' && licenseKey === process.env.ADMIN_LOGIN_KEY) {
            const sessionId = 'admin_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            activeSessions.set(sessionId, {
                userId: 'admin',
                email: 'administrator',
                role: 'admin',
                startTime: new Date(),
                lastActivity: new Date()
            });

            addLog('admin_login', 'administrator', 'ADMIN_KEY', '管理员通过密钥登录');
            return res.json({
                success: true,
                data: {
                    role: 'admin',
                    sessionId,
                    message: "管理员登录成功"
                }
            });
        }

        // 用户密钥验证
        const keyData = licenseKeys.get(licenseKey);
        
        if (!keyData) {
            return res.status(400).json({
                success: false,
                message: "密钥不存在"
            });
        }
        
        if (keyData.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: "密钥已失效"
            });
        }
        
        if (new Date(keyData.expiry) < new Date()) {
            keyData.status = 'expired';
            savePersistentData();
            return res.status(400).json({
                success: false,
                message: "密钥已过期"
            });
        }

        // 获取当前绑定用户数量
        const boundUsers = keyUserBindings[licenseKey] || [];
        const currentBindings = boundUsers.length;

        res.json({
            success: true,
            data: {
                key: keyData.key,
                note: keyData.note,
                expiry: keyData.expiry,
                status: keyData.status,
                keyType: 'user',
                maxUsers: keyData.maxUsers || 1, // 最大绑定用户数
                currentUsers: currentBindings,   // 当前绑定用户数
                usedBy: keyData.usedBy
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 2. 绑定密钥到用户（支持多用户绑定）
app.post('/api/bind-key', async (req, res) => {
    try {
        const { licenseKey, userId, email } = req.body;

        if (!licenseKey || !userId || !email) {
            return res.status(400).json({
                success: false,
                message: "请提供完整的参数"
            });
        }

        const keyData = licenseKeys.get(licenseKey);
        
        if (!keyData) {
            return res.status(400).json({
                success: false,
                message: "密钥不存在"
            });
        }

        // 检查用户是否已绑定其他密钥
        if (userKeyBindings[userId] && userKeyBindings[userId] !== licenseKey) {
            return res.status(400).json({
                success: false,
                message: "您的账号已绑定其他密钥"
            });
        }

        // 初始化密钥的用户绑定数组
        if (!keyUserBindings[licenseKey]) {
            keyUserBindings[licenseKey] = [];
        }

        const boundUsers = keyUserBindings[licenseKey];
        const maxUsers = keyData.maxUsers || 1;

        // 检查是否已达到最大绑定数量
        if (boundUsers.length >= maxUsers) {
            return res.status(400).json({
                success: false,
                message: `该密钥最多只能绑定 ${maxUsers} 个账号，已满额`
            });
        }

        // 检查用户是否已经绑定过这个密钥
        if (boundUsers.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: "您已经绑定过这个密钥"
            });
        }

        // 绑定密钥和用户
        boundUsers.push(userId);
        userKeyBindings[userId] = licenseKey;

        // 更新密钥的使用信息（记录第一个绑定的用户）
        if (!keyData.usedBy) {
            keyData.usedBy = userId;
            keyData.usedAt = new Date().toISOString();
            keyData.usedEmail = email;
        }

        addLog('bind_key', email, licenseKey, `用户绑定密钥: ${keyData.note} (${boundUsers.length}/${maxUsers})`);

        res.json({
            success: true,
            data: {
                key: keyData.key,
                note: keyData.note,
                expiry: keyData.expiry,
                bindTime: new Date().toISOString(),
                currentUsers: boundUsers.length,
                maxUsers: maxUsers
            },
            message: `密钥绑定成功 (${boundUsers.length}/${maxUsers})`
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 3. 获取用户绑定的密钥信息
app.get('/api/user-key/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const boundKey = userKeyBindings[userId];
        if (!boundKey) {
            return res.json({
                success: true,
                data: null,
                message: "用户未绑定任何密钥"
            });
        }

        const keyData = licenseKeys.get(boundKey);
        if (!keyData) {
            // 清理无效的绑定
            delete userKeyBindings[userId];
            if (keyUserBindings[boundKey]) {
                const index = keyUserBindings[boundKey].indexOf(userId);
                if (index > -1) {
                    keyUserBindings[boundKey].splice(index, 1);
                }
            }
            savePersistentData();
            return res.json({
                success: true,
                data: null,
                message: "绑定的密钥不存在"
            });
        }

        const boundUsers = keyUserBindings[boundKey] || [];
        
        res.json({
            success: true,
            data: {
                ...keyData,
                currentUsers: boundUsers.length,
                maxUsers: keyData.maxUsers || 1
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 4. 解绑用户密钥
app.post('/api/unbind-key', async (req, res) => {
    try {
        const { userId, licenseKey } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "请提供用户ID"
            });
        }

        const boundKey = userKeyBindings[userId];
        if (!boundKey) {
            return res.status(400).json({
                success: false,
                message: "用户未绑定任何密钥"
            });
        }

        // 如果提供了密钥，验证是否匹配
        if (licenseKey && boundKey !== licenseKey) {
            return res.status(400).json({
                success: false,
                message: "密钥与绑定不匹配"
            });
        }

        // 从密钥的用户列表中移除
        if (keyUserBindings[boundKey]) {
            const index = keyUserBindings[boundKey].indexOf(userId);
            if (index > -1) {
                keyUserBindings[boundKey].splice(index, 1);
            }
            // 如果密钥没有用户绑定了，清理使用信息
            if (keyUserBindings[boundKey].length === 0) {
                const keyData = licenseKeys.get(boundKey);
                if (keyData) {
                    keyData.usedBy = null;
                    keyData.usedAt = null;
                    keyData.usedEmail = null;
                }
            }
        }

        delete userKeyBindings[userId];
        addLog('unbind_key', userId, boundKey, '用户解绑密钥');

        res.json({
            success: true,
            message: "密钥解绑成功"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 5. 验证管理员密钥接口
app.post('/api/verify-admin-key', async (req, res) => {
    try {
        const { adminKey } = req.body;

        if (!adminKey) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员密钥"
            });
        }

        if (adminKey !== process.env.ADMIN_LOGIN_KEY) {
            return res.status(400).json({
                success: false,
                message: "管理员密钥错误"
            });
        }

        const sessionId = 'admin_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        activeSessions.set(sessionId, {
            userId: 'admin',
            email: 'administrator',
            role: 'admin',
            startTime: new Date(),
            lastActivity: new Date()
        });

        addLog('admin_login', 'administrator', 'ADMIN_KEY', '管理员通过密钥登录');

        res.json({
            success: true,
            data: {
                role: 'admin',
                sessionId,
                message: "管理员登录成功"
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 6. 登录接口（自动绑定密钥）
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, licenseKey } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

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

        const adminEmails = process.env.ADMIN_EMAILS.split(',');
        const role = adminEmails.includes(email) ? 'admin' : 'user';

        const sessionId = 'user_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        activeSessions.set(sessionId, {
            userId: firebaseData.localId,
            email: firebaseData.email,
            role,
            startTime: new Date(),
            lastActivity: new Date()
        });

        // 如果提供了密钥，自动绑定
        let bindResult = null;
        if (licenseKey && role === 'user') {
            try {
                const bindResponse = await fetch(`http://localhost:${PORT}/api/bind-key`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        licenseKey,
                        userId: firebaseData.localId,
                        email: firebaseData.email
                    })
                });
                bindResult = await bindResponse.json();
            } catch (bindError) {
                console.log('密钥绑定失败:', bindError.message);
            }
        }

        addLog('user_login', email, licenseKey || 'N/A', '用户登录系统');

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                sessionId,
                role,
                expiresIn: firebaseData.expiresIn,
                keyBind: bindResult
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 7. 生成新密钥（管理员功能）- 支持自定义绑定用户数量
app.post('/api/generate-key', async (req, res) => {
    try {
        const { note = '', expiryDays = 30, maxUsers = 1 } = req.body;
        
        let sessionId = req.headers['x-session-id'] || 
                       req.headers['authorization'] || 
                       req.headers['sessionid'] ||
                       (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                message: "未提供会话ID"
            });
        }

        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(401).json({
                success: false,
                message: "会话无效或已过期"
            });
        }

        if (session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const key = generateLicenseKey();
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
        
        const keyData = {
            id: nextKeyId++,
            key,
            note,
            expiry: expiryDate.toISOString(),
            status: 'active',
            createdBy: session.email,
            createdAt: new Date().toISOString(),
            maxUsers: parseInt(maxUsers) || 1, // 自定义最大绑定用户数
            usedBy: null,
            usedAt: null,
            usedEmail: null
        };
        
        licenseKeys.set(key, keyData);
        // 初始化该密钥的用户绑定数组
        keyUserBindings[key] = [];
        
        addLog('generate_key', session.email, key, `生成新密钥: ${note} - 最多绑定 ${maxUsers} 个账号`);

        res.json({
            success: true,
            data: keyData
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 8. 获取密钥列表（管理员功能）- 显示绑定信息
app.get('/api/keys', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || 
                         req.headers['authorization'] || 
                         req.headers['sessionid'] ||
                         (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                message: "未提供会话ID"
            });
        }

        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const keys = Array.from(licenseKeys.values()).map(key => {
            const boundUsers = keyUserBindings[key.key] || [];
            return {
                ...key,
                currentUsers: boundUsers.length,
                boundUsers: boundUsers
            };
        });
        
        res.json({
            success: true,
            data: keys
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 9. 删除密钥（管理员功能）- 同时清理所有绑定
app.delete('/api/keys/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const sessionId = req.headers['x-session-id'] || 
                         req.headers['authorization'] || 
                         req.headers['sessionid'] ||
                         (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                message: "未提供会话ID"
            });
        }

        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const keyData = licenseKeys.get(key);
        if (!keyData) {
            return res.status(400).json({
                success: false,
                message: "密钥不存在"
            });
        }

        // 清理所有用户绑定
        const boundUsers = keyUserBindings[key] || [];
        boundUsers.forEach(userId => {
            delete userKeyBindings[userId];
        });
        delete keyUserBindings[key];

        licenseKeys.delete(key);
        addLog('delete_key', session.email, key, `删除密钥: ${keyData.note}`);

        res.json({
            success: true,
            message: "密钥已删除"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 10. 修改密钥的最大绑定用户数（管理员功能）
app.put('/api/keys/:key/max-users', async (req, res) => {
    try {
        const { key } = req.params;
        const { maxUsers } = req.body;
        
        let sessionId = req.headers['x-session-id'] || 
                       req.headers['authorization'] || 
                       req.headers['sessionid'] ||
                       (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                message: "未提供会话ID"
            });
        }

        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const keyData = licenseKeys.get(key);
        if (!keyData) {
            return res.status(400).json({
                success: false,
                message: "密钥不存在"
            });
        }

        const newMaxUsers = parseInt(maxUsers);
        if (isNaN(newMaxUsers) || newMaxUsers < 1) {
            return res.status(400).json({
                success: false,
                message: "请输入有效的用户数量"
            });
        }

        // 检查新的最大用户数是否小于当前绑定用户数
        const currentUsers = keyUserBindings[key] ? keyUserBindings[key].length : 0;
        if (newMaxUsers < currentUsers) {
            return res.status(400).json({
                success: false,
                message: `新的最大用户数不能小于当前绑定用户数 (${currentUsers})`
            });
        }

        keyData.maxUsers = newMaxUsers;
        addLog('update_key', session.email, key, `修改密钥最大绑定用户数: ${newMaxUsers}`);

        res.json({
            success: true,
            data: keyData,
            message: `密钥最大绑定用户数已修改为 ${newMaxUsers}`
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 其他接口保持不变（修改邮箱、密码、国王等级等）...

// 健康检查接口
app.get('/health', (req, res) => {
    const totalKeys = licenseKeys.size;
    const totalBindings = Object.keys(userKeyBindings).length;
    const multiUserKeys = Array.from(licenseKeys.values()).filter(key => (key.maxUsers || 1) > 1).length;
    
    res.json({ 
        status: 'ok', 
        message: 'Backend is running',
        activeSessions: activeSessions.size,
        licenseKeys: totalKeys,
        userBindings: totalBindings,
        multiUserKeys: multiUserKeys,
        operationLogs: operationLogs.length,
        persistence: true
    });
});

// 清理过期会话
setInterval(() => {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000;
    let cleaned = false;
    
    for (const [sessionId, session] of activeSessions.entries()) {
        if (now - session.lastActivity > maxAge) {
            activeSessions.delete(sessionId);
            cleaned = true;
        }
    }
    
    if (cleaned) {
        savePersistentData();
    }
}, 30 * 60 * 1000);

// 启动服务
app.listen(PORT, () => {
    console.log(`后端服务已启动，端口：${PORT}`);
    console.log(`API基础地址：http://localhost:${PORT}/api`);
    console.log('密钥验证系统已启用 - 支持自定义绑定用户数量');
    console.log(`当前密钥数量：${licenseKeys.size}`);
    console.log(`用户绑定数量：${Object.keys(userKeyBindings).length}`);
});
