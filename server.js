const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// 环境变量
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM";
const FIREBASE_INSTANCE_ID_TOKEN = process.env.FIREBASE_INSTANCE_ID_TOKEN || "fdEMFcKoR2iSrZAzViyFkh:APA91bEQsP8kAGfBuPTL_ATg25AmnqpssGTkc7IAS2CgLiILjBbneFuSEzOJr2a97eDvQOPGxlphSIV7gCk2k4Wl0UxMK5x298LrJYa5tJmVRqdyz0j3KDSKLCtCbldkRFwNnjU3lwfP";
const CPM_BASE_URL = "https://us-central1-cp-multiplayer.cloudfunctions.net";
const FIREBASE_AUTH_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty";

// 密钥管理系统
const keyManagement = {
    keys: new Map(), // 存储所有密钥
    adminKeys: ['Liew1201'], // 管理员密钥列表
    
    // 初始化
    init() {
        // 添加默认管理员密钥
        this.addKey({
            key: 'Liew1201',
            note: '系统管理员',
            isAdmin: true,
            isTest: false,
            duration: 876000, // 100年
            maxDevices: 999,
            maxAccounts: 999,
            limits: {
                coins: -1,
                cash: -1,
                name: -1,
                wins: -1,
                loses: -1,
                id: -1,
                w16: -1,
                fuel: -1,
                damage: -1,
                smoke: -1,
                houses: -1,
                police: -1,
                clone: -1,
                carMod: -1,
                init: -1,
                unlock: -1,
                delete: -1
            },
            usedDevices: [],
            usedAccounts: [],
            usageCount: 0,
            createdAt: Date.now(),
            expiresAt: Date.now() + 876000 * 3600000
        });
    },
    
    addKey(keyData) {
        this.keys.set(keyData.key, {
            ...keyData,
            usedDevices: keyData.usedDevices || [],
            usedAccounts: keyData.usedAccounts || [],
            usageCount: keyData.usageCount || 0
        });
    },
    
    getKey(key) {
        return this.keys.get(key);
    },
    
    deleteKey(key) {
        return this.keys.delete(key);
    },
    
    getAllKeys() {
        return Array.from(this.keys.values());
    },
    
    validateKey(key, deviceId, accountId) {
        const keyData = this.getKey(key);
        
        if (!keyData) {
            return { valid: false, reason: 'KEY_NOT_FOUND' };
        }
        
        // 检查是否过期
        if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
            return { valid: false, reason: 'KEY_EXPIRED' };
        }
        
        // 检查设备限制
        if (keyData.maxDevices !== -1 && deviceId) {
            if (!keyData.usedDevices.includes(deviceId) && keyData.usedDevices.length >= keyData.maxDevices) {
                return { valid: false, reason: 'DEVICE_LIMIT_REACHED' };
            }
        }
        
        // 检查账号限制
        if (keyData.maxAccounts !== -1 && accountId) {
            if (!keyData.usedAccounts.includes(accountId) && keyData.usedAccounts.length >= keyData.maxAccounts) {
                return { valid: false, reason: 'ACCOUNT_LIMIT_REACHED' };
            }
        }
        
        return { valid: true, keyData };
    },
    
    useKey(key, deviceId, accountId) {
        const keyData = this.getKey(key);
        if (!keyData) return false;
        
        if (deviceId && !keyData.usedDevices.includes(deviceId)) {
            keyData.usedDevices.push(deviceId);
        }
        if (accountId && !keyData.usedAccounts.includes(accountId)) {
            keyData.usedAccounts.push(accountId);
        }
        keyData.usageCount++;
        return true;
    },
    
    checkLimit(key, feature) {
        const keyData = this.getKey(key);
        if (!keyData) return false;
        
        // 管理员无限制
        if (keyData.isAdmin) return true;
        
        // -1表示无限
        if (keyData.limits[feature] === -1) return true;
        
        // 检查剩余次数
        return keyData.usageCount < keyData.limits[feature];
    }
};

// 初始化密钥系统
keyManagement.init();

