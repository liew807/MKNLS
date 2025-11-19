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
const requiredEnv = ['FIREBASE_API_KEY', 'RANK_URL'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error('缺少必要环境变量：', missingEnv.join(', '));
    process.exit(1); 
}

// 密钥生成函数
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// 用户会话管理
class UserSessionManager {
    constructor() {
        this.activeSessions = new Map();
    }

    createSession(userId, email, role = 'user') {
        const sessionId = this.generateSessionId();
        const session = {
            userId,
            email,
            role,
            startTime: new Date(),
            lastActivity: new Date()
        };
        
        this.activeSessions.set(sessionId, session);
        console.log(`用户 ${email} 创建会话: ${sessionId}, 角色: ${role}`);
        
        return sessionId;
    }

    validateSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { valid: false, message: '会话无效或已过期' };
        }

        // 更新最后活动时间
        session.lastActivity = new Date();
        
        return {
            valid: true,
            data: {
                userId: session.userId,
                email: session.email,
                role: session.role
            }
        };
    }

    removeSession(sessionId) {
        this.activeSessions.delete(sessionId);
    }

    updateUserRole(sessionId, newRole) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.role = newRole;
            return true;
        }
        return false;
    }

    generateSessionId() {
        return 'user_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // 清理过期会话
    cleanupExpiredSessions() {
        const now = new Date();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时
        
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (now - session.lastActivity > maxAge) {
                this.activeSessions.delete(sessionId);
                console.log(`清理过期会话: ${sessionId}`);
            }
        }
    }
}

// 密钥管理系统
class LicenseKeyManager {
    constructor() {
        this.licenseKeys = new Map();
        this.userKeyBindings = new Map(); // 用户ID -> 密钥ID
        this.operationLogs = [];
        this.nextKeyId = 1;
        this.nextLogId = 1;
    }

    // 生成新密钥
    generateKey(note = '', expiryDays = 30, createdBy) {
        const key = generateLicenseKey();
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiryDays);
        
        const keyData = {
            id: this.nextKeyId++,
            key,
            note,
            expiry: expiryDate.toISOString(),
            status: 'active',
            createdBy,
            createdAt: new Date().toISOString(),
            usedBy: null,
            usedAt: null
        };
        
        this.licenseKeys.set(key, keyData);
        this.addLog('generate_key', createdBy, key, `生成新密钥: ${note}`);
        
