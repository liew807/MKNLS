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

// 请求函数
async function sendCPMRequest(url, payload, headers, params = {}, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const fullUrl = params && Object.keys(params).length 
                ? url + '?' + new URLSearchParams(params).toString() 
                : url;
            
            console.log(`📡 请求: ${fullUrl.substring(0, 80)}...`);
            
            const response = await axios({
                method: 'post',
                url: fullUrl,
                data: payload,
                headers: headers,
                timeout: 15000,
                validateStatus: function (status) {
                    return status < 500;
                }
            });
            
            console.log(`✅ 响应状态: ${response.status}`);
            
            if (response.status === 429) {
                const waitTime = Math.min(2000 * attempt, 5000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response.data;
            
        } catch (error) {
            lastError = error;
            console.error(`❌ 尝试 ${attempt} 失败:`, error.message);
            
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    throw lastError;
}

// 辅助函数：获取认证令牌
async function getAuthToken(authToken, email, password) {
    if (authToken) return authToken;
    
    if (!email || !password) {
        throw new Error('需要提供认证令牌或登录信息');
    }
    
    const loginResponse = await axios({
        method: 'post',
        url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
        data: {
            email: email,
            password: password,
            returnSecureToken: true,
            clientType: "CLIENT_TYPE_ANDROID"
        },
        headers: { "Content-Type": "application/json" },
        timeout: 10000
    });
    
    if (!loginResponse.data?.idToken) {
        throw new Error('登录失败');
    }
    
    return loginResponse.data.idToken;
}

// 辅助函数：保存玩家数据
async function savePlayerData(authToken, playerData) {
    ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(field => {
        delete playerData[field];
    });
    
    const response = await sendCPMRequest(
        `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
        { data: JSON.stringify(playerData) },
        {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "User-Agent": "okhttp/3.12.13"
        }
    );
    
    return response;
}

// ==================== API 端点 ====================

// 1. 账号登录
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔑 登录尝试:', { email });
        
        if (!email || !password) {
            return res.json({
                ok: false,
                error: 400,
                message: "请输入邮箱和密码"
            });
        }

        const response = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: {
                email: email,
                password: password,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            },
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0"
            },
            timeout: 10000
        });
        
        if (response.data && response.data.idToken) {
            console.log('✅ 登录成功:', email);
            res.json({
                ok: true,
                error: 0,
                message: "登录成功",
                auth: response.data.idToken,
                refreshToken: response.data.refreshToken,
                expiresIn: response.data.expiresIn,
                localId: response.data.localId,
                email: email
            });
        } else {
            throw new Error('无效的响应');
        }
        
    } catch (error) {
        console.error('❌ 登录失败:', error.response?.data || error.message);
        
        const errorMessage = error.response?.data?.error?.message || error.message;
        let userMessage = "登录失败";
        
        if (errorMessage.includes('EMAIL_NOT_FOUND')) {
            userMessage = "邮箱未注册";
        } else if (errorMessage.includes('INVALID_PASSWORD')) {
            userMessage = "密码错误";
        } else if (errorMessage.includes('INVALID_EMAIL')) {
            userMessage = "邮箱格式不正确";
        } else if (errorMessage.includes('TOO_MANY_ATTEMPTS')) {
            userMessage = "尝试次数过多，请稍后再试";
        }
        
        res.json({
            ok: false,
            error: 401,
            message: userMessage
        });
    }
});

// 2. 获取账号数据 【修复版】
app.post('/api/get-account-data', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        console.log('📥 获取账号数据请求...');
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "缺少认证令牌" });
        }
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        console.log('📦 GetPlayerRecords2 响应:', response);
        
        if (response?.result) {
            let accountData;
            try {
                accountData = JSON.parse(response.result);
            } catch (e) {
                accountData = response.result;
            }
            
            console.log('✅ 账号数据获取成功');
            
            // 🔥 修复：统一返回格式，确保 data 字段存在
            res.json({
                ok: true,
                error: 0,
                message: "获取成功",
                data: accountData
            });
        } else {
            console.log('❌ 获取账号数据失败');
            res.json({
                ok: false,
                error: 404,
                message: "获取账号数据失败"
            });
        }
    } catch (error) {
        console.error('❌ 获取账号数据错误:', error.message);
        res.json({
            ok: false,
            error: 500,
            message: "服务器错误: " + error.message
        });
    }
});

// 3. 获取所有车辆
app.post('/api/get-all-cars', async (req, res) => {
    try {
        const { authToken } = req.body;
        if (!authToken) return res.json({ ok: false, error: 401, message: "缺少认证令牌" });
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            res.json({ ok: true, error: 0, message: "获取成功", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "获取车辆数据失败", data: [] });
        }
    } catch (error) {
        console.error('获取车辆错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 4. 修改本地ID
app.post('/api/change-localid', async (req, res) => {
    try {
        const { email, password, newLocalId, authToken: providedToken } = req.body;
        
        if (!newLocalId) {
            return res.json({ ok: false, result: 0, message: "缺少新ID" });
        }
        
        const authToken = await getAuthToken(providedToken, email, password);
        
        console.log('📥 获取账号数据...');
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, result: 0, message: "获取账号数据失败" });
        }
        
        const accountData = JSON.parse(accountResponse.result);
        const oldLocalId = accountData.localID || accountData.localId || '';
        const cleanOldId = removeColorCodes(oldLocalId);
        
        if (newLocalId === cleanOldId) {
            return res.json({ ok: false, result: 0, message: "新ID与当前ID相同" });
        }
        
        accountData.localID = newLocalId;
        if (accountData.localId !== undefined) accountData.localId = newLocalId;
        
        console.log('💾 保存新账号数据...');
        const saveResponse = await savePlayerData(authToken, accountData);
        
        if (!saveResponse?.result) {
            return res.json({ ok: false, result: 0, message: "保存账号数据失败" });
        }
        
        console.log('🚗 获取车辆数据...');
        const carsResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        let updatedCars = 0;
        let failedCars = 0;
        
        if (carsResponse?.result) {
            const carsData = JSON.parse(carsResponse.result);
            const cars = Array.isArray(carsData) ? carsData : [];
            
            for (let i = 0; i < cars.length; i++) {
                try {
                    const car = cars[i];
                    let carStr = JSON.stringify(car);
                    
                    if (oldLocalId) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                    }
                    if (cleanOldId && cleanOldId !== oldLocalId) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(cleanOldId), 'g'), newLocalId);
                    }
                    
                    const carCopy = JSON.parse(carStr);
                    ['_id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete carCopy[f]);
                    
                    const carSaveRes = await sendCPMRequest(
                        `${CPM_BASE_URL}/SaveCars`,
                        { data: JSON.stringify(carCopy) },
                        {
                            "Authorization": `Bearer ${authToken}`,
                            "Content-Type": "application/json",
                            "User-Agent": "okhttp/3.12.13"
                        }
                    );
                    
                    if (carSaveRes?.result) {
                        updatedCars++;
                    } else {
                        failedCars++;
                    }
                    
                    if (i < cars.length - 1) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                } catch (error) {
                    failedCars++;
                }
            }
        }
        
        res.json({
            ok: true,
            result: 1,
            message: "ID修改成功！",
            details: {
                oldLocalId: cleanOldId,
                newLocalId: newLocalId,
                carsUpdated: updatedCars,
                carsFailed: failedCars
            }
        });
        
    } catch (error) {
        console.error('修改ID错误:', error);
        res.json({ ok: false, result: 0, message: `操作失败: ${error.message}` });
    }
});

// 5. 克隆账号
app.post('/api/clone-account', async (req, res) => {
    console.log('收到克隆请求');
    const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
        return res.json({ ok: false, error: 400, message: "Missing required parameters" });
    }
    
    try {
        console.log('获取源账号数据...');
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, error: 404, message: "Failed to get source account data" });
        }
        
        const sourceData = JSON.parse(accountResponse.result);
        let from_id = sourceData.localID || sourceData.localId;
        const clean_from_id = removeColorCodes(from_id);
        
        console.log('获取源账号车辆...');
        const carsResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        let sourceCars = [];
        if (carsResponse?.result) {
            try { sourceCars = JSON.parse(carsResponse.result); } catch (e) { sourceCars = carsResponse.result; }
        }
        
        const carCount = Array.isArray(sourceCars) ? sourceCars.length : 0;
        console.log(`源账号有 ${carCount} 辆车`);
        
        console.log('登录目标账号...');
        const targetAuth = await getAuthToken(null, targetEmail, targetPassword);
        
        let to_id;
        if (customLocalId && customLocalId.trim() !== '') {
            to_id = customLocalId.trim();
        } else {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            to_id = '';
            for (let i = 0; i < 10; i++) {
                to_id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        }
        
        const targetAccountData = { ...sourceData, localID: to_id, localId: to_id };
        if (!targetAccountData.Name) targetAccountData.Name = "Player";
        if (!targetAccountData.money) targetAccountData.money = 500000000;
        
        console.log('保存目标账号数据...');
        const saveDataResponse = await savePlayerData(targetAuth, targetAccountData);
        
        if (!saveDataResponse?.result) {
            return res.json({ ok: false, error: 500, message: "Failed to save target account data." });
        }
        
        let clonedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(sourceCars) && sourceCars.length > 0) {
            for (let i = 0; i < sourceCars.length; i++) {
                try {
                    const car = sourceCars[i];
                    let carStr = JSON.stringify(car);
                    
                    if (from_id) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                    }
                    if (clean_from_id && clean_from_id !== from_id) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                    }
                    
                    const carCopy = JSON.parse(carStr);
                    ['_id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete carCopy[f]);
                    
                    const saveCarResponse = await sendCPMRequest(
                        `${CPM_BASE_URL}/SaveCars`,
                        { data: JSON.stringify(carCopy) },
                        {
                            "Authorization": `Bearer ${targetAuth}`,
                            "Content-Type": "application/json",
                            "User-Agent": "okhttp/3.12.13"
                        }
                    );
                    
                    if (saveCarResponse?.result) {
                        clonedCars++;
                    } else {
                        failedCars++;
                    }
                    
                    if (i < sourceCars.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    failedCars++;
                }
            }
        }
        
        res.json({
            ok: true,
            error: 0,
            message: `Account cloned successfully! ${clonedCars} cars cloned.`,
            details: {
                targetAccount: targetEmail,
                carsCloned: clonedCars,
                carsFailed: failedCars,
                newLocalId: to_id
            }
        });
        
    } catch (error) {
        console.error('克隆过程错误:', error);
        res.json({ ok: false, error: 500, message: `Clone failed: ${error.message}` });
    }
});

// 6. 单独修改绿钞
app.post('/api/modify-green-cash', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        
        console.log('💚 修改绿钞:', { amount, operationType });
        
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入绿钞数量" });
        }
        
        const greenCashAmount = Number(amount);
        if (isNaN(greenCashAmount) || greenCashAmount < 0) {
            return res.json({ ok: false, error: 400, message: "绿钞数量无效" });
        }
        
        const token = await getAuthToken(authToken, email, password);
        
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, error: 404, message: "获取账号数据失败" });
        }
        
        const playerData = JSON.parse(accountResponse.result);
        const currentGreenCash = playerData.cash || playerData.Cash || 0;
        
        let newGreenCash;
        if (operationType === 'max') {
            newGreenCash = 999999999;
        } else if (operationType === 'add') {
            newGreenCash = Math.min(currentGreenCash + greenCashAmount, 999999999);
        } else {
            newGreenCash = Math.min(greenCashAmount, 999999999);
        }
        
        playerData.cash = newGreenCash;
        playerData.Cash = newGreenCash;
        playerData.greenCash = newGreenCash;
        
        const saveResponse = await savePlayerData(token, playerData);
        
        if (saveResponse?.result) {
            res.json({
                ok: true,
                error: 0,
                message: "绿钞修改成功",
                details: {
                    currency: 'greenCash',
                    oldValue: currentGreenCash,
                    newValue: newGreenCash
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }
        
    } catch (error) {
        console.error('修改绿钞错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 7. 单独修改金币
app.post('/api/modify-gold-coins', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        
        console.log('💛 修改金币:', { amount, operationType });
        
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入金币数量" });
        }
        
        const goldCoinsAmount = Number(amount);
        if (isNaN(goldCoinsAmount) || goldCoinsAmount < 0) {
            return res.json({ ok: false, error: 400, message: "金币数量无效" });
        }
        
        const token = await getAuthToken(authToken, email, password);
        
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, error: 404, message: "获取账号数据失败" });
        }
        
        const playerData = JSON.parse(accountResponse.result);
        const currentGoldCoins = playerData.coin || playerData.Coin || playerData.money || 0;
        
        let newGoldCoins;
        if (operationType === 'max') {
            newGoldCoins = 999999999;
        } else if (operationType === 'add') {
            newGoldCoins = Math.min(currentGoldCoins + goldCoinsAmount, 999999999);
        } else {
            newGoldCoins = Math.min(goldCoinsAmount, 999999999);
        }
        
        playerData.coin = newGoldCoins;
        playerData.Coin = newGoldCoins;
        playerData.money = newGoldCoins;
        playerData.Money = newGoldCoins;
        
        const saveResponse = await savePlayerData(token, playerData);
        
        if (saveResponse?.result) {
            res.json({
                ok: true,
                error: 0,
                message: "金币修改成功",
                details: {
                    currency: 'goldCoins',
                    oldValue: currentGoldCoins,
                    newValue: newGoldCoins
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }
        
    } catch (error) {
        console.error('修改金币错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 8. 一键最大货币
app.post('/api/max-money', async (req, res) => {
    try {
        const { authToken, email, password } = req.body;
        
        console.log('💎 一键最大货币');
        
        const token = await getAuthToken(authToken, email, password);
        
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, error: 404, message: "获取账号数据失败" });
        }
        
        const playerData = JSON.parse(accountResponse.result);
        const MAX_VALUE = 999999999;
        
        playerData.cash = MAX_VALUE;
        playerData.Cash = MAX_VALUE;
        playerData.greenCash = MAX_VALUE;
        playerData.coin = MAX_VALUE;
        playerData.Coin = MAX_VALUE;
        playerData.money = MAX_VALUE;
        playerData.Money = MAX_VALUE;
        
        const saveResponse = await savePlayerData(token, playerData);
        
        if (saveResponse?.result) {
            res.json({ ok: true, error: 0, message: "货币已设置为最大值" });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }
        
    } catch (error) {
        console.error('一键最大错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy API',
        timestamp: new Date().toISOString(),
        version: '5.0-fixed'
    });
});

// 测试端点
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'cpmcy API is working',
        timestamp: new Date().toISOString()
    });
});

// 主页
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`
    🚀 CPM API Server 已启动
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    ⚡ 版本: 5.0-fixed (修复会话验证)
    ====================================
    `);
});