// 请求日志中间件
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 工具函数
function removeColorCodes(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\[[0-9A-F]{6}\]/g, '');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateId(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 增强的请求函数
async function sendCPMRequest(url, payload, headers, params = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const fullUrl = url + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
            
            const response = await axios({
                method: 'post',
                url: fullUrl,
                data: payload,
                headers: headers,
                timeout: 30000,
                validateStatus: function (status) {
                    return status >= 200 && status < 600;
                }
            });
            
            console.log(`📡 请求 ${attempt}/${maxRetries}: ${response.status}`);
            
            if (response.status === 429) {
                const waitTime = Math.min(2000 * attempt, 10000);
                console.log(`⏳ 请求过多，等待 ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            if (response.status >= 500) {
                console.log(`⚠️ 服务器错误 ${response.status}，重试...`);
                const waitTime = 1000 * attempt;
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response.data;
            
        } catch (error) {
            lastError = error;
            console.error(`尝试 ${attempt}/${maxRetries} 失败:`, error.message);
            
            if (attempt < maxRetries) {
                const waitTime = 1000 * attempt;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    console.error(`💥 所有 ${maxRetries} 次尝试都失败了`);
    return null;
}

// 密钥验证中间件
function verifyKey(req, res, next) {
    const key = req.headers['x-api-key'] || req.body.key;
    
    if (!key) {
        return res.json({ ok: false, error: 401, message: "MISSING_KEY" });
    }
    
    const validation = keyManagement.validateKey(key);
    
    if (!validation.valid) {
        return res.json({ ok: false, error: 401, message: validation.reason });
    }
    
    req.keyData = validation.keyData;
    req.apiKey = key;
    next();
}

// ==================== 前端适配的 API 端点 ====================

// === 认证相关 ===

// 1. 验证密钥
app.post('/api/verify-key', async (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 400, message: "Missing key" });
    }
    
    const validation = keyManagement.validateKey(key, deviceId);
    
    if (!validation.valid) {
        return res.json({ 
            ok: false, 
            error: 401, 
            message: validation.reason 
        });
    }
    
    res.json({
        ok: true,
        error: 0,
        message: "SUCCESSFUL",
        keyInfo: {
            isAdmin: validation.keyData.isAdmin,
            expiresAt: validation.keyData.expiresAt,
            limits: validation.keyData.limits,
            usageCount: validation.keyData.usageCount
        }
    });
});

// 2. 获取密钥详情
app.post('/api/key-details', verifyKey, async (req, res) => {
    const keyData = req.keyData;
    
    res.json({
        ok: true,
        error: 0,
        message: "SUCCESSFUL",
        details: {
            note: keyData.note,
            expiresAt: keyData.expiresAt,
            maxDevices: keyData.maxDevices,
            maxAccounts: keyData.maxAccounts,
            usedDevices: keyData.usedDevices.length,
            usedAccounts: keyData.usedAccounts.length,
            limits: keyData.limits,
            usageCount: keyData.usageCount,
            isAdmin: keyData.isAdmin
        }
    });
});

// === 账号操作 ===

// 3. 登录
app.post('/api/login', async (req, res) => {
    console.log('🔑 登录请求:', { email: req.body.email });
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.json({
            ok: false,
            error: 400,
            message: "MISSING_CREDENTIALS"
        });
    }

    const url = `${FIREBASE_AUTH_URL}/verifyPassword`;
    const payload = {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: "CLIENT_TYPE_ANDROID"
    };
    
    const headers = {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    
    const params = { key: FIREBASE_API_KEY };
    
    try {
        const response = await sendCPMRequest(url, payload, headers, params);
        
        if (response && response.idToken) {
            console.log('✅ 登录成功:', email);
            
            // 获取账号数据
            const accountData = await getAccountData(response.idToken);
            
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                auth: response.idToken,
                refreshToken: response.refreshToken,
                expiresIn: response.expiresIn,
                localId: response.localId,
                email: email,
                accountData: accountData
            });
        } else {
            const error = response?.error?.message || "UNKNOWN_ERROR";
            console.log('❌ 登录失败:', error);
            res.json({
                ok: false,
                error: 401,
                message: error,
                auth: null
            });
        }
    } catch (error) {
        console.error('💥 登录错误:', error);
        res.json({
            ok: false,
            error: 500,
            message: "SERVER_ERROR: " + error.message
        });
    }
});

// 4. 注册新账号
app.post('/api/register', async (req, res) => {
    console.log('📝 注册请求:', { email: req.body.email });
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.json({
            ok: false,
            error: 400,
            message: "MISSING_CREDENTIALS"
        });
    }

    const url = `${FIREBASE_AUTH_URL}/signupNewUser`;
    const payload = {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: "CLIENT_TYPE_ANDROID"
    };
    
    const params = { key: FIREBASE_API_KEY };
    
    try {
        const response = await sendCPMRequest(url, payload, {
            "Content-Type": "application/json"
        }, params);
        
        if (response && response.idToken) {
            console.log('✅ 注册成功:', email);
            
            // 初始化账号数据
            const initData = await initializeAccount(response.idToken, response.localId);
            
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                auth: response.idToken,
                refreshToken: response.refreshToken,
                localId: response.localId,
                email: email
            });
        } else {
            const error = response?.error?.message || "UNKNOWN_ERROR";
            console.log('❌ 注册失败:', error);
            res.json({
                ok: false,
                error: 400,
                message: error
            });
        }
    } catch (error) {
        console.error('💥 注册错误:', error);
        res.json({
            ok: false,
            error: 500,
            message: "SERVER_ERROR: " + error.message
        });
    }
});

// 5. 获取账号完整数据
app.post('/api/get-account-data', async (req, res) => {
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "MISSING_TOKEN" });
    }
    
    try {
        const data = await getAccountData(authToken);
        res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
    } catch (error) {
        res.json({ ok: false, error: 500, message: "SERVER_ERROR" });
    }
});

// 6. 获取所有车辆
app.post('/api/get-all-cars', async (req, res) => {
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "MISSING_TOKEN" });
    }
    
    try {
        const url = `${CPM_BASE_URL}/TestGetAllCars`;
        const response = await sendCPMRequest(url, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "NO_CARS_FOUND", data: [] });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: "SERVER_ERROR" });
    }
});

// === 资源修改 ===

// 7. 修改基础资源（金币、绿钞、胜场、败场、名字、ID）
app.post('/api/modify-resource', async (req, res) => {
    console.log('✏️ 资源修改请求:', req.body);
    
    const { authToken, resourceType, value } = req.body;
    
    if (!authToken || !resourceType) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        // 获取账号数据
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        // 根据资源类型修改
        switch (resourceType) {
            case 'coins':
            case 'coin':
            case 'gold':
                accountData.coin = value;
                accountData.Coin = value;
                accountData.money = value;
                accountData.goldCoins = value;
                break;
            case 'cash':
            case 'greenCash':
                accountData.cash = value;
                accountData.Cash = value;
                accountData.greenCash = value;
                break;
            case 'wins':
                accountData.wins = value;
                accountData.Wins = value;
                break;
            case 'loses':
                accountData.loses = value;
                accountData.Loses = value;
                break;
            case 'name':
                accountData.Name = value;
                accountData.name = value;
                break;
            case 'id':
                const oldId = accountData.localID || accountData.localId;
                accountData.localID = value;
                accountData.localId = value;
                // 更新车辆ID
                await updateCarsId(authToken, oldId, value);
                break;
            default:
                return res.json({ ok: false, error: 400, message: "UNKNOWN_RESOURCE_TYPE" });
        }
        
        // 保存数据
        const saved = await saveAccountData(authToken, accountData);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: {
                    resourceType,
                    newValue: value
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 资源修改错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// 8. 修改货币（绿钞和金币）
app.post('/api/modify-money', async (req, res) => {
    console.log('💰 修改货币请求:', req.body);
    
    const { authToken, greenCash, goldCoins, operationType = 'set' } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 400, message: "MISSING_TOKEN" });
    }
    
    try {
        // 获取账号数据
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        const currentCash = accountData.cash || accountData.Cash || 0;
        const currentCoins = accountData.coin || accountData.Coin || accountData.money || 0;
        
        let newCash = currentCash;
        let newCoins = currentCoins;
        
        if (operationType === 'max') {
            newCash = 999999999;
            newCoins = 999999999;
        } else if (operationType === 'set') {
            if (greenCash !== undefined) newCash = Number(greenCash);
            if (goldCoins !== undefined) newCoins = Number(goldCoins);
        } else if (operationType === 'add') {
            if (greenCash !== undefined) newCash = currentCash + Number(greenCash);
            if (goldCoins !== undefined) newCoins = currentCoins + Number(goldCoins);
        }
        
        // 设置值
        accountData.cash = Math.min(newCash, 999999999);
        accountData.Cash = Math.min(newCash, 999999999);
        accountData.coin = Math.min(newCoins, 999999999);
        accountData.Coin = Math.min(newCoins, 999999999);
        
        // 保存
        const saved = await saveAccountData(authToken, accountData);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: {
                    greenCash: { oldValue: currentCash, newValue: newCash },
                    goldCoins: { oldValue: currentCoins, newValue: newCoins }
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 修改货币错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// === 黑科技 ===

// 9. 黑科技修改（W16、燃油、无伤、烟雾、房产、警灯）
app.post('/api/modify-tech', async (req, res) => {
    console.log('🚀 黑科技请求:', req.body);
    
    const { authToken, techType } = req.body;
    
    if (!authToken || !techType) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        switch (techType) {
            case 'w16':
                // 解锁W16引擎
                accountData.w16Engine = true;
                accountData.hasW16 = true;
                break;
            case 'fuel':
                // 无限燃油
                accountData.unlimitedFuel = true;
                accountData.fuel = 999999;
                accountData.Fuel = 999999;
                break;
            case 'damage':
                // 车辆无伤
                accountData.noDamage = true;
                accountData.godMode = true;
                break;
            case 'smoke':
                // 彩色烟雾
                accountData.colorSmoke = true;
                accountData.customSmoke = true;
                break;
            case 'houses':
                // 解锁所有房产
                accountData.allHousesUnlocked = true;
                accountData.houses = "all";
                break;
            case 'police':
                // 警车警灯
                accountData.policeLights = true;
                accountData.hasPoliceLights = true;
                break;
            default:
                return res.json({ ok: false, error: 400, message: "UNKNOWN_TECH_TYPE" });
        }
        
        const saved = await saveAccountData(authToken, accountData);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { techType, status: 'applied' }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 黑科技错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// === 车辆深度定制 ===

// 10. 车辆性能修改
app.post('/api/modify-car-performance', async (req, res) => {
    console.log('🏎️ 车辆性能修改:', req.body);
    
    const { authToken, carId, hp, inner, nm, torque, camber } = req.body;
    
    if (!authToken || !carId) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        const cars = await getAllCars(authToken);
        const car = cars.find(c => c.CarID === carId || c.id === carId);
        
        if (!car) {
            return res.json({ ok: false, error: 404, message: "CAR_NOT_FOUND" });
        }
        
        if (hp) car.HP = hp;
        if (inner) car.Inner = inner;
        if (nm) car.NM = nm;
        if (torque) car.Torque = torque;
        if (camber) car.Camber = camber;
        
        const saved = await saveCar(authToken, car);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { carId, modifications: { hp, inner, nm, torque, camber } }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 车辆性能修改错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// 11. 车辆外观修改
app.post('/api/modify-car-visual', async (req, res) => {
    console.log('🎨 车辆外观修改:', req.body);
    
    const { authToken, carId, removeFrontBumper, removeRearBumper, spoilerId,
            bodyColor, bodyBrightness, refColor, refBrightness,
            winColor, winBrightness, rimColor, rimBrightness,
            headColor, rimId, rimSize } = req.body;
    
    if (!authToken || !carId) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        const cars = await getAllCars(authToken);
        const car = cars.find(c => c.CarID === carId || c.id === carId);
        
        if (!car) {
            return res.json({ ok: false, error: 404, message: "CAR_NOT_FOUND" });
        }
        
        // 保险杠
        if (removeFrontBumper !== undefined) car.RemoveFrontBumper = removeFrontBumper;
        if (removeRearBumper !== undefined) car.RemoveRearBumper = removeRearBumper;
        if (spoilerId) car.SpoilerID = spoilerId;
        
        // 颜色设置
        if (bodyColor) {
            car.BodyColor = bodyColor;
            car.BodyBrightness = bodyBrightness || 1.0;
        }
        if (refColor) {
            car.ReflectionColor = refColor;
            car.ReflectionBrightness = refBrightness || 1.0;
        }
        if (winColor) {
            car.WindowColor = winColor;
            car.WindowBrightness = winBrightness || 1.0;
        }
        if (rimColor) {
            car.RimColor = rimColor;
            car.RimBrightness = rimBrightness || 1.0;
        }
        if (headColor) car.HeadlightColor = headColor;
        
        // 轮毂
        if (rimId) car.RimID = rimId;
        if (rimSize) car.RimSize = rimSize;
        
        const saved = await saveCar(authToken, car);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { carId, modifications: 'applied' }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 车辆外观修改错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// 12. 车辆悬挂修改
app.post('/api/modify-car-suspension', async (req, res) => {
    console.log('🔧 车辆悬挂修改:', req.body);
    
    const { authToken, carId, distance, stiffness, steerAngle, offset } = req.body;
    
    if (!authToken || !carId) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        const cars = await getAllCars(authToken);
        const car = cars.find(c => c.CarID === carId || c.id === carId);
        
        if (!car) {
            return res.json({ ok: false, error: 404, message: "CAR_NOT_FOUND" });
        }
        
        if (distance !== undefined) car.SuspensionDistance = distance;
        if (stiffness !== undefined) car.SuspensionStiffness = stiffness;
        if (steerAngle !== undefined) car.SteerAngle = steerAngle;
        if (offset !== undefined) car.WheelOffset = offset;
        
        const saved = await saveCar(authToken, car);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { carId, modifications: 'applied' }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 车辆悬挂修改错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// === 全局解锁 ===

// 13. 全局解锁功能
app.post('/api/global-unlock', async (req, res) => {
    console.log('🔓 全局解锁请求:', req.body);
    
    const { authToken, unlockType } = req.body;
    
    if (!authToken || !unlockType) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        switch (unlockType) {
            case 'horns':
                accountData.allHornsUnlocked = true;
                accountData.horns = 'all';
                break;
            case 'all_cars':
                accountData.allCarsUnlocked = true;
                accountData.garageLevel = 999;
                break;
            case 'levels':
            case 'achievements':
                accountData.allAchievementsUnlocked = true;
                accountData.level = 999;
                accountData.experience = 99999999;
                break;
            default:
                return res.json({ ok: false, error: 400, message: "UNKNOWN_UNLOCK_TYPE" });
        }
        
        const saved = await saveAccountData(authToken, accountData);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { unlockType, status: 'unlocked' }
            });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        console.error('💥 全局解锁错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// === 账号克隆 ===

// 14. 克隆账号
app.post('/api/clone-account', async (req, res) => {
    console.log('🧬 克隆账号请求');
    
    const { sourceAuth, targetEmail, targetPassword, customLocalId, autoRegister } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
        return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    try {
        // 获取源账号数据
        const sourceData = await getAccountData(sourceAuth);
        if (!sourceData) {
            return res.json({ ok: false, error: 404, message: "SOURCE_ACCOUNT_NOT_FOUND" });
        }
        
        // 获取源车辆
        const url = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url, { data: null }, {
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json",
            "User-Agent": "okhttp/3.12.13"
        });
        
        let sourceCars = [];
        if (carsResponse?.result) {
            try { sourceCars = JSON.parse(carsResponse.result); } catch (e) { sourceCars = carsResponse.result; }
        }
        
        // 处理目标账号
        let targetAuth;
        
        if (autoRegister) {
            // 自动注册
            const regUrl = `${FIREBASE_AUTH_URL}/signupNewUser`;
            const regResponse = await sendCPMRequest(regUrl, {
                email: targetEmail,
                password: targetPassword,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            }, { "Content-Type": "application/json" }, { key: FIREBASE_API_KEY });
            
            if (regResponse?.idToken) {
                targetAuth = regResponse.idToken;
            } else {
                return res.json({ ok: false, error: 400, message: "AUTO_REGISTER_FAILED" });
            }
        } else {
            // 登录目标账号
            const loginUrl = `${FIREBASE_AUTH_URL}/verifyPassword`;
            const loginResponse = await sendCPMRequest(loginUrl, {
                email: targetEmail,
                password: targetPassword,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            }, { "Content-Type": "application/json" }, { key: FIREBASE_API_KEY });
            
            if (loginResponse?.idToken) {
                targetAuth = loginResponse.idToken;
            } else {
                return res.json({ ok: false, error: 401, message: "TARGET_LOGIN_FAILED" });
            }
        }
        
        // 生成新ID
        const newId = customLocalId || generateId(10);
        const oldId = sourceData.localID || sourceData.localId;
        
        // 准备目标数据
        const targetData = { ...sourceData };
        targetData.localID = newId;
        targetData.localId = newId;
        delete targetData._id;
        delete targetData.id;
        
        // 保存目标数据
        const saved = await saveAccountData(targetAuth, targetData);
        
        if (!saved) {
            return res.json({ ok: false, error: 500, message: "SAVE_TARGET_FAILED" });
        }
        
        // 克隆车辆
        let clonedCars = 0;
        if (Array.isArray(sourceCars)) {
            for (const car of sourceCars) {
                const carCopy = { ...car };
                const carStr = JSON.stringify(carCopy);
                const newCarStr = carStr.replace(new RegExp(escapeRegExp(oldId), 'g'), newId);
                const newCar = JSON.parse(newCarStr);
                
                delete newCar._id;
                delete newCar.id;
                
                const carSaved = await saveCar(targetAuth, newCar);
                if (carSaved) clonedCars++;
            }
        }
        
        res.json({
            ok: true,
            error: 0,
            message: "SUCCESSFUL",
            details: {
                targetEmail,
                newLocalId: newId,
                carsCloned: clonedCars
            }
        });
    } catch (error) {
        console.error('💥 克隆错误:', error);
        res.json({ ok: false, error: 500, message: "CLONE_FAILED: " + error.message });
    }
});

// === 账号管理 ===

// 15. 一键修复
app.post('/api/fix-account', async (req, res) => {
    console.log('🔧 一键修复请求');
    
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 400, message: "MISSING_TOKEN" });
    }
    
    try {
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        // 设置默认值
        const defaultData = {
            coin: 500000000,
            cash: 500000000,
            level: 100,
            wins: 1000,
            loses: 0,
            experience: 99999999,
            fuel: 999999,
            garageLevel: 50
        };
        
        // 合并数据
        Object.assign(accountData, defaultData);
        accountData.Coin = defaultData.coin;
        accountData.Cash = defaultData.cash;
        
        const saved = await saveAccountData(authToken, accountData);
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                details: { status: 'fixed', defaults: defaultData }
            });
        } else {
            res.json({ ok: false, error: 500, message: "FIX_FAILED" });
        }
    } catch (error) {
        console.error('💥 修复错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// 16. 删除账号
app.post('/api/delete-account', async (req, res) => {
    console.log('⛔ 删除账号请求');
    
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 400, message: "MISSING_TOKEN" });
    }
    
    try {
        // 获取账号数据
        const accountData = await getAccountData(authToken);
        if (!accountData) {
            return res.json({ ok: false, error: 404, message: "ACCOUNT_NOT_FOUND" });
        }
        
        // 清空数据
        const emptyData = {
            localID: accountData.localID || accountData.localId,
            coin: 0,
            cash: 0,
            level: 0,
            wins: 0,
            loses: 0
        };
        
        // 保存空数据
        const saved = await saveAccountData(authToken, emptyData);
        
        // 删除所有车辆
        const cars = await getAllCars(authToken);
        if (Array.isArray(cars)) {
            for (const car of cars) {
                const emptyCar = {
                    CarID: car.CarID,
                    HP: 0,
                    NM: 0
                };
                await saveCar(authToken, emptyCar);
            }
        }
        
        if (saved) {
            res.json({
                ok: true,
                error: 0,
                message: "ACCOUNT_DELETED"
            });
        } else {
            res.json({ ok: false, error: 500, message: "DELETE_FAILED" });
        }
    } catch (error) {
        console.error('💥 删除错误:', error);
        res.json({ ok: false, error: 500, message: "SERVER_ERROR: " + error.message });
    }
});

// === 密钥管理（管理员） ===

// 17. 生成新密钥
app.post('/api/generate-key', async (req, res) => {
    const { adminKey, note, isTest, count, duration, maxDev, maxAcc, limits } = req.body;
    
    // 验证管理员权限
    if (!keyManagement.adminKeys.includes(adminKey)) {
        return res.json({ ok: false, error: 403, message: "ADMIN_ONLY" });
    }
    
    try {
        const generatedKeys = [];
        const numKeys = Math.min(count || 1, 100);
        
        for (let i = 0; i < numKeys; i++) {
            const keyPrefix = isTest ? 'KSJBC-TEST-' : 'KSJBC-';
            const key = keyPrefix + generateId(12);
            
            const keyData = {
                key,
                note: note || `Generated Key ${i + 1}`,
                isAdmin: false,
                isTest: isTest || false,
                duration: Number(duration) || 24,
                maxDevices: Number(maxDev) || 1,
                maxAccounts: Number(maxAcc) || 1,
                limits: {
                    coins: limits?.coins || 1,
                    cash: limits?.cash || 1,
                    name: limits?.name || 1,
                    wins: limits?.wins || 1,
                    loses: limits?.loses || 1,
                    id: limits?.id || 1,
                    w16: limits?.w16 || 1,
                    fuel: limits?.fuel || 1,
                    damage: limits?.damage || 1,
                    smoke: limits?.smoke || 1,
                    houses: limits?.houses || 1,
                    police: limits?.police || 1,
                    clone: limits?.clone || 1,
                    carMod: limits?.carMod || 1,
                    init: limits?.init || 1,
                    unlock: limits?.unlock || 1,
                    delete: limits?.delete || 1
                },
                usedDevices: [],
                usedAccounts: [],
                usageCount: 0,
                createdAt: Date.now(),
                expiresAt: Date.now() + (Number(duration) || 24) * 3600000
            };
            
            keyManagement.addKey(keyData);
            generatedKeys.push(key);
        }
        
        res.json({
            ok: true,
            error: 0,
            message: "SUCCESSFUL",
            keys: generatedKeys
        });
    } catch (error) {
        console.error('💥 生成密钥错误:', error);
        res.json({ ok: false, error: 500, message: "GENERATE_FAILED" });
    }
});

// 18. 获取所有密钥
app.post('/api/get-all-keys', async (req, res) => {
    const { adminKey } = req.body;
    
    if (!keyManagement.adminKeys.includes(adminKey)) {
        return res.json({ ok: false, error: 403, message: "ADMIN_ONLY" });
    }
    
    const allKeys = keyManagement.getAllKeys().map(k => ({
        key: k.key,
        note: k.note,
        isAdmin: k.isAdmin,
        isTest: k.isTest,
        expiresAt: k.expiresAt,
        maxDevices: k.maxDevices,
        maxAccounts: k.maxAccounts,
        usedDevices: k.usedDevices.length,
        usedAccounts: k.usedAccounts.length,
        usageCount: k.usageCount,
        limits: k.limits,
        createdAt: k.createdAt
    }));
    
    res.json({
        ok: true,
        error: 0,
        message: "SUCCESSFUL",
        keys: allKeys
    });
});

// 19. 删除密钥
app.post('/api/delete-key', async (req, res) => {
    const { adminKey, targetKey } = req.body;
    
    if (!keyManagement.adminKeys.includes(adminKey)) {
        return res.json({ ok: false, error: 403, message: "ADMIN_ONLY" });
    }
    
    const deleted = keyManagement.deleteKey(targetKey);
    
    res.json({
        ok: true,
        error: 0,
        message: deleted ? "KEY_DELETED" : "KEY_NOT_FOUND"
    });
});

// 20. 清理过期密钥
app.post('/api/clean-expired-keys', async (req, res) => {
    const { adminKey } = req.body;
    
    if (!keyManagement.adminKeys.includes(adminKey)) {
        return res.json({ ok: false, error: 403, message: "ADMIN_ONLY" });
    }
    
    let cleanedCount = 0;
    const allKeys = keyManagement.getAllKeys();
    
    for (const keyData of allKeys) {
        if (keyData.expiresAt && Date.now() > keyData.expiresAt && !keyData.isAdmin) {
            keyManagement.deleteKey(keyData.key);
            cleanedCount++;
        }
    }
    
    res.json({
        ok: true,
        error: 0,
        message: "SUCCESSFUL",
        cleanedCount
    });
});

// === 辅助函数 ===

async function getAccountData(authToken) {
    const url = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const response = await sendCPMRequest(url, { data: null }, {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    });
    
    if (response?.result) {
        try {
            return JSON.parse(response.result);
        } catch (e) {
            return response.result;
        }
    }
    return null;
}

async function saveAccountData(authToken, data) {
    const cleanData = { ...data };
    delete cleanData._id;
    delete cleanData.id;
    delete cleanData.createdAt;
    delete cleanData.updatedAt;
    delete cleanData.__v;
    
    const url = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
    const response = await sendCPMRequest(url, { 
        data: JSON.stringify(cleanData)
    }, {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    });
    
    return response?.result === '{"result":1}' || response?.result === 1;
}

async function getAllCars(authToken) {
    const url = `${CPM_BASE_URL}/TestGetAllCars`;
    const response = await sendCPMRequest(url, { data: null }, {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    });
    
    if (response?.result) {
        try {
            return JSON.parse(response.result);
        } catch (e) {
            return response.result;
        }
    }
    return [];
}

async function saveCar(authToken, carData) {
    const cleanCar = { ...carData };
    delete cleanCar._id;
    delete cleanCar.id;
    delete cleanCar.createdAt;
    delete cleanCar.updatedAt;
    delete cleanCar.__v;
    
    const url = `${CPM_BASE_URL}/SaveCars`;
    const response = await sendCPMRequest(url, { 
        data: JSON.stringify(cleanCar)
    }, {
        "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
        "Authorization": `Bearer ${authToken}`,
        "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "okhttp/3.12.13"
    });
    
    return response?.result === '{"result":1}' || response?.result === 1;
}

async function updateCarsId(authToken, oldId, newId) {
    const cars = await getAllCars(authToken);
    for (const car of cars) {
        const carStr = JSON.stringify(car);
        const newCarStr = carStr.replace(new RegExp(escapeRegExp(oldId), 'g'), newId);
        const newCar = JSON.parse(newCarStr);
        newCar.CarID = newCar.CarID ? newCar.CarID.replace(new RegExp(escapeRegExp(oldId), 'g'), newId) : newCar.CarID;
        await saveCar(authToken, newCar);
    }
}

async function initializeAccount(authToken, localId) {
    const defaultData = {
        localID: localId,
        localId: localId,
        Name: "Player",
        coin: 500000000,
        cash: 500000000,
        level: 100,
        wins: 1000,
        loses: 0,
        experience: 99999999,
        fuel: 999999,
        garageLevel: 50
    };
    return await saveAccountData(authToken, defaultData);
}

// === 基础路由 ===

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'CPM Pro Backend',
        timestamp: new Date().toISOString(),
        version: '3.0-complete',
        activeKeys: keyManagement.getAllKeys().length
    });
});

app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'CPM Pro API is working',
        timestamp: new Date().toISOString(),
        firebase_key: FIREBASE_API_KEY ? 'Set' : 'Not set'
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`
    🚀 CPM Pro 完整后端服务已启动
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    🔑 Firebase API Key: ${FIREBASE_API_KEY ? '已设置 ✓' : '未设置 ✗'}
    ⚡ 版本: 3.0-complete
    
    功能列表:
    ✅ 密钥验证系统
    ✅ 账号登录/注册
    ✅ 资源修改（金币/绿钞/胜场/败场/名字/ID）
    ✅ 黑科技（W16/燃油/无伤/烟雾/房产/警灯）
    ✅ 车辆深度定制（性能/外观/悬挂）
    ✅ 全局解锁（喇叭/车辆/成就）
    ✅ 账号克隆
    ✅ 一键修复
    ✅ 账号删除
    ✅ 密钥管理（管理员）
    
    启动时间: ${new Date().toLocaleString()}
    ====================================
    `);
});

module.exports = app;
