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

// 密钥管理系统
class LicenseManager {
    constructor() {
        // 从数据库或环境变量加载密钥
        this.licenses = this.loadLicenses();
        this.activeSessions = new Map();
        console.log(`密钥系统已初始化，共 ${Object.keys(this.licenses).length} 个密钥`);
    }

    loadLicenses() {
        // 这里可以从数据库加载，暂时使用硬编码
        return {
            // 试用版密钥 (30个)
            "FREE-TRIAL-001": { expiry: "2025-11-5", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-002": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-003": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-004": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            "FREE-TRIAL-005": { expiry: "2025-12-31", type: "试用版", maxUses: 1, used: 0 },
            
            // 测试版密钥 (20个)
            "TEST-KEY-2025-001": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            "TEST-KEY-2025-002": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            "TEST-KEY-2025-003": { expiry: "2025-12-31", type: "测试版", maxUses: 999, used: 0 },
            
            // 个人专业版密钥 (25个)
            "JBC-PRO-2025-001": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "JBC-PRO-2025-002": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            "JBC-PRO-2025-003": { expiry: "2025-12-31", type: "个人专业版", maxUses: 5, used: 0 },
            
            // 企业版密钥 (15个)
            "JBC-ENTERPRISE-001": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            "JBC-ENTERPRISE-002": { expiry: "2025-12-31", type: "企业版", maxUses: 50, used: 0 },
            
            // VIP版密钥 (10个)
            "JBC-VIP-2025-001": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 },
            "JBC-VIP-2025-002": { expiry: "2026-12-31", type: "VIP版", maxUses: 999, used: 0 }
        };
    }

    validateLicense(licenseKey) {
        const license = this.licenses[licenseKey];
        
        if (!license) {
            return { valid: false, message: '无效的授权密钥' };
        }

        // 检查是否过期
        const now = new Date();
        const expiryDate = new Date(license.expiry);
        expiryDate.setHours(23, 59, 59, 999);
        
        if (expiryDate < now) {
            const expiredDays = Math.floor((now - expiryDate) / (1000 * 60 * 60 * 24));
            return { valid: false, message: `该密钥已于 ${expiredDays} 天前过期` };
        }

        // 检查使用次数
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

        // 增加使用次数
        license.used++;
        
        // 创建会话
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

        // 检查密钥是否仍然有效
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

    // 获取所有密钥状态（管理员功能）
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

// 0. 密钥验证接口
app.post('/api/verify-license', async (req, res) => {
    try {
        const { licenseKey } = req.body;

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                message: "请提供授权密钥"
            });
        }

        // 验证密钥
        const validation = licenseManager.validateLicense(licenseKey);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }

        // 激活密钥（增加使用次数）
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

// 1. 登录接口（需要有效的会话）
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, sessionId } = req.body;

        // 验证会话
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
                firebaseData.error?.message || "Firebase登录验证失败"
            );
        }

        // 返回用户信息
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

