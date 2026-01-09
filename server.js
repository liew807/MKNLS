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

// ==================== 通用数据处理函数 ====================

async function processAccountData(authToken, operationCallback) {
    try {
        if (!authToken) {
            return { success: false, error: "Missing auth token" };
        }
        
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
            return { success: false, error: "GET_ACCOUNT_DATA_FAILED" };
        }
        
        let parsedData;
        try {
            parsedData = JSON.parse(accountData.result);
        } catch (e) {
            return { success: false, error: "Failed to parse account data" };
        }
        
        // 执行操作回调函数
        const operationResult = await operationCallback(parsedData);
        
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
        
        console.log('保存响应:', saveResult);
        
        if (saveResult?.result === '{"result":1}' || saveResult?.result === 1 || saveResult?.result === "1") {
            return { 
                success: true, 
                data: parsedData,
                saveResult: saveResult,
                operationResult: operationResult
            };
        } else {
            return { 
                success: false, 
                error: "SAVE_FAILED", 
                debug: saveResult,
                data: parsedData
            };
        }
    } catch (error) {
        console.error('处理账号数据错误:', error);
        return { success: false, error: error.message };
    }
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
        
        console.log('获取车辆数据...');
        const url2 = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(url2, { data: null }, headers1);
        let carsData = [];
        if (carsResponse?.result) {
            try { carsData = JSON.parse(carsResponse.result); } catch (e) { carsData = carsResponse.result; }
        }
        
        const carCount = Array.isArray(carsData) ? carsData.length : 0;
        console.log(`账号有 ${carCount} 辆车`);
        
        console.log('更新账号ID...');
        accountData.localID = newLocalId;
        if (accountData.localId) accountData.localId = newLocalId;
        
        delete accountData._id;
        delete accountData.id;
        delete accountData.createdAt;
        delete accountData.updatedAt;
        delete accountData.__v;
        
        const url3 = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const updateRes = await sendCPMRequest(url3, { 
            data: JSON.stringify(accountData)
        }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        console.log('保存账号响应:', updateRes?.result);
        
        if (updateRes?.result !== '{"result":1}') {
            console.error('保存账号数据失败:', updateRes);
            return res.json({ ok: false, result: 0, message: "Failed to save account data" });
        }
        
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
                        
                        if (oldLocalId && cleanOldLocalId) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            try { carCopy = JSON.parse(newCarStr); } catch (e) {}
                        }
                        
                        delete carCopy._id;
                        delete carCopy.createdAt;
                        delete carCopy.updatedAt;
                        delete carCopy.__v;
                        
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (carCopy.CarID.includes(oldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            }
                            if (carCopy.CarID.includes(cleanOldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            }
                        }
                        
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
        
        const targetAccountData = {
            ...sourceData,
            localID: to_id,
            localId: to_id
        };
        
        delete targetAccountData._id;
        delete targetAccountData.id;
        delete targetAccountData.createdAt;
        delete targetAccountData.updatedAt;
        delete targetAccountData.__v;
        
        if (!targetAccountData.Name) targetAccountData.Name = "TELMunn";
        if (!targetAccountData.money) targetAccountData.money = 500000000;
        
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
        
        if (saveDataResponse?.result !== '{"result":1}') {
            return res.json({
                ok: false,
                error: 500,
                message: `Failed to save target account data.`
            });
        }
        
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
                        
                        if (from_id && clean_from_id) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                            try { carCopy = JSON.parse(newCarStr); } catch (e) {}
                        }
                        
                        delete carCopy._id;
                        delete carCopy.createdAt;
                        delete carCopy.updatedAt;
                        delete carCopy.__v;
                        
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (from_id && carCopy.CarID.includes(from_id)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(from_id), 'g'), to_id);
                            }
                            if (clean_from_id && carCopy.CarID.includes(clean_from_id)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), to_id);
                            }
                        }
                        
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

// ==================== 统一格式的功能API ====================