        return keyData;
    }

    // 验证密钥
    validateKey(key, userId) {
        const keyData = this.licenseKeys.get(key);
        
        if (!keyData) {
            return { valid: false, message: '密钥不存在' };
        }
        
        if (keyData.status !== 'active') {
            return { valid: false, message: '密钥已失效' };
        }
        
        if (new Date(keyData.expiry) < new Date()) {
            keyData.status = 'expired';
            return { valid: false, message: '密钥已过期' };
        }
        
        // 检查是否已被其他用户使用
        if (keyData.usedBy && keyData.usedBy !== userId) {
            return { valid: false, message: '密钥已被其他用户使用' };
        }
        
        // 检查用户是否已绑定其他密钥
        if (this.userKeyBindings.has(userId)) {
            const existingKey = this.userKeyBindings.get(userId);
            if (existingKey !== key) {
                return { valid: false, message: '您已绑定其他密钥，请先解绑' };
            }
        }
        
        // 绑定用户和密钥
        if (!keyData.usedBy) {
            keyData.usedBy = userId;
            keyData.usedAt = new Date().toISOString();
            this.userKeyBindings.set(userId, key);
            this.addLog('bind_key', userId, key, '用户绑定密钥');
        }
        
        return {
            valid: true,
            data: {
                key: keyData.key,
                note: keyData.note,
                expiry: keyData.expiry,
                status: keyData.status
            }
        };
    }

    // 获取用户绑定的密钥
    getUserKey(userId) {
        const key = this.userKeyBindings.get(userId);
        if (!key) return null;
        
        return this.licenseKeys.get(key);
    }

    // 解绑用户密钥
    unbindUserKey(userId) {
        const key = this.userKeyBindings.get(userId);
        if (key) {
            const keyData = this.licenseKeys.get(key);
            if (keyData) {
                keyData.usedBy = null;
                keyData.usedAt = null;
            }
            this.userKeyBindings.delete(userId);
            this.addLog('unbind_key', userId, key, '用户解绑密钥');
            return true;
        }
        return false;
    }

    // 删除密钥
    deleteKey(key, operator) {
        const keyData = this.licenseKeys.get(key);
        if (!keyData) {
            return { success: false, message: '密钥不存在' };
        }
        
        // 如果密钥已被使用，解绑用户
        if (keyData.usedBy) {
            this.userKeyBindings.delete(keyData.usedBy);
        }
        
        this.licenseKeys.delete(key);
        this.addLog('delete_key', operator, key, `删除密钥: ${keyData.note}`);
        
        return { success: true, message: '密钥已删除' };
    }

    // 获取所有密钥
    getAllKeys() {
        return Array.from(this.licenseKeys.values());
    }

    // 获取操作日志
    getLogs(limit = 50) {
        return this.operationLogs
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, limit);
    }

    // 添加操作日志
    addLog(action, user, key, details = '') {
        const log = {
            id: this.nextLogId++,
            action,
            user,
            key,
            details,
            time: new Date().toISOString()
        };
        
        this.operationLogs.push(log);
        
        // 限制日志数量
        if (this.operationLogs.length > 1000) {
            this.operationLogs = this.operationLogs.slice(-1000);
        }
    }

    // 获取密钥信息
    getKeyInfo(key) {
        return this.licenseKeys.get(key);
    }

    // 更新密钥信息
    updateKey(key, updates) {
        const keyData = this.licenseKeys.get(key);
        if (!keyData) {
            return { success: false, message: '密钥不存在' };
        }
        
        Object.assign(keyData, updates);
        this.addLog('update_key', 'system', key, '更新密钥信息');
        
        return { success: true, data: keyData };
    }
}

// 初始化管理器
const userSessionManager = new UserSessionManager();
const licenseKeyManager = new LicenseKeyManager();

// 每30分钟清理一次过期会话
setInterval(() => userSessionManager.cleanupExpiredSessions(), 30 * 60 * 1000);

// 中间件：验证会话
function validateSession(req, res, next) {
    const sessionId = req.body.sessionId || req.headers['x-session-id'];
    
    if (!sessionId) {
        return res.status(401).json({
            success: false,
            message: "请提供会话ID"
        });
    }
    
    const sessionValidation = userSessionManager.validateSession(sessionId);
    if (!sessionValidation.valid) {
        return res.status(401).json({
            success: false,
            message: sessionValidation.message
        });
    }
    
    req.user = sessionValidation.data;
    next();
}

// 中间件：验证管理员权限
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: "需要管理员权限"
        });
    }
    next();
}

// 1. 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

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

        // 检查是否为管理员（这里可以根据需要设置管理员邮箱列表）
        const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [];
        const role = adminEmails.includes(email) ? 'admin' : 'user';

        // 创建用户会话
        const sessionId = userSessionManager.createSession(firebaseData.localId, email, role);

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