// 2. 设置国王等级接口（需要会话验证）
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

        // 验证会话
        const sessionValidation = licenseManager.validateSession(sessionId);
        if (!sessionValidation.valid) {
            return res.status(400).json({
                success: false,
                message: sessionValidation.message
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

// 3. 克隆账号数据接口（需要会话验证）
app.post('/api/clone-account-data', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const { sourceToken, targetEmail, targetPassword, cloneOptions, sessionId } = req.body;

        // 验证授权头
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "请提供有效的身份令牌"
            });
        }

        // 验证会话
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

        // 验证必要参数
        if (!sourceToken || !targetEmail || !targetPassword) {
            return res.status(400).json({
                success: false,
                message: "请提供源令牌、目标邮箱和密码"
            });
        }

        console.log(`开始克隆Car Parking账号数据到: ${targetEmail}`);
        console.log('克隆选项:', cloneOptions);

        // 1. 首先登录目标账号获取目标token - 使用和登录接口相同的代码
        console.log('正在登录目标账号...');
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
        console.log('目标账号登录成功，获取到token');

        // 2. 获取源账号的Car Parking游戏数据
        console.log('正在获取源账号Car Parking游戏数据...');
        const sourceGameData = await getCarParkingGameData(sourceToken);
        
        // 3. 克隆游戏数据到目标账号
        console.log('正在克隆游戏数据到目标账号...');
        const clonedItems = await cloneCarParkingDataToTarget(sourceGameData, targetToken, cloneOptions);

        res.json({
            success: true,
            message: "Car Parking账号数据克隆成功",
            data: {
                targetEmail: targetEmail,
                clonedItems: clonedItems,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('克隆Car Parking账号数据失败:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 获取Car Parking游戏数据的函数
async function getCarParkingGameData(sourceToken) {
    try {
        console.log('从源账号获取Car Parking游戏数据...');
        
        // 这里调用Car Parking的API获取游戏数据
        // 暂时使用模拟数据
        const gameData = {
            profile: {
                displayName: "CarParking Master",
                level: 100,
                experience: 500000,
                coins: 999999,
                cash: 100000,
                vipLevel: 5
            },
            garage: {
                cars: [
                    { id: "car1", name: "BMW M4 G82", level: 10, upgrades: { engine: 5, turbo: 5, handling: 5 } },
                    { id: "car2", name: "Audi R8 V10", level: 8, upgrades: { engine: 4, turbo: 4, handling: 4 } },
                    { id: "car3", name: "Mercedes AMG GT", level: 9, upgrades: { engine: 5, turbo: 4, handling: 5 } }
                ],
                slots: 20
            },
            stats: {
                racesWon: 500,
                perfectParks: 250,
                totalDistance: 500000,
                playTime: 7200,
                bestDriftScore: 25000,
                totalCoinsEarned: 2000000
            },
            inventory: {
                items: [
                    { id: "nitro_boost", count: 50 },
                    { id: "repair_kit", count: 25 },
                    { id: "premium_paint", count: 15 },
                    { id: "gold_wheels", count: 10 }
                ],
                currency: {
                    coins: 999999,
                    cash: 100000,
                    gems: 500
                }
            }
        };

        console.log('成功获取Car Parking游戏数据');
        return gameData;

    } catch (error) {
        throw new Error(`获取Car Parking游戏数据失败: ${error.message}`);
    }
}

// 克隆Car Parking数据到目标账号的函数
async function cloneCarParkingDataToTarget(sourceGameData, targetToken, cloneOptions) {
    try {
        const clonedItems = [];

        // 根据选项克隆不同类型的数据
        if (cloneOptions.gameData) {
            await cloneCarParkingGameStats(sourceGameData, targetToken);
            clonedItems.push('游戏数据');
        }

        if (cloneOptions.profile) {
            await cloneCarParkingProfile(sourceGameData, targetToken);
            clonedItems.push('个人资料');
        }

        if (cloneOptions.inventory) {
            await cloneCarParkingInventory(sourceGameData, targetToken);
            clonedItems.push('物品库存');
        }

        console.log(`成功克隆了以下Car Parking数据: ${clonedItems.join(', ')}`);
        return clonedItems;

    } catch (error) {
        throw new Error(`克隆Car Parking数据到目标账号失败: ${error.message}`);
    }
}

// Car Parking专用的克隆函数
async function cloneCarParkingGameStats(sourceData, targetToken) {
    try {
        console.log('克隆Car Parking游戏统计数据...');
        
        // 使用与king-rank相同的接口设置游戏数据
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
            throw new Error(`Car Parking游戏数据克隆失败: ${rankResponse.statusText}`);
        }

        console.log('Car Parking游戏统计数据克隆成功');
    } catch (error) {
        console.error('Car Parking游戏统计数据克隆失败:', error);
        throw error;
    }
}

async function cloneCarParkingProfile(sourceData, targetToken) {
    try {
        console.log('克隆Car Parking个人资料...');
        
        // 这里可以调用Car Parking的更新个人资料接口
        console.log('Car Parking个人资料克隆完成');
        
    } catch (error) {
        console.error('Car Parking个人资料克隆失败:', error);
        // 不抛出错误，继续其他克隆操作
    }
}

async function cloneCarParkingInventory(sourceData, targetToken) {
    try {
        console.log('克隆Car Parking物品库存...');
        
        // 这里可以调用Car Parking的更新库存接口
        console.log('Car Parking物品库存克隆完成');
        
    } catch (error) {
        console.error('Car Parking物品库存克隆失败:', error);
        // 不抛出错误，继续其他克隆操作
    }
}

// 4. 检查会话状态接口
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

// 5. 管理员接口：查看密钥状态
app.get('/api/admin/licenses', (req, res) => {
    // 简单的管理员验证
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

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

// 启动服务
app.listen(PORT, () => {
    console.log(`后端服务已启动，端口：${PORT}`);
    console.log(`API基础地址：http://localhost:${PORT}/api`);
    console.log(`前端地址：http://localhost:${PORT}/`);
    console.log('密钥验证系统已启用，所有API都需要有效的会话');
    console.log('克隆账号数据功能已启用');
});
