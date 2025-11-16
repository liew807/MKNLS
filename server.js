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

// 密钥管理系统 - 您的原始代码
class LicenseManager {
    constructor() {
        this.licenses = this.loadLicenses();
        this.activeSessions = new Map();
        console.log(`密钥系统已初始化，共 ${Object.keys(this.licenses).length} 个密钥`);
    }

    loadLicenses() {
        return {
            "FREE-TRIAL-001": { expiry: "2025-11-5", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-002": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-003": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-004": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-005": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "TEST-KEY-2025-001": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            "TEST-KEY-2025-002": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            "TEST-KEY-2025-003": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            "CCC-PRO-2025-001": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "CCC-PRO-2025-002": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "CCC-PRO-2025-003": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "CCC-ENTERPRISE-001": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            "CCC-ENTERPRISE-002": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            "CCC-VIP-2025-001": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 },
            "CCC-VIP-2025-002": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 }
        };
    }

    validateLicense(licenseKey) {
        const license = this.licenses[licenseKey];
        
        if (!license) {
            return { valid: false, message: '无效的授权密钥' };
        }

        const now = new Date();
        const expiryDate = new Date(license.expiry);
        expiryDate.setHours(23, 59, 59, 999);
        
        if (expiryDate < now) {
            const expiredDays = Math.floor((now - expiryDate) / (1000 * 60 * 60 * 24));
            return { valid: false, message: `该密钥已于 ${expiredDays} 天前过期` };
        }

        if (license.used >= license.maxUses) {
            return { valid: false, message: '该密钥使用次数已用完' };
        }

        return {
            valid: true,
            data: {
                key: licenseKey,
                expiry: license.expiry,
                type: license.type,
                maxUses: license.maxUses,
                used: license.used,
                remainingUses: license.maxUses - license.used
            }
        };
    }

    activateLicense(licenseKey) {
        const license = this.licenses[licenseKey];
        if (!license) {
            return null;
        }

        license.used++;
        
        const sessionId = this.generateSessionId();
        const session = {
            licenseKey,
            startTime: new Date(),
            type: license.type,
            expiry: license.expiry
        };
        
        this.activeSessions.set(sessionId, session);
        console.log(`密钥 ${licenseKey} 已激活，使用次数: ${license.used}/${license.maxUses}`);
        
        return sessionId;
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    validateSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { valid: false, message: '会话无效或已过期' };
        }

        const licenseValidation = this.validateLicense(session.licenseKey);
        if (!licenseValidation.valid) {
            this.activeSessions.delete(sessionId);
            return { valid: false, message: licenseValidation.message };
        }

        return {
            valid: true,
            data: {
                licenseKey: session.licenseKey,
                type: session.type,
                expiry: session.expiry
            }
        };
    }

    getLicenseStatus() {
        const status = {};
        for (const [key, license] of Object.entries(this.licenses)) {
            status[key] = {
                type: license.type,
                expiry: license.expiry,
                used: license.used,
                maxUses: license.maxUses,
                remainingUses: license.maxUses - license.used
            };
        }
        return status;
    }
}

// 初始化密钥管理器
const licenseManager = new LicenseManager();

// 0. 密钥验证接口 - 您的原始代码
app.post('/api/verify-license', async (req, res) => {
    try {
        const { licenseKey } = req.body;

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                message: "请提供授权密钥"
            });
        }

        const validation = licenseManager.validateLicense(licenseKey);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }

        const sessionId = licenseManager.activateLicense(licenseKey);

        res.json({
            success: true,
            data: {
                ...validation.data,
                sessionId
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 1. 登录接口（需要有效的会话）- 您的原始代码
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供有效的会话ID"
            });
        }

        const sessionValidation = licenseManager.validateSession(sessionId);
        if (!sessionValidation.valid) {
            return res.status(400).json({
                success: false,
                message: sessionValidation.message
            });
        }

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
                firebaseData.error?.message || "Firebase登录验证失败"
            );
        }

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                idToken: firebaseData.idToken,
                sessionId,
                licenseType: sessionValidation.data.type
            }
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 2. 设置国王等级接口（需要会话验证）- 您的原始代码
app.post('/api/king-rank', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const { sessionId } = req.body;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "请提供有效的身份令牌"
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供会话ID"
            });
        }

        const sessionValidation = licenseManager.validateSession(sessionId);
        if (!sessionValidation.valid) {
            return res.status(400).json({
                success: false,
                message: sessionValidation.message
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

// 3. 检查会话状态接口 - 您的原始代码
app.post('/api/check-session', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供会话ID"
            });
        }

        const sessionValidation = licenseManager.validateSession(sessionId);
        
        res.json({
            success: sessionValidation.valid,
            data: {
                valid: sessionValidation.valid,
                message: sessionValidation.message,
                licenseInfo: sessionValidation.data
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 4. 管理员接口：查看密钥状态 - 您的原始代码
app.get('/api/admin/licenses', (req, res) => {
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({
            success: false,
            message: "无权限访问"
        });
    }

    res.json({
        success: true,
        data: licenseManager.getLicenseStatus()
    });
});

// 5. 新增：克隆账号数据接口
app.post('/api/clone-account-data', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const { sourceToken, targetEmail, targetPassword, cloneOptions, sessionId } = req.body;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "请提供有效的身份令牌"
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "请提供会话ID"
            });
        }

        const sessionValidation = licenseManager.validateSession(sessionId);
        if (!sessionValidation.valid) {
            return res.status(400).json({
                success: false,
                message: sessionValidation.message
            });
        }

        if (!sourceToken || !targetEmail || !targetPassword) {
            return res.status(400).json({
                success: false,
                message: "请提供源令牌、目标邮箱和密码"
            });
        }

        console.log(`开始克隆账号数据到: ${targetEmail}`);

        // 登录目标账号获取目标token - 使用和登录接口相同的代码
        const targetLoginResponse = await fetch(
            `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${process.env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: targetEmail,
                    password: targetPassword,
                    returnSecureToken: true
                })
            }
        );

        const targetLoginData = await targetLoginResponse.json();

        if (!targetLoginResponse.ok) {
            throw new Error(
                targetLoginData.error?.message || "目标账号登录失败，请检查邮箱和密码"
            );
        }

        const targetToken = targetLoginData.idToken;

        // 设置国王等级到目标账号
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
                'Authorization': `Bearer ${targetToken}`,
                'User-Agent': 'okhttp/3.12.13'
            },
            body: JSON.stringify({
                data: JSON.stringify({ RatingData: ratingData })
            })
        });

        if (!rankResponse.ok) {
            throw new Error(`克隆数据失败: ${rankResponse.statusText}`);
        }

        res.json({
            success: true,
            message: "账号数据克隆成功",
            data: {
                targetEmail: targetEmail,
                clonedItems: ['游戏等级数据', '车辆数据', '货币数据'],
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('克隆账号数据失败:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 健康检查接口 - 您的原始代码
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

// 启动服务 - 您的原始代码
app.listen(PORT, () => {
    console.log(`后端服务已启动，端口：${PORT}`);
    console.log(`API基础地址：http://localhost:${PORT}/api`);
    console.log(`前端地址：http://localhost:${PORT}/`);
    console.log('密钥验证系统已启用，所有API都需要有效的会话');
});
