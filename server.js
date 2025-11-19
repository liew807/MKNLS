require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); 

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

// 简单的内存存储（生产环境建议使用数据库）
const activeSessions = new Map();
const licenseKeys = new Map();
const operationLogs = [];
let nextKeyId = 1;
let nextLogId = 1;

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
    
    // 限制日志数量
    if (operationLogs.length > 1000) {
        operationLogs.splice(0, 100);
    }
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

        // 如果是管理员密钥验证
        if (keyType === 'admin' && licenseKey === process.env.ADMIN_LOGIN_KEY) {
            // 创建管理员会话
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
            return res.status(400).json({
                success: false,
                message: "密钥已过期"
            });
        }

        res.json({
            success: true,
            data: {
                key: keyData.key,
                note: keyData.note,
                expiry: keyData.expiry,
                status: keyData.status,
                keyType: 'user'
            }
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
        const { email, password, licenseKey } = req.body;

        // 基础验证
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        // 调用Firebase登录接口
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

        // 检查是否为管理员
        const adminEmails = process.env.ADMIN_EMAILS.split(',');
        const role = adminEmails.includes(email) ? 'admin' : 'user';

        // 创建用户会话
        const sessionId = 'user_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        activeSessions.set(sessionId, {
            userId: firebaseData.localId,
            email: firebaseData.email,
            role,
            startTime: new Date(),
            lastActivity: new Date()
        });

        addLog('user_login', email, licenseKey || 'N/A', '用户登录系统');

        // 返回用户信息
        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                sessionId,
                role,
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

// 3. 生成新密钥（管理员功能）
app.post('/api/generate-key', async (req, res) => {
    try {
        const { note = '', expiryDays = 30 } = req.body;
        const sessionId = req.headers['x-session-id'];

        // 验证会话
        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
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
            usedBy: null,
            usedAt: null
        };
        
        licenseKeys.set(key, keyData);
        addLog('generate_key', session.email, key, `生成新密钥: ${note}`);

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

// 4. 获取密钥列表（管理员功能）
app.get('/api/keys', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];

        // 验证会话
        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const keys = Array.from(licenseKeys.values());
        
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

// 5. 删除密钥（管理员功能）
app.delete('/api/keys/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const sessionId = req.headers['x-session-id'];

        // 验证会话
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

// 6. 获取操作日志（管理员功能）
app.get('/api/logs', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        const { limit = 50 } = req.query;

        // 验证会话
        const session = activeSessions.get(sessionId);
        if (!session || session.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "需要管理员权限"
            });
        }

        const logs = operationLogs
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, parseInt(limit));
        
        res.json({
            success: true,
            data: logs
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 7. 修改邮箱接口
app.post('/api/change-email', async (req, res) => {
    try {
        const { idToken, newEmail } = req.body;

        if (!idToken || !newEmail) {
            return res.status(400).json({
                success: false,
                message: "请提供完整的参数"
            });
        }

        // 验证邮箱格式
        if (!/^[\w.-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(newEmail)) {
            return res.status(400).json({
                success: false,
                message: "请输入有效的邮箱格式"
            });
        }

        // 调用Firebase修改邮箱接口
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

// 8. 修改密码接口
app.post('/api/change-password', async (req, res) => {
    try {
        const { idToken, newPassword } = req.body;

        if (!idToken || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "请提供完整的参数"
            });
        }

        // 密码长度验证
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "密码长度不能少于6位"
            });
        }

        // 调用Firebase修改密码接口
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

// 9. 设置国王等级接口
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

        // 构造等级数据
        const ratingData = {
            "cars": 100000, "car_fix": 100000, "car_collided": 100000, "car_exchange": 100000,
            "car_trade": 100000, "car_wash": 100000, "slicer_cut": 100000, "drift_max": 100000,
            "drift": 100000, "cargo": 100000, "delivery": 100000, "taxi": 100000, "levels": 100000,
            "gifts": 100000, "fuel": 100000, "offroad": 100000, "speed_banner": 100000,
            "reactions": 100000, "police": 100000, "run": 100000, "real_estate": 100000,
            "t_distance": 100000, "treasure": 100000, "block_post": 100000, "push_ups": 100000,
            "burnt_tire": 100000, "passanger_distance": 100000, "time": 10000000000, "race_win": 3000
        };

        // 调用等级设置接口
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

// 10. 检查会话状态
app.post('/api/check-session', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供会话ID"
            });
        }

        const session = activeSessions.get(sessionId);
        const isValid = !!session;
        
        if (isValid) {
            // 更新最后活动时间
            session.lastActivity = new Date();
        }

        res.json({
            success: isValid,
            data: {
                valid: isValid,
                userInfo: isValid ? {
                    userId: session.userId,
                    email: session.email,
                    role: session.role
                } : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 11. 退出登录接口
app.post('/api/logout', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (sessionId) {
            const session = activeSessions.get(sessionId);
            if (session) {
                addLog('logout', session.email, 'N/A', '用户退出登录');
            }
            activeSessions.delete(sessionId);
        }

        res.json({
            success: true,
            message: "退出登录成功"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 12. 验证管理员密钥接口
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

        // 创建管理员会话
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

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Backend is running',
        activeSessions: activeSessions.size,
        licenseKeys: licenseKeys.size,
        operationLogs: operationLogs.length
    });
});

// 清理过期会话的定时任务（每30分钟）
setInterval(() => {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    
    for (const [sessionId, session] of activeSessions.entries()) {
        if (now - session.lastActivity > maxAge) {
            activeSessions.delete(sessionId);
            console.log(`清理过期会话: ${sessionId}`);
        }
    }
}, 30 * 60 * 1000);

// 初始化一些测试密钥（仅开发环境）
if (process.env.NODE_ENV === 'development') {
    const testKey1 = generateLicenseKey();
    licenseKeys.set(testKey1, {
        id: nextKeyId++,
        key: testKey1,
        note: 'VIP用户测试密钥',
        expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1年后
        status: 'active',
        createdBy: 'system',
        createdAt: new Date().toISOString()
    });

    const testKey2 = generateLicenseKey();
    licenseKeys.set(testKey2, {
        id: nextKeyId++,
        key: testKey2,
        note: '普通用户测试密钥',
        expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30天后
        status: 'active',
        createdBy: 'system',
        createdAt: new Date().toISOString()
    });

    console.log('已生成测试密钥:', testKey1, testKey2);
}

// 启动服务
app.listen(PORT, () => {
    console.log(`后端服务已启动，端口：${PORT}`);
    console.log(`API基础地址：http://localhost:${PORT}/api`);
    console.log(`前端地址：http://localhost:${PORT}/`);
    console.log('密钥验证系统已启用');
});
