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

// 3个环境变量
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

// 增强的请求函数（带重试）
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
            
            // 处理429（太多请求）
            if (response.status === 429) {
                const waitTime = Math.min(2000 * attempt, 10000);
                console.log(`⏳ 请求过多，等待 ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            // 处理5xx服务器错误
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

// ==================== API 端点 ====================

// 1. 账号登录
app.post('/api/login', async (req, res) => {
    console.log('登录尝试:', { email: req.body.email });
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.json({
            ok: false,
            error: 400,
            message: "Missing email or password"
        });
    }

    const url = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
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
            console.log('登录成功:', email);
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                auth: response.idToken,
                refreshToken: response.refreshToken,
                expiresIn: response.expiresIn,
                localId: response.localId,
                email: email
            });
        } else {
            const error = response?.error?.message || "UNKNOWN_ERROR";
            console.log('登录失败:', error);
            res.json({
                ok: false,
                error: 401,
                message: error,
                auth: null
            });
        }
    } catch (error) {
        console.error('登录服务器错误:', error);
        res.json({
            ok: false,
            error: 500,
            message: "Server error: " + error.message
        });
    }
});

// 2. 获取账号数据
app.post('/api/get-account-data', async (req, res) => {
    const { authToken } = req.body;
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const url = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const payload = { data: null };
    const headers = {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    };
    
    try {
        const response = await sendCPMRequest(url, payload, headers);
        
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "UNKNOWN_ERROR", data: [] });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: "Server error" });
    }
});

// 3. 获取所有车辆
app.post('/api/get-all-cars', async (req, res) => {
    const { authToken } = req.body;
    if (!authToken) return res.json({ ok: false, error: 401, message: "Missing auth token" });
    
    const url = `${CPM_BASE_URL}/TestGetAllCars`;
    const payload = { data: null };
    const headers = {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    };
    
    try {
        const response = await sendCPMRequest(url, payload, headers);
        if (response?.result) {
            let data;
            try { data = JSON.parse(response.result); } catch (e) { data = response.result; }
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            res.json({ ok: false, error: 404, message: "UNKNOWN_ERROR", data: [] });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: "Server error" });
    }
});

// 4. 修改当前账号ID
app.post('/api/change-localid', async (req, res) => {
    console.log('收到修改ID请求');
    const { sourceEmail, sourcePassword, newLocalId, authToken: providedToken } = req.body;
    
    if (!newLocalId) {
        return res.json({ ok: false, result: 0, message: "Missing new local ID" });
    }
    
    let authToken = providedToken;
    let loginNeeded = !authToken;
    
    try {
        // 步骤 1: 验证或获取 Token
        if (authToken) {
            console.log('验证提供的Token...');
            const checkUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
            const checkRes = await sendCPMRequest(checkUrl, { data: null }, {
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            });
            
            if (!checkRes || !checkRes.result) {
                console.log('Token无效，使用账号密码重新登录');
                loginNeeded = true;
            }
        }
        
        // 如果需要登录
        if (loginNeeded) {
            if (!sourceEmail || !sourcePassword) {
                return res.json({ ok: false, result: 0, message: "Token expired and no credentials provided" });
            }
            
            const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
            const loginPayload = {
                email: sourceEmail,
                password: sourcePassword,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            };
            const loginParams = { key: FIREBASE_API_KEY };
            
            const loginResponse = await sendCPMRequest(loginUrl, loginPayload, {
                "Content-Type": "application/json"
            }, loginParams);
            
            if (!loginResponse?.idToken) {
                return res.json({ ok: false, result: 0, message: "Login failed. Check credentials." });
            }
            
            authToken = loginResponse.idToken;
            console.log('重新登录成功');
        }
        
        // 步骤 2: 获取账号数据
        console.log('获取账号数据...');
        const url1 = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const headers1 = {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        };
        
        const accountResponse = await sendCPMRequest(url1, { data: null }, headers1);
        if (!accountResponse?.result) {
            return res.json({ ok: false, result: 0, message: "Failed to get account data" });
        }
        
        let accountData;
        try { accountData = JSON.parse(accountResponse.result); } catch (e) { accountData = accountResponse.result; }
        
        let oldLocalId = accountData.localID || accountData.localId;
        const cleanOldLocalId = removeColorCodes(oldLocalId);
        
        if (newLocalId === cleanOldLocalId) {
            return res.json({ ok: false, result: 0, message: "New ID is same as old ID" });
        }
        
        // 步骤 3: 获取所有车辆
        console.log('获取车辆数据...');
        const url2 = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url2, { data: null }, headers1);
        let carsData = [];
        if (carsResponse?.result) {
            try { carsData = JSON.parse(carsResponse.result); } catch (e) { carsData = carsResponse.result; }
        }
        
        const carCount = Array.isArray(carsData) ? carsData.length : 0;
        console.log(`账号有 ${carCount} 辆车`);
        
        // 步骤 4: 更新账号ID
        console.log('更新账号ID...');
        accountData.localID = newLocalId;
        if (accountData.localId) accountData.localId = newLocalId;
        
        // 清理数据库字段
        delete accountData._id;
        delete accountData.id;
        delete accountData.createdAt;
        delete accountData.updatedAt;
        delete accountData.__v;
        
        // 步骤 5: 保存数据
        const url3 = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const updateRes = await sendCPMRequest(url3, { 
            data: JSON.stringify(accountData)
        }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        console.log('保存账号响应:', updateRes?.result);
        
        // 检查保存结果
        if (updateRes?.result !== '{"result":1}') {
            console.error('保存账号数据失败:', updateRes);
            return res.json({ ok: false, result: 0, message: "Failed to save account data" });
        }
        
        // 步骤 6: 更新车辆
        let updatedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(carsData) && carsData.length > 0) {
            console.log(`更新 ${carCount} 辆车...`);
            
            const batchSize = 3;
            for (let i = 0; i < carsData.length; i += batchSize) {
                const batch = carsData.slice(i, Math.min(i + batchSize, carsData.length));
                
                const batchPromises = batch.map(async (car) => {
                    try {
                        let carCopy = JSON.parse(JSON.stringify(car));
                        
                        // 替换ID
                        if (oldLocalId && cleanOldLocalId) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            try { carCopy = JSON.parse(newCarStr); } catch (e) {}
                        }
                        
                        // 清理字段
                        delete carCopy._id;
                        delete carCopy.createdAt;
                        delete carCopy.updatedAt;
                        delete carCopy.__v;
                        
                        // 更新CarID
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (carCopy.CarID.includes(oldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            }
                            if (carCopy.CarID.includes(cleanOldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            }
                        }
                        
                        // 保存车辆
                        const url4 = `${CPM_BASE_URL}/SaveCars`;
                        const carSaveRes = await sendCPMRequest(url4, { 
                            data: JSON.stringify(carCopy)
                        }, {
                            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                            "Authorization": `Bearer ${authToken}`,
                            "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
                            "Content-Type": "application/json; charset=utf-8",
                            "User-Agent": "okhttp/3.12.13"
                        });
                        
                        if (carSaveRes?.result === '{"result":1}') {
                            updatedCars++;
                            return true;
                        } else {
                            failedCars++;
                            return false;
                        }
                    } catch (error) {
                        failedCars++;
                        console.error('车辆更新错误:', error.message);
                        return false;
                    }
                });
                
                await Promise.all(batchPromises);
                
                // 批次间等待
                if (i + batchSize < carsData.length) {
                    const waitTime = 1000 + Math.random() * 1000;
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        }
        
        res.json({
            ok: true,
            result: 1,
            message: "Local ID changed successfully!",
            details: {
                oldLocalId: cleanOldLocalId,
                newLocalId: newLocalId,
                carsUpdated: updatedCars,
                carsFailed: failedCars
            }
        });
        
    } catch (error) {
        console.error('修改ID过程错误:', error);
        res.json({ 
            ok: false, 
            result: 0, 
            message: `Process failed: ${error.message}` 
        });
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
        const url1 = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const accountResponse = await sendCPMRequest(url1, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        if (!accountResponse?.result) {
            return res.json({
                ok: false,
                error: 404,
                message: "Failed to get source account data"
            });
        }
        
        let sourceData;
        try { sourceData = JSON.parse(accountResponse.result); } catch (e) { sourceData = accountResponse.result; }
        
        let from_id = sourceData.localID || sourceData.localId;
        const clean_from_id = removeColorCodes(from_id);
        
        // 步骤 2: 获取源账号车辆
        console.log('获取源账号车辆...');
        const url2 = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url2, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        let sourceCars = [];
        if (carsResponse?.result) {
            try { sourceCars = JSON.parse(carsResponse.result); } catch (e) { sourceCars = carsResponse.result; }
        }
        
        const carCount = Array.isArray(sourceCars) ? sourceCars.length : 0;
        console.log(`源账号有 ${carCount} 辆车`);
        
        // 步骤 3: 登录目标账号
        console.log('登录目标账号...');
        const url3 = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
        const loginResponse = await sendCPMRequest(url3, {
            email: targetEmail,
            password: targetPassword,
            returnSecureToken: true,
            clientType: "CLIENT_TYPE_ANDROID"
        }, {
            "Content-Type": "application/json"
        }, { key: FIREBASE_API_KEY });
        
        if (!loginResponse?.idToken) {
            const error = loginResponse?.error?.message || "UNKNOWN_ERROR";
            return res.json({
                ok: false,
                error: 401,
                message: `Failed to login to target account: ${error}`
            });
        }
        
        const targetAuth = loginResponse.idToken;
        
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
        
        // 清理字段
        delete targetAccountData._id;
        delete targetAccountData.id;
        delete targetAccountData.createdAt;
        delete targetAccountData.updatedAt;
        delete targetAccountData.__v;
        
        // 确保必要字段存在
        if (!targetAccountData.Name) targetAccountData.Name = "TELMunn";
        if (!targetAccountData.money) targetAccountData.money = 500000000;
        
        // 步骤 6: 保存目标账号
        console.log('保存目标账号数据...');
        const url5 = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const saveDataResponse = await sendCPMRequest(url5, { 
            data: JSON.stringify(targetAccountData) 
        }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${targetAuth}`,
            "Content-Type": "application/json"
        });
        
        console.log('保存响应:', saveDataResponse?.result);
        
        // 检查保存结果
        if (saveDataResponse?.result !== '{"result":1}') {
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
            
            const batchSize = 2;
            for (let i = 0; i < sourceCars.length; i += batchSize) {
                const batch = sourceCars.slice(i, Math.min(i + batchSize, sourceCars.length));
                
                const batchPromises = batch.map(async (car) => {
                    try {
                        let carCopy = JSON.parse(JSON.stringify(car));
                        
                        // 替换ID
                        if (from_id && clean_from_id) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                            try { carCopy = JSON.parse(newCarStr); } catch (e) {}
                        }
                        
                        // 清理字段
                        delete carCopy._id;
                        delete carCopy.createdAt;
                        delete carCopy.updatedAt;
                        delete carCopy.__v;
                        
                        // 更新CarID
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (from_id && carCopy.CarID.includes(from_id)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                            }
                            if (clean_from_id && carCopy.CarID.includes(clean_from_id)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                            }
                        }
                        
                        // 保存车辆
                        const url6 = `${CPM_BASE_URL}/SaveCars`;
                        const saveCarResponse = await sendCPMRequest(url6, { 
                            data: JSON.stringify(carCopy) 
                        }, {
                            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                            "Authorization": `Bearer ${targetAuth}`,
                            "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
                            "Content-Type": "application/json; charset=utf-8",
                            "User-Agent": "okhttp/3.12.13"
                        });
                        
                        if (saveCarResponse?.result === '{"result":1}') {
                            clonedCars++;
                            return true;
                        } else {
                            failedCars++;
                            return false;
                        }
                    } catch (error) {
                        failedCars++;
                        console.error('车辆克隆错误:', error.message);
                        return false;
                    }
                });
                
                await Promise.all(batchPromises);
                
                // 批次间等待
                if (i + batchSize < sourceCars.length) {
                    const waitTime = 2000 + Math.random() * 2000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
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

// 6. 修改绿钞和金币（修复版）
app.post('/api/modify-money', async (req, res) => {
  try {
    const { authToken, greenCash, goldCoins, operationType = 'set' } = req.body;
    
    console.log('💰 修改货币请求:', {
      操作类型: operationType,
      绿钞值: greenCash,
      金币值: goldCoins,
      令牌: authToken?.substring(0, 20) + '...'
    });
    
    // 验证参数
    if (!authToken) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    if (operationType !== 'max' && greenCash === undefined && goldCoins === undefined) {
      return res.json({ ok: false, error: 400, message: "Please provide greenCash or goldCoins" });
    }
    
    // 步骤1: 获取当前账号数据
    console.log('🔍 获取账号数据...');
    const playerDataUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (!playerData?.result) {
      console.error('❌ 获取账号数据失败');
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    
    const parsedPlayerData = JSON.parse(playerData.result);
    
    // 调试：查看所有货币相关字段
    console.log('📊 账号数据货币字段:');
    Object.keys(parsedPlayerData).forEach(key => {
      if (key.toLowerCase().includes('cash') || 
          key.toLowerCase().includes('coin') || 
          key.toLowerCase().includes('money') ||
          key.toLowerCase().includes('gold') ||
          key.toLowerCase().includes('green')) {
        console.log(`  ${key}: ${parsedPlayerData[key]}`);
      }
    });
    
    // 获取当前值（修复：使用正确的字段名）
    const currentGreenCash = parsedPlayerData.cash || parsedPlayerData.Cash || parsedPlayerData.greenCash || parsedPlayerData.green_cash || 0;
    const currentGoldCoins = parsedPlayerData.coin || parsedPlayerData.Coin || parsedPlayerData.goldCoins || parsedPlayerData.gold_coins || parsedPlayerData.money || 0;
    
    console.log('🎯 当前货币值:', {
      绿钞: currentGreenCash,
      金币: currentGoldCoins
    });
    
    // 计算新值
    let newGreenCash = currentGreenCash;
    let newGoldCoins = currentGoldCoins;
    
    if (operationType === 'max') {
      // 设置为最大值
      newGreenCash = 999999999;
      newGoldCoins = 999999999;
      console.log('📈 设置为最大值: 999,999,999');
    } else if (operationType === 'set') {
      // 设置为指定值
      if (greenCash !== undefined) {
        const greenCashValue = Number(greenCash);
        if (isNaN(greenCashValue)) {
          return res.json({ ok: false, error: 400, message: "INVALID_GREEN_CASH_AMOUNT" });
        }
        newGreenCash = greenCashValue;
        console.log(`💚 绿钞设置为: ${newGreenCash}`);
      }
      
      if (goldCoins !== undefined) {
        const goldCoinsValue = Number(goldCoins);
        if (isNaN(goldCoinsValue)) {
          return res.json({ ok: false, error: 400, message: "INVALID_GOLD_COINS_AMOUNT" });
        }
        newGoldCoins = goldCoinsValue;
        console.log(`💛 金币设置为: ${newGoldCoins}`);
      }
    } else if (operationType === 'add') {
      // 增加值
      if (greenCash !== undefined) {
        const greenCashValue = Number(greenCash);
        if (isNaN(greenCashValue)) {
          return res.json({ ok: false, error: 400, message: "INVALID_GREEN_CASH_AMOUNT" });
        }
        newGreenCash = currentGreenCash + greenCashValue;
        console.log(`💚 绿钞增加: ${currentGreenCash} + ${greenCashValue} = ${newGreenCash}`);
      }
      
      if (goldCoins !== undefined) {
        const goldCoinsValue = Number(goldCoins);
        if (isNaN(goldCoinsValue)) {
          return res.json({ ok: false, error: 400, message: "INVALID_GOLD_COINS_AMOUNT" });
        }
        newGoldCoins = currentGoldCoins + goldCoinsValue;
        console.log(`💛 金币增加: ${currentGoldCoins} + ${goldCoinsValue} = ${newGoldCoins}`);
      }
    }
    
    // 限制最大值
    newGreenCash = Math.min(newGreenCash, 999999999);
    newGoldCoins = Math.min(newGoldCoins, 999999999);
    
    // 更新字段（修复：使用正确的字段名）
    console.log('🔄 更新货币字段...');
    
    // 绿钞字段（关键修复：使用正确的字段名）
    parsedPlayerData.cash = newGreenCash;  // 这是CPM中最常用的绿钞字段名
    parsedPlayerData.Cash = newGreenCash;
    parsedPlayerData.greenCash = newGreenCash;
    parsedPlayerData.green_cash = newGreenCash;
    
    // 金币字段
    parsedPlayerData.coin = newGoldCoins;  // 这是CPM中最常用的金币字段名
    parsedPlayerData.Coin = newGoldCoins;
    parsedPlayerData.goldCoins = newGoldCoins;
    parsedPlayerData.gold_coins = newGoldCoins;
    parsedPlayerData.money = newGoldCoins;
    
    console.log('✅ 字段更新完成:', {
      cash: parsedPlayerData.cash,
      coin: parsedPlayerData.coin,
      money: parsedPlayerData.money
    });
    
    // 清理字段
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    
    // 保存数据
    console.log('💾 保存数据...');
    const updateUrl = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
    const updateRes = await sendCPMRequest(updateUrl, { 
      data: JSON.stringify(parsedPlayerData)
    }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    console.log('📦 保存响应:', updateRes);
    
    if (updateRes?.result === '{"result":1}' || updateRes?.result === 1 || updateRes?.result === "1") {
      console.log('🎉 修改货币成功!');
      res.json({ 
        ok: true, 
        error: 0, 
        message: "SUCCESSFUL",
        details: {
          operationType: operationType,
          greenCash: {
            oldValue: currentGreenCash,
            newValue: newGreenCash
          },
          goldCoins: {
            oldValue: currentGoldCoins,
            newValue: newGoldCoins
          }
        }
      });
    } else {
      console.error('❌ 修改货币保存失败:', updateRes);
      res.json({ ok: false, error: 500, message: "SAVE_MONEY_FAILED", debug: updateRes });
    }
  } catch (error) {
    console.error('💥 修改货币错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// ==================== 新增功能 API ====================

// 7. 解锁W16引擎
app.post('/api/unlock-w16-engine', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('🏎️ 解锁W16引擎...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 解锁W16引擎相关字段
        // CPM中通常使用这些字段来解锁引擎
        parsedData.W16Engine = true;
        parsedData.w16_engine = true;
        parsedData.unlockedW16 = true;
        parsedData.engineW16 = true;
        parsedData.engine_w16 = true;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: "W16引擎已解锁!" });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('解锁W16引擎错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 8. 解锁付费房屋
app.post('/api/unlock-premium-houses', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('🏠 解锁付费房屋...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 解锁所有房屋（包括付费房屋）
        // CPM中通常使用这些字段
        parsedData.allHousesUnlocked = true;
        parsedData.housesUnlocked = true;
        parsedData.premiumHouses = true;
        parsedData.house1 = true;
        parsedData.house2 = true;
        parsedData.house3 = true;
        parsedData.house4 = true;
        parsedData.house5 = true;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: "所有付费房屋已解锁!" });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('解锁付费房屋错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 9. 解锁所有烟雾
app.post('/api/unlock-smokes', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('💨 解锁所有烟雾...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 解锁所有烟雾效果
        parsedData.allSmokesUnlocked = true;
        parsedData.smokesUnlocked = true;
        parsedData.smoke1 = true;
        parsedData.smoke2 = true;
        parsedData.smoke3 = true;
        parsedData.smoke4 = true;
        parsedData.smoke5 = true;
        parsedData.smoke6 = true;
        parsedData.smoke7 = true;
        parsedData.smoke8 = true;
        parsedData.smoke9 = true;
        parsedData.smoke10 = true;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: "所有烟雾效果已解锁!" });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('解锁烟雾错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 10. 修改名字无限制
app.post('/api/change-name-unlimited', async (req, res) => {
    try {
        const { authToken, newName } = req.body;
        
        if (!authToken || !newName) {
            return res.json({ ok: false, error: 400, message: "Missing auth token or new name" });
        }
        
        console.log('📝 修改名字:', newName);
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 修改名字（无限制）
        parsedData.Name = newName;
        parsedData.name = newName;
        parsedData.playerName = newName;
        parsedData.nickname = newName;
        
        // 设置名字修改次数为最大值，这样就不会有限制
        parsedData.nameChangeCount = 0;
        parsedData.nameChangesLeft = 999;
        parsedData.nameChanged = false;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: `名字已修改为: ${newName}` });
        } else {
            res.json({ ok: false, error: 500, message: "修改失败", debug: saveResult });
        }
    } catch (error) {
        console.error('修改名字错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 11. 解锁无限油
app.post('/api/unlock-unlimited-fuel', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('⛽ 解锁无限油...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 设置无限油
        parsedData.fuel = 999999;
        parsedData.Fuel = 999999;
        parsedData.unlimitedFuel = true;
        parsedData.fuelUnlimited = true;
        parsedData.infiniteFuel = true;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: "无限油已解锁!" });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('解锁无限油错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 12. 解锁无伤模式
app.post('/api/unlock-god-mode', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('🛡️ 解锁无伤模式...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 解锁无伤模式
        parsedData.godMode = true;
        parsedData.GodMode = true;
        parsedData.noDamage = true;
        parsedData.invincible = true;
        parsedData.unlimitedHealth = true;
        parsedData.health = 999999;
        parsedData.maxHealth = 999999;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ ok: true, error: 0, message: "无伤模式已解锁!" });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('解锁无伤模式错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 13. 修改胜场数
app.post('/api/modify-wins', async (req, res) => {
    try {
        const { authToken, wins, operationType = 'set' } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 400, message: "Missing auth token" });
        }
        
        console.log('🏆 修改胜场数:', { 操作类型: operationType, 胜场: wins });
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // 获取当前胜场数
        const currentWins = parsedData.wins || parsedData.Wins || parsedData.totalWins || 0;
        console.log('当前胜场数:', currentWins);
        
        let newWins;
        
        if (operationType === 'set') {
            const winsValue = Number(wins);
            if (isNaN(winsValue)) {
                return res.json({ ok: false, error: 400, message: "INVALID_WINS_AMOUNT" });
            }
            newWins = winsValue;
        } else if (operationType === 'add') {
            const winsValue = Number(wins);
            if (isNaN(winsValue)) {
                return res.json({ ok: false, error: 400, message: "INVALID_WINS_AMOUNT" });
            }
            newWins = currentWins + winsValue;
        } else if (operationType === 'max') {
            newWins = 999999;
        }
        
        // 限制最大值
        newWins = Math.min(newWins, 999999);
        
        // 更新胜场字段
        parsedData.wins = newWins;
        parsedData.Wins = newWins;
        parsedData.totalWins = newWins;
        
        // 同时更新相关统计字段
        parsedData.racesWon = newWins;
        parsedData.winCount = newWins;
        parsedData.victories = newWins;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ 
                ok: true, 
                error: 0, 
                message: "胜场数修改成功!",
                details: {
                    operationType: operationType,
                    wins: {
                        oldValue: currentWins,
                        newValue: newWins
                    }
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "修改失败", debug: saveResult });
        }
    } catch (error) {
        console.error('修改胜场数错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 14. 解锁所有功能（一键全解锁）
app.post('/api/unlock-all', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "Missing auth token" });
        }
        
        console.log('🎮 一键解锁所有功能...');
        
        // 获取账号数据
        const accountData = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!accountData?.result) {
            return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
        }
        
        let parsedData = JSON.parse(accountData.result);
        
        // ========== 解锁所有功能 ==========
        
        // 1. 货币相关
        parsedData.cash = 999999999;
        parsedData.Cash = 999999999;
        parsedData.coin = 999999999;
        parsedData.Coin = 999999999;
        parsedData.money = 999999999;
        
        // 2. W16引擎
        parsedData.W16Engine = true;
        parsedData.w16_engine = true;
        parsedData.unlockedW16 = true;
        
        // 3. 付费房屋
        parsedData.allHousesUnlocked = true;
        parsedData.premiumHouses = true;
        for (let i = 1; i <= 10; i++) {
            parsedData[`house${i}`] = true;
        }
        
        // 4. 烟雾效果
        parsedData.allSmokesUnlocked = true;
        for (let i = 1; i <= 10; i++) {
            parsedData[`smoke${i}`] = true;
        }
        
        // 5. 无限油
        parsedData.fuel = 999999;
        parsedData.unlimitedFuel = true;
        parsedData.infiniteFuel = true;
        
        // 6. 无伤模式
        parsedData.godMode = true;
        parsedData.noDamage = true;
        parsedData.invincible = true;
        parsedData.health = 999999;
        
        // 7. 胜场数
        parsedData.wins = 999999;
        parsedData.totalWins = 999999;
        
        // 8. 其他解锁
        parsedData.allCarsUnlocked = true;
        parsedData.allItemsUnlocked = true;
        parsedData.allWheelsUnlocked = true;
        parsedData.allNeonsUnlocked = true;
        parsedData.maxLevel = true;
        parsedData.level = 100;
        parsedData.exp = 999999999;
        
        // 清理字段
        delete parsedData._id;
        delete parsedData.id;
        delete parsedData.createdAt;
        delete parsedData.updatedAt;
        delete parsedData.__v;
        
        // 保存数据
        const saveResult = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(parsedData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1) {
            res.json({ 
                ok: true, 
                error: 0, 
                message: "所有功能已解锁!",
                unlocked: {
                    money: "999,999,999",
                    w16Engine: true,
                    houses: "全部",
                    smokes: "全部",
                    fuel: "无限",
                    godMode: true,
                    wins: "999,999",
                    cars: "全部",
                    items: "全部",
                    level: "100级"
                }
            });
        } else {
            res.json({ ok: false, error: 500, message: "解锁失败", debug: saveResult });
        }
    } catch (error) {
        console.error('一键解锁错误:', error);
        res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy Clone Service',
        timestamp: new Date().toISOString(),
        version: '3.0-full',
        endpoints: {
            total: 14,
            features: ['登录', '获取数据', '修改ID', '克隆账号', '修改货币', '解锁W16引擎', '解锁付费房屋', '解锁烟雾', '修改名字无限制', '解锁无限油', '解锁无伤模式', '修改胜场', '一键全解锁']
        }
    });
});

// 测试端点
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'cpmcy API is working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        firebase_key: FIREBASE_API_KEY ? 'Set' : 'Not set'
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
    🚀 cpmcy API Server 已启动
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    🔑 Firebase API Key: ${FIREBASE_API_KEY ? '已设置 ✓' : '未设置 ✗'}
    ⚡ 版本: 3.0-full (完整功能版)
    
    🎮 可用功能:
    ├── 1. 账号登录
    ├── 2. 获取账号数据
    ├── 3. 获取所有车辆
    ├── 4. 修改账号ID
    ├── 5. 克隆账号
    ├── 6. 修改绿钞和金币
    ├── 7. 解锁W16引擎
    ├── 8. 解锁付费房屋
    ├── 9. 解锁所有烟雾
    ├── 10. 修改名字无限制
    ├── 11. 解锁无限油
    ├── 12. 解锁无伤模式
    ├── 13. 修改胜场数
    └── 14. 一键全解锁
    
    启动时间: ${new Date().toLocaleString()}
    ====================================
    `);
});
