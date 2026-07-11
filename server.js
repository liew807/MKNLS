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

// 增强的请求函数
async function sendCPMRequest(url, payload, headers, params = {}, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const fullUrl = params && Object.keys(params).length 
                ? url + '?' + new URLSearchParams(params).toString() 
                : url;
            
            console.log(`📡 请求 ${attempt}/${maxRetries}: ${fullUrl.substring(0, 80)}...`);
            
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
                console.log(`⏳ 请求过多，等待 ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response.data;
            
        } catch (error) {
            lastError = error;
            console.error(`❌ 尝试 ${attempt} 失败:`, error.message);
            
            if (attempt < maxRetries) {
                const waitTime = 1000 * attempt;
                await new Promise(resolve => setTimeout(resolve, waitTime));
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
    
    console.log('🔑 使用邮箱密码登录...');
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
        throw new Error('登录失败，请检查邮箱和密码');
    }
    
    return loginResponse.data.idToken;
}

// 辅助函数：获取玩家数据
async function getPlayerData(authToken) {
    const response = await sendCPMRequest(
        `${CPM_BASE_URL}/GetPlayerRecords2`,
        { data: null },
        {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "User-Agent": "okhttp/3.12.13"
        }
    );
    
    if (!response?.result) {
        throw new Error('获取账号数据失败');
    }
    
    return JSON.parse(response.result);
}

// 辅助函数：保存玩家数据
async function savePlayerData(authToken, playerData) {
    // 清理字段
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

// 2. 获取账号数据
app.post('/api/get-account-data', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "缺少认证令牌" });
        }
        
        const data = await getPlayerData(authToken);
        res.json({ ok: true, error: 0, message: "获取成功", data: data });
        
    } catch (error) {
        console.error('获取账号数据错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
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
            const data = JSON.parse(response.result);
            res.json({ ok: true, error: 0, message: "获取成功", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "获取车辆数据失败" });
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
        
        // 获取认证令牌
        const authToken = await getAuthToken(providedToken, email, password);
        
        // 获取账号数据
        console.log('📥 获取账号数据...');
        const accountData = await getPlayerData(authToken);
        const oldLocalId = accountData.localID || accountData.localId || '';
        const cleanOldId = removeColorCodes(oldLocalId);
        
        if (newLocalId === cleanOldId) {
            return res.json({ ok: false, result: 0, message: "新ID与当前ID相同" });
        }
        
        // 更新ID
        accountData.localID = newLocalId;
        if (accountData.localId !== undefined) accountData.localId = newLocalId;
        
        // 保存账号数据
        console.log('💾 保存新账号数据...');
        const saveResponse = await savePlayerData(authToken, accountData);
        
        if (!saveResponse?.result) {
            console.error('保存失败:', saveResponse);
            return res.json({ ok: false, result: 0, message: "保存账号数据失败" });
        }
        
        console.log('✅ 账号数据保存成功');
        
        // 获取并更新车辆
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
            
            console.log(`📊 找到 ${cars.length} 辆车需要更新`);
            
            if (cars.length > 0) {
                for (let i = 0; i < cars.length; i++) {
                    try {
                        const car = cars[i];
                        let carStr = JSON.stringify(car);
                        
                        // 替换所有出现的旧ID
                        if (oldLocalId) {
                            carStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                        }
                        if (cleanOldId && cleanOldId !== oldLocalId) {
                            carStr = carStr.replace(new RegExp(escapeRegExp(cleanOldId), 'g'), newLocalId);
                        }
                        
                        const carCopy = JSON.parse(carStr);
                        
                        // 清理字段
                        ['_id', 'createdAt', 'updatedAt', '__v'].forEach(field => {
                            delete carCopy[field];
                        });
                        
                        // 保存车辆
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
                        
                        // 添加延迟避免请求过快
                        if (i < cars.length - 1) {
                            await new Promise(r => setTimeout(r, 200));
                        }
                        
                    } catch (error) {
                        failedCars++;
                        console.error(`车辆 ${i} 更新失败:`, error.message);
                    }
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
        return res.json({
            ok: false,
            error: 400,
            message: "Missing required parameters"
        });
    }
    
    try {
        // 步骤 1: 获取源账号数据
        console.log('获取源账号数据...');
        const sourceData = await getPlayerData(sourceAuth);
        let from_id = sourceData.localID || sourceData.localId;
        const clean_from_id = removeColorCodes(from_id);
        
        // 步骤 2: 获取源账号车辆
        console.log('获取源账号车辆...');
        const carsResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json"
            }
        );
        
        let sourceCars = [];
        if (carsResponse?.result) {
            try { sourceCars = JSON.parse(carsResponse.result); } catch (e) { sourceCars = carsResponse.result; }
        }
        
        const carCount = Array.isArray(sourceCars) ? sourceCars.length : 0;
        console.log(`源账号有 ${carCount} 辆车`);
        
        // 步骤 3: 登录目标账号
        console.log('登录目标账号...');
        const targetAuth = await getAuthToken(null, targetEmail, targetPassword);
        
        // 步骤 4: 生成新ID
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
        
        console.log(`新本地ID: ${to_id}`);
        
        // 步骤 5: 准备目标数据
        const targetAccountData = {
            ...sourceData,
            localID: to_id,
            localId: to_id
        };
        
        if (!targetAccountData.Name) targetAccountData.Name = "TELMunn";
        if (!targetAccountData.money) targetAccountData.money = 500000000;
        
        // 步骤 6: 保存目标账号
        console.log('保存目标账号数据...');
        const saveDataResponse = await savePlayerData(targetAuth, targetAccountData);
        
        if (!saveDataResponse?.result) {
            return res.json({
                ok: false,
                error: 500,
                message: `Failed to save target account data.`
            });
        }
        
        // 步骤 7: 克隆车辆
        let clonedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(sourceCars) && sourceCars.length > 0) {
            console.log(`开始克隆 ${carCount} 辆车...`);
            
            for (let i = 0; i < sourceCars.length; i++) {
                try {
                    const car = sourceCars[i];
                    let carStr = JSON.stringify(car);
                    
                    // 替换ID
                    if (from_id) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                    }
                    if (clean_from_id && clean_from_id !== from_id) {
                        carStr = carStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                    }
                    
                    const carCopy = JSON.parse(carStr);
                    
                    // 清理字段
                    ['_id', 'createdAt', 'updatedAt', '__v'].forEach(field => {
                        delete carCopy[field];
                    });
                    
                    // 保存车辆
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
                    
                    // 添加延迟
                    if (i < sourceCars.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                } catch (error) {
                    failedCars++;
                    console.error('车辆克隆错误:', error.message);
                }
            }
        }
        
        console.log(`克隆完成: ${clonedCars}成功, ${failedCars}失败`);
        
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
        res.json({
            ok: false,
            error: 500,
            message: `Clone failed: ${error.message}`
        });
    }
});

// ==================== 【重点修改】独立的货币修改接口 ====================

// 6. 单独修改绿钞
app.post('/api/modify-green-cash', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        
        console.log('💚 修改绿钞请求:', { amount, operationType });
        
        // 验证金额
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入绿钞数量" });
        }
        
        const greenCashAmount = Number(amount);
        if (isNaN(greenCashAmount) || greenCashAmount < 0) {
            return res.json({ ok: false, error: 400, message: "绿钞数量无效" });
        }
        
        // 获取认证令牌
        const token = await getAuthToken(authToken, email, password);
        
        // 获取当前数据
        console.log('📥 获取账号数据...');
        const playerData = await getPlayerData(token);
        
        // 查找当前绿钞值
        const currentGreenCash = playerData.cash || playerData.Cash || playerData.greenCash || 0;
        console.log(`💰 当前绿钞: ${currentGreenCash}`);
        
        // 计算新值
        let newGreenCash;
        switch (operationType) {
            case 'max':
                newGreenCash = 999999999;
                break;
            case 'add':
                newGreenCash = Math.min(currentGreenCash + greenCashAmount, 999999999);
                break;
            case 'set':
            default:
                newGreenCash = Math.min(greenCashAmount, 999999999);
                break;
        }
        
        console.log(`💚 新绿钞: ${newGreenCash}`);
        
        // 更新所有可能的绿钞字段
        playerData.cash = newGreenCash;
        playerData.Cash = newGreenCash;
        playerData.greenCash = newGreenCash;
        playerData.green_cash = newGreenCash;
        
        // 保存数据
        console.log('💾 保存数据...');
        const saveResponse = await savePlayerData(token, playerData);
        
        console.log('保存响应:', saveResponse);
        
        if (saveResponse?.result) {
            console.log('✅ 绿钞修改成功!');
            res.json({
                ok: true,
                error: 0,
                message: `绿钞修改成功！${currentGreenCash} → ${newGreenCash}`,
                details: {
                    currency: 'greenCash',
                    operationType: operationType,
                    oldValue: currentGreenCash,
                    newValue: newGreenCash,
                    formatted: {
                        old: currentGreenCash.toLocaleString(),
                        new: newGreenCash.toLocaleString()
                    }
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败，请重试" });
        }
        
    } catch (error) {
        console.error('❌ 修改绿钞错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 7. 单独修改金币
app.post('/api/modify-gold-coins', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        
        console.log('💛 修改金币请求:', { amount, operationType });
        
        // 验证金额
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入金币数量" });
        }
        
        const goldCoinsAmount = Number(amount);
        if (isNaN(goldCoinsAmount) || goldCoinsAmount < 0) {
            return res.json({ ok: false, error: 400, message: "金币数量无效" });
        }
        
        // 获取认证令牌
        const token = await getAuthToken(authToken, email, password);
        
        // 获取当前数据
        console.log('📥 获取账号数据...');
        const playerData = await getPlayerData(token);
        
        // 查找当前金币值
        const currentGoldCoins = playerData.coin || playerData.Coin || playerData.money || playerData.Money || 0;
        console.log(`💰 当前金币: ${currentGoldCoins}`);
        
        // 计算新值
        let newGoldCoins;
        switch (operationType) {
            case 'max':
                newGoldCoins = 999999999;
                break;
            case 'add':
                newGoldCoins = Math.min(currentGoldCoins + goldCoinsAmount, 999999999);
                break;
            case 'set':
            default:
                newGoldCoins = Math.min(goldCoinsAmount, 999999999);
                break;
        }
        
        console.log(`💛 新金币: ${newGoldCoins}`);
        
        // 更新所有可能的金币字段
        playerData.coin = newGoldCoins;
        playerData.Coin = newGoldCoins;
        playerData.money = newGoldCoins;
        playerData.Money = newGoldCoins;
        playerData.goldCoins = newGoldCoins;
        playerData.gold_coins = newGoldCoins;
        
        // 保存数据
        console.log('💾 保存数据...');
        const saveResponse = await savePlayerData(token, playerData);
        
        console.log('保存响应:', saveResponse);
        
        if (saveResponse?.result) {
            console.log('✅ 金币修改成功!');
            res.json({
                ok: true,
                error: 0,
                message: `金币修改成功！${currentGoldCoins} → ${newGoldCoins}`,
                details: {
                    currency: 'goldCoins',
                    operationType: operationType,
                    oldValue: currentGoldCoins,
                    newValue: newGoldCoins,
                    formatted: {
                        old: currentGoldCoins.toLocaleString(),
                        new: newGoldCoins.toLocaleString()
                    }
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败，请重试" });
        }
        
    } catch (error) {
        console.error('❌ 修改金币错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 8. 一键最大货币（快捷接口）
app.post('/api/max-money', async (req, res) => {
    try {
        const { authToken, email, password } = req.body;
        
        console.log('💎 一键最大货币');
        
        // 获取认证令牌
        const token = await getAuthToken(authToken, email, password);
        
        // 获取当前数据
        console.log('📥 获取账号数据...');
        const playerData = await getPlayerData(token);
        
        // 显示当前值
        const currentCash = playerData.cash || playerData.Cash || 0;
        const currentCoin = playerData.coin || playerData.Coin || playerData.money || 0;
        
        console.log(`💰 当前 - 绿钞: ${currentCash}, 金币: ${currentCoin}`);
        
        // 设置为最大值
        const MAX_VALUE = 999999999;
        
        // 更新绿钞
        playerData.cash = MAX_VALUE;
        playerData.Cash = MAX_VALUE;
        playerData.greenCash = MAX_VALUE;
        
        // 更新金币
        playerData.coin = MAX_VALUE;
        playerData.Coin = MAX_VALUE;
        playerData.money = MAX_VALUE;
        playerData.Money = MAX_VALUE;
        playerData.goldCoins = MAX_VALUE;
        
        // 保存
        console.log('💾 保存数据...');
        const saveResponse = await savePlayerData(token, playerData);
        
        if (saveResponse?.result) {
            console.log('✅ 货币已设置为最大值!');
            res.json({
                ok: true,
                error: 0,
                message: "货币已设置为最大值！",
                details: {
                    greenCash: {
                        oldValue: currentCash,
                        newValue: MAX_VALUE
                    },
                    goldCoins: {
                        oldValue: currentCoin,
                        newValue: MAX_VALUE
                    }
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败，请重试" });
        }
        
    } catch (error) {
        console.error('❌ 一键最大错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 9. 查询当前货币
app.post('/api/get-money', async (req, res) => {
    try {
        const { authToken, email, password } = req.body;
        
        // 获取认证令牌
        const token = await getAuthToken(authToken, email, password);
        
        // 获取当前数据
        console.log('📥 查询货币...');
        const playerData = await getPlayerData(token);
        
        // 查找货币值
        const greenCash = playerData.cash || playerData.Cash || playerData.greenCash || 0;
        const goldCoins = playerData.coin || playerData.Coin || playerData.money || playerData.Money || 0;
        
        console.log(`💰 绿钞: ${greenCash}, 金币: ${goldCoins}`);
        
        res.json({
            ok: true,
            error: 0,
            message: "查询成功",
            data: {
                greenCash: {
                    value: greenCash,
                    formatted: greenCash.toLocaleString()
                },
                goldCoins: {
                    value: goldCoins,
                    formatted: goldCoins.toLocaleString()
                }
            }
        });
        
    } catch (error) {
        console.error('❌ 查询货币错误:', error);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy API',
        timestamp: new Date().toISOString(),
        version: '4.0-separated-money'
    });
});

// 测试端点
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'cpmcy API is working',
        timestamp: new Date().toISOString(),
        endpoints: {
            login: '/api/login',
            modifyGreenCash: '/api/modify-green-cash',
            modifyGoldCoins: '/api/modify-gold-coins',
            maxMoney: '/api/max-money',
            getMoney: '/api/get-money',
            changeLocalId: '/api/change-localid',
            cloneAccount: '/api/clone-account'
        }
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
    🚀 CPM API Server 已启动 (独立货币版本)
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    ⚡ 版本: 4.0-separated-money
    
    📋 API接口列表:
    ┌─────────────────────────────────────────────┐
    │ 🔑 登录: POST /api/login                     │
    │ 💚 修改绿钞: POST /api/modify-green-cash     │
    │ 💛 修改金币: POST /api/modify-gold-coins     │
    │ 💎 一键最大: POST /api/max-money             │
    │ 💰 查询货币: POST /api/get-money             │
    │ 🆔 修改ID: POST /api/change-localid          │
    │ 📋 克隆账号: POST /api/clone-account         │
    └─────────────────────────────────────────────┘
    ====================================
    `);
});
