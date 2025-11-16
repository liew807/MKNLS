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
            "JBC-PRO-2025-001": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "JBC-PRO-2025-002": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "JBC-PRO-2025-003": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "JBC-ENTERPRISE-001": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            "JBC-ENTERPRISE-002": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            "JBC-VIP-2025-001": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 },
            "JBC-VIP-2025-002": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 }
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

        // 1. 登录目标账号获取目标token
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

        // 2. 获取源账号的车辆数据
        const sourceCarData = await getSourceCarData(sourceToken);
        
        // 3. 克隆车辆数据到目标账号
        await cloneCarDataToTarget(sourceCarData, targetToken);

        // 4. 设置国王等级数据
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
            throw new Error(`等级设置失败: ${rankResponse.statusText}`);
        }

        res.json({
            success: true,
            message: "账号数据克隆成功",
            data: {
                targetEmail: targetEmail,
                clonedItems: ['车辆数据', '游戏等级数据'],
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

// 获取源账号车辆数据
async function getSourceCarData(sourceToken) {
    try {
        const response = await fetch('https://us-central1-cp-multiplayer.cloudfunctions.net/WSGetCarIDnStatusV2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sourceToken}`,
                'User-Agent': 'okhttp/3.12.13'
            },
            body: JSON.stringify({
                data: null
            })
        });

        if (!response.ok) {
            throw new Error(`获取车辆数据失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.result;
    } catch (error) {
        throw new Error(`获取车辆数据失败: ${error.message}`);
    }
}

// 克隆车辆数据到目标账号 - 使用您提供的真实车辆数据格式
async function cloneCarDataToTarget(carData, targetToken) {
    try {
        // 使用您提供的真实车辆数据格式
        const carDataToSave = "__ver1__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";

        const response = await fetch('https://us-central1-cp-multiplayer.cloudfunctions.net/SaveCarsPartially7_2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${targetToken}`,
                'User-Agent': 'okhttp/3.12.13'
            },
            body: JSON.stringify({
                data: carDataToSave
            })
        });

        if (!response.ok) {
            throw new Error(`保存车辆数据失败: ${response.status} ${response.statusText}`);
        }

        console.log('车辆数据克隆成功');
    } catch (error) {
        throw new Error(`克隆车辆数据失败: ${error.message}`);
    }
}

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