// 6. 修改绿钞和金币（基础模板）
app.post('/api/modify-money', async (req, res) => {
  try {
    const { authToken, greenCash, goldCoins, operationType = 'set' } = req.body;
    
    console.log('💰 修改货币请求:', {
      操作类型: operationType,
      绿钞值: greenCash,
      金币值: goldCoins
    });
    
    // 验证参数
    if (!authToken) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    if (operationType !== 'max' && greenCash === undefined && goldCoins === undefined) {
      return res.json({ ok: false, error: 400, message: "Please provide greenCash or goldCoins" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      // 获取当前值
      const currentGreenCash = parsedData.cash || parsedData.Cash || parsedData.greenCash || 0;
      const currentGoldCoins = parsedData.coin || parsedData.Coin || parsedData.goldCoins || parsedData.money || 0;
      
      console.log('当前货币值:', {
        绿钞: currentGreenCash,
        金币: currentGoldCoins
      });
      
      let newGreenCash = currentGreenCash;
      let newGoldCoins = currentGoldCoins;
      
      // 计算新值
      if (operationType === 'max') {
        newGreenCash = 999999999;
        newGoldCoins = 999999999;
      } else if (operationType === 'set') {
        if (greenCash !== undefined) newGreenCash = Number(greenCash);
        if (goldCoins !== undefined) newGoldCoins = Number(goldCoins);
      } else if (operationType === 'add') {
        if (greenCash !== undefined) newGreenCash = currentGreenCash + Number(greenCash);
        if (goldCoins !== undefined) newGoldCoins = currentGoldCoins + Number(goldCoins);
      }
      
      // 限制最大值
      newGreenCash = Math.min(newGreenCash, 999999999);
      newGoldCoins = Math.min(newGoldCoins, 999999999);
      
      // 更新字段
      parsedData.cash = newGreenCash;
      parsedData.Cash = newGreenCash;
      parsedData.coin = newGoldCoins;
      parsedData.Coin = newGoldCoins;
      parsedData.money = newGoldCoins;
      
      return {
        oldGreenCash: currentGreenCash,
        oldGoldCoins: currentGoldCoins,
        newGreenCash: newGreenCash,
        newGoldCoins: newGoldCoins
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "SUCCESSFUL",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 修改货币错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 7. 解锁W16 8.0引擎
app.post('/api/unlock-w16-engine', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('🏎️ 解锁W16 8.0引擎...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁W16 8.0引擎...');
      
      // 尝试所有可能的W16字段
      const w16Fields = [
        'W1680', 'W16_80', 'W16Engine', 'w16engine', 'engineW16',
        'W16_8_0', 'W16_8_0_Engine', 'w16_8_0', 'w16_8_0_engine',
        'W1680Engine', 'w1680engine', 'engineW1680',
        'unlockedW16', 'unlockedW1680', 'W16Unlocked', 'W1680Unlocked',
        'W16', 'w16'
      ];
      
      w16Fields.forEach(field => {
        parsedData[field] = 1;
      });
      
      // 设置字符串值
      parsedData['engine'] = 'W16 8.0';
      parsedData['Engine'] = 'W16 8.0';
      parsedData['currentEngine'] = 'W16 8.0';
      parsedData['EngineType'] = 'W16 8.0';
      
      // 设置引擎等级
      parsedData['engineLevel'] = 5;
      parsedData['engineUpgrade'] = 5;
      parsedData['enginePower'] = 1200;
      parsedData['maxEngine'] = 1;
      parsedData['allEngines'] = 1;
      
      return {
        fieldsSet: w16Fields.length,
        engineSetTo: 'W16 8.0',
        engineLevel: 5
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "W16 8.0引擎解锁完成！",
        details: result.operationResult,
        note: "请重启游戏查看效果"
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 解锁W16引擎错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 8. 解锁住家3
app.post('/api/unlock-premium-houses', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('🏠 解锁住家3...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁住家3...');
      
      // 解锁住家3相关字段
      parsedData["住家3"] = 1;
      parsedData.house3 = 1;
      parsedData.zhujia3 = 1;
      parsedData.premiumHouse = 1;
      parsedData.allHouses = 1;
      
      // 设置当前房屋
      parsedData.currentHouse = "住家3";
      parsedData.house = "住家3";
      parsedData.houseType = "住家3";
      parsedData.House = "住家3";
      
      // 解锁所有房屋
      parsedData.house1 = 1;
      parsedData.house2 = 1;
      parsedData["住家1"] = 1;
      parsedData["住家2"] = 1;
      
      return {
        currentHouse: "住家3",
        housesUnlocked: ["住家1", "住家2", "住家3"]
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "住家3解锁完成！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 解锁住家3错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 9. 解锁所有烟雾
app.post('/api/unlock-smokes', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('💨 解锁所有烟雾...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁所有烟雾...');
      
      // 解锁所有烟雾
      parsedData.allSmokes = 1;
      parsedData.smokesUnlocked = 1;
      parsedData.allSmokesUnlocked = 1;
      
      // 设置当前烟雾
      parsedData.currentSmoke = "彩虹";
      parsedData.smoke = "彩虹";
      parsedData.smokeType = "彩虹";
      parsedData.Smoke = "彩虹";
      
      // 解锁具体烟雾
      parsedData.smokeRed = 1;
      parsedData.smokeBlue = 1;
      parsedData.smokeGreen = 1;
      parsedData.smokeYellow = 1;
      parsedData.smokeRainbow = 1;
      
      return {
        currentSmoke: "彩虹",
        allSmokesUnlocked: true
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "所有烟雾解锁完成！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 解锁烟雾错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 10. 修改名字无限制
app.post('/api/change-name-unlimited', async (req, res) => {
  try {
    const { authToken, newName } = req.body;
    
    console.log('📝 修改名字:', newName);
    
    if (!authToken || !newName) {
      return res.json({ ok: false, error: 400, message: "Missing auth token or new name" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在修改名字...');
      
      // 修改名字
      parsedData.Name = newName;
      parsedData.name = newName;
      parsedData.playerName = newName;
      parsedData.nickname = newName;
      parsedData.username = newName;
      
      // 设置无限制
      parsedData.nameChangeCount = 0;
      parsedData.nameChangesLeft = 99;
      parsedData.nameChanged = 0;
      parsedData.canChangeName = 1;
      
      return {
        oldName: parsedData.Name || parsedData.name,
        newName: newName,
        nameChangesLeft: 99
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: `名字已修改为: ${newName}`,
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 修改名字错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 11. 解锁无限油
app.post('/api/unlock-unlimited-fuel', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('⛽ 解锁无限油...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁无限油...');
      
      // 设置无限油
      parsedData.fuel = 999999;
      parsedData.Fuel = 999999;
      parsedData.maxFuel = 999999;
      parsedData.fuelCapacity = 999999;
      
      // 无限油标志
      parsedData.unlimitedFuel = 1;
      parsedData.fuelUnlimited = 1;
      parsedData.infiniteFuel = 1;
      
      // 氮气相关
      parsedData.nitro = 999999;
      parsedData.maxNitro = 999999;
      parsedData.nitroUnlimited = 1;
      
      return {
        fuel: 999999,
        unlimited: true
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "无限油解锁完成！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 解锁无限油错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 12. 解锁无伤模式
app.post('/api/unlock-god-mode', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('🛡️ 解锁无伤模式...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁无伤模式...');
      
      // 无伤模式字段
      parsedData.godMode = 1;
      parsedData.GodMode = 1;
      parsedData.noDamage = 1;
      parsedData.invincible = 1;
      
      // 生命值和装甲
      parsedData.health = 999999;
      parsedData.maxHealth = 999999;
      parsedData.armor = 999999;
      parsedData.maxArmor = 999999;
      
      // 车辆损坏相关
      parsedData.noCarDamage = 1;
      parsedData.carInvincible = 1;
      parsedData.damageReduction = 100;
      
      return {
        godMode: true,
        health: 999999,
        damageReduction: "100%"
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "无伤模式解锁完成！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 解锁无伤模式错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 13. 修改胜场数
app.post('/api/modify-wins', async (req, res) => {
  try {
    const { authToken, wins, operationType = 'set' } = req.body;
    
    console.log('🏆 修改胜场数:', { 操作类型: operationType, 胜场: wins });
    
    if (!authToken) {
      return res.json({ ok: false, error: 400, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      // 获取当前胜场数
      const currentWins = parsedData.wins || parsedData.Wins || parsedData.totalWins || 0;
      console.log('当前胜场数:', currentWins);
      
      let newWins;
      const winsValue = wins ? parseInt(wins) : 0;
      
      if (operationType === 'set') {
        newWins = winsValue;
      } else if (operationType === 'add') {
        newWins = currentWins + winsValue;
      } else if (operationType === 'max') {
        newWins = 9999;
      }
      
      // 限制最大值
      newWins = Math.min(newWins, 9999);
      
      // 更新胜场字段
      parsedData.wins = newWins;
      parsedData.Wins = newWins;
      parsedData.totalWins = newWins;
      parsedData.racesWon = newWins;
      parsedData.winCount = newWins;
      
      // 更新比赛总数
      const totalRaces = Math.max(newWins, parsedData.races || parsedData.totalRaces || newWins);
      parsedData.races = totalRaces;
      parsedData.totalRaces = totalRaces;
      
      // 计算胜率
      let winRate = 0;
      if (totalRaces > 0) {
        winRate = Math.round((newWins / totalRaces) * 100);
      } else {
        winRate = 100;
      }
      parsedData.winRate = winRate;
      
      return {
        oldValue: currentWins,
        newValue: newWins,
        totalRaces: totalRaces,
        winRate: winRate + "%"
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "胜场数修改成功！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 修改胜场数错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 14. 一键全解锁
app.post('/api/unlock-all', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('🎮 一键解锁所有功能...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      console.log('正在解锁所有功能...');
      
      // 1. 货币相关
      parsedData.cash = 999999999;
      parsedData.coin = 999999999;
      parsedData.money = 999999999;
      
      // 2. W16 8.0引擎
      parsedData.engine = "W16 8.0";
      parsedData.W1680 = 1;
      parsedData.w16engine = 1;
      
      // 3. 住家3
      parsedData["住家3"] = 1;
      parsedData.currentHouse = "住家3";
      
      // 4. 烟雾效果
      parsedData.allSmokes = 1;
      parsedData.currentSmoke = "彩虹";
      
      // 5. 无限油
      parsedData.fuel = 999999;
      parsedData.fuelUnlimited = 1;
      
      // 6. 无伤模式
      parsedData.godMode = 1;
      parsedData.health = 999999;
      
      // 7. 胜场数
      parsedData.wins = 9999;
      
      // 8. 名字无限制
      parsedData.nameChangesLeft = 99;
      
      // 9. 等级和经验
      parsedData.level = 100;
      parsedData.exp = 999999999;
      
      // 10. 其他解锁
      parsedData.allCars = 1;
      parsedData.allItems = 1;
      parsedData.maxLevel = 1;
      
      return {
        unlocked: {
          money: "999,999,999",
          w16Engine: "W16 8.0",
          house: "住家3",
          smoke: "彩虹",
          fuel: "无限",
          godMode: true,
          wins: 9999,
          level: 100
        }
      };
    });
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "所有功能已解锁！",
        details: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 一键解锁错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 15. 诊断工具：查看账号数据结构
app.post('/api/debug-account', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    console.log('🔍 诊断账号数据...');
    
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "Missing auth token" });
    }
    
    const result = await processAccountData(authToken, (parsedData) => {
      // 提取关键信息
      const debugInfo = {
        基本信息: {
          名字: parsedData.Name || parsedData.name,
          等级: parsedData.level || parsedData.Level,
          经验: parsedData.exp || parsedData.Exp,
          ID: parsedData.localID || parsedData.localId
        },
        货币信息: {
          绿钞: parsedData.cash || parsedData.Cash,
          金币: parsedData.coin || parsedData.Coin,
          金钱: parsedData.money || parsedData.Money
        },
        解锁状态: {}
      };
      
      // 收集所有可能的关键字段
      Object.keys(parsedData).forEach(key => {
        // 引擎相关
        if (key.toLowerCase().includes('engine') || key.toLowerCase().includes('w16')) {
          debugInfo.解锁状态[key] = parsedData[key];
        }
        // 房屋相关
        if (key.toLowerCase().includes('house') || key.includes('住家') || key.includes('zhujia')) {
          debugInfo.解锁状态[key] = parsedData[key];
        }
        // 烟雾相关
        if (key.toLowerCase().includes('smoke')) {
          debugInfo.解锁状态[key] = parsedData[key];
        }
      });
      
      return debugInfo;
    }, false); // 不保存数据
    
    if (result.success) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "诊断完成",
        data: result.operationResult
      });
    } else {
      res.json({ 
        ok: false, 
        error: 500, 
        message: result.error,
        debug: result.debug
      });
    }
  } catch (error) {
    console.error('💥 诊断错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy Clone Service',
        timestamp: new Date().toISOString(),
        version: '3.0-统一格式版',
        endpoints: {
            total: 15,
            features: ['登录', '获取数据', '修改ID', '克隆账号', '修改货币', '解锁W16 8.0引擎', '解锁住家3', '解锁烟雾', '修改名字无限制', '解锁无限油', '解锁无伤模式', '修改胜场', '一键全解锁', '账号诊断']
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
    ⚡ 版本: 3.0-统一格式版
    
    🎮 可用功能（15个API端点）:
    ├── 1. 账号登录
    ├── 2. 获取账号数据
    ├── 3. 获取所有车辆
    ├── 4. 修改账号ID
    ├── 5. 克隆账号
    ├── 6. 修改绿钞和金币（基础模板）
    ├── 7. 解锁W16 8.0引擎
    ├── 8. 解锁住家3
    ├── 9. 解锁所有烟雾
    ├── 10. 修改名字无限制
    ├── 11. 解锁无限油
    ├── 12. 解锁无伤模式
    ├── 13. 修改胜场数
    ├── 14. 一键全解锁
    └── 15. 账号诊断工具
    
    启动时间: ${new Date().toLocaleString()}
    ====================================
    `);
});