// 2. 验证许可证密钥
app.post('/api/verify-key', validateSession, async (req, res) => {
    try {
        const { licenseKey } = req.body;

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                message: "请提供许可证密钥"
            });
        }

        const validation = licenseKeyManager.validateKey(licenseKey, req.user.userId);
        
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }

        res.json({
            success: true,
            data: validation.data
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 3. 生成新密钥（管理员功能）
app.post('/api/generate-key', validateSession, requireAdmin, async (req, res) => {
    try {
        const { note, expiryDays = 30 } = req.body;

        const keyData = licenseKeyManager.generateKey(
            note || '', 
            parseInt(expiryDays), 
            req.user.email
        );

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
app.get('/api/keys', validateSession, requireAdmin, async (req, res) => {
    try {
        const keys = licenseKeyManager.getAllKeys();
        
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
app.delete('/api/keys/:key', validateSession, requireAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        
        const result = licenseKeyManager.deleteKey(key, req.user.email);
        
        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 6. 获取操作日志（管理员功能）
app.get('/api/logs', validateSession, requireAdmin, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const logs = licenseKeyManager.getLogs(parseInt(limit));
        
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

// 7. 获取用户密钥信息
app.get('/api/user-key', validateSession, async (req, res) => {
    try {
        const keyData = licenseKeyManager.getUserKey(req.user.userId);
        
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

// 8. 解绑用户密钥
app.post('/api/unbind-key', validateSession, async (req, res) => {
    try {
        const success = licenseKeyManager.unbindUserKey(req.user.userId);
        
        res.json({
            success,
            message: success ? "密钥解绑成功" : "未找到绑定的密钥"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 9. 切换管理员模式
app.post('/api/switch-to-admin', validateSession, async (req, res) => {
    try {
        const { adminKey } = req.body;

        if (!adminKey) {
            return res.status(400).json({
                success: false,
                message: "请提供管理员密钥"
            });
        }

        // 验证管理员密钥（这里可以设置更复杂的管理员密钥验证）
        const validAdminKey = process.env.ADMIN_SWITCH_KEY || 'ADMIN123';
        if (adminKey !== validAdminKey) {
            return res.status(400).json({
                success: false,
                message: "管理员密钥错误"
            });
        }

        // 更新用户角色
        const success = userSessionManager.updateUserRole(req.body.sessionId, 'admin');
        
        if (success) {
            res.json({
                success: true,
                message: "已切换到管理员模式"
            });
        } else {
            res.status(400).json({
                success: false,
                message: "切换管理员模式失败"
            });
        }

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 10. 切换用户模式
app.post('/api/switch-to-user', validateSession, async (req, res) => {
    try {
        // 更新用户角色
        const success = userSessionManager.updateUserRole(req.body.sessionId, 'user');
        
        if (success) {
            res.json({
                success: true,
                message: "已切换到用户模式"
            });
        } else {
            res.status(400).json({
                success: false,
                message: "切换用户模式失败"
            });
        }

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 11. 修改邮箱接口
app.post('/api/change-email', validateSession, async (req, res) => {
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

        // 更新会话中的邮箱信息
        const session = userSessionManager.activeSessions.get(req.body.sessionId);
        if (session) {
            session.email = newEmail;
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

// 12. 修改密码接口
app.post('/api/change-password', validateSession, async (req, res) => {
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

// 13. 设置国王等级接口
app.post('/api/king-rank', validateSession, async (req, res) => {
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

// 14. 检查会话状态接口
app.post('/api/check-session', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供会话ID"
            });
        }

        const sessionValidation = userSessionManager.validateSession(sessionId);
        
        res.json({
            success: sessionValidation.valid,
            data: {
                valid: sessionValidation.valid,
                message: sessionValidation.message,
                userInfo: sessionValidation.data
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 15. 退出登录接口
app.post('/api/logout', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (sessionId) {
            userSessionManager.removeSession(sessionId);
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

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Backend is running',
        activeSessions: userSessionManager.activeSessions.size,
        licenseKeys: licenseKeyManager.licenseKeys.size,
        userBindings: licenseKeyManager.userKeyBindings.size
    });
});

// 启动服务
app.listen(PORT, () => {
    console.log(`后端服务已启动，端口：${PORT}`);
    console.log(`API基础地址：http://localhost:${PORT}/api`);
    console.log(`前端地址：http://localhost:${PORT}/`);
    console.log('密钥验证系统已启用');
    
    // 初始化一些示例密钥（仅用于测试）
    if (process.env.NODE_ENV === 'development') {
        licenseKeyManager.generateKey('VIP密钥', 365, 'system');
        licenseKeyManager.generateKey('白金密钥', 30, 'system');
        console.log('已生成测试密钥');
    }
});
