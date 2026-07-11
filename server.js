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

// 2. 获取账号数据 【修复】加上Host头，统一返回data
app.post('/api/get-account-data', async (req, res) => {
    const { authToken } = req.body;
    
    console.log('📥 获取账号数据');
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "Missing auth token", data: null });
    }
    
    const url = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const payload = { data: null };
    const headers = {
        "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
    };
    
    try {
        console.log('📡 请求GetPlayerRecords2...');
        const response = await sendCPMRequest(url, payload, headers);
        
        console.log('📦 响应:', response ? JSON.stringify(response).substring(0, 200) : 'null');
        
        if (response?.result) {
            let data;
            try { 
                data = JSON.parse(response.result);
                console.log('✅ 解析成功');
            } catch (e) { 
                data = response.result;
                console.log('⚠️ 非JSON');
            }
            
            res.json({ 
                ok: true, 
                error: 0, 
                message: "SUCCESSFUL", 
                data: data 
            });
        } else {
            console.log('❌ 无result');
            res.json({ 
                ok: false, 
                error: 404, 
                message: "NO_DATA", 
                data: null 
            });
        }
    } catch (error) {
        console.error('❌ 错误:', error.message);
        res.json({ 
            ok: false, 
            error: 500, 
            message: "Server error", 
            data: null 
        });
    }
});

// 3. 获取所有车辆
app.post('/api/get-all-cars', async (req, res) => {
    const { authToken } = req.body;
    if (!authToken) return res.json({ ok: false, error: 401, message: "Missing auth token", data: [] });
    
    const url = `${CPM_BASE_URL}/TestGetAllCars`;
    const payload = { data: null };
    const headers = {
        "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
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
        res.json({ ok: false, error: 500, message: "Server error", data: [] });
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
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
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
            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
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
            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        console.log('保存账号响应:', updateRes?.result);
        
        if (!updateRes?.result) {
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
                        
                        if (carSaveRes?.result) {
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
            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
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
            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
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
            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${targetAuth}`,
            "Content-Type": "application/json"
        });
        
        console.log('保存响应:', saveDataResponse?.result);
        
        if (!saveDataResponse?.result) {
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
                        
                        if (saveCarResponse?.result) {
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

// 6. 修改绿钞
app.post('/api/modify-green-cash', async (req, res) => {
  try {
    const { authToken, amount, operationType = 'set' } = req.body;
    
    console.log('💚 修改绿钞:', amount, operationType);
    
    if (!authToken || amount === undefined) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    const playerDataUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (!playerData?.result) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    
    const parsedPlayerData = JSON.parse(playerData.result);
    const currentGreenCash = parsedPlayerData.cash || parsedPlayerData.Cash || 0;
    const greenCashValue = Number(amount);
    
    let newGreenCash;
    if (operationType === 'add') {
      newGreenCash = Math.min(currentGreenCash + greenCashValue, 999999999);
    } else {
      newGreenCash = Math.min(greenCashValue, 999999999);
    }
    
    parsedPlayerData.cash = newGreenCash;
    parsedPlayerData.Cash = newGreenCash;
    
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    
    const updateRes = await sendCPMRequest(`${CPM_BASE_URL}/SavePlayerRecordsIOS`, { 
      data: JSON.stringify(parsedPlayerData)
    }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (updateRes?.result) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "SUCCESSFUL",
        details: { oldValue: currentGreenCash, newValue: newGreenCash }
      });
    } else {
      res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
    }
  } catch (error) {
    res.json({ ok: false, error: 500, message: error.message });
  }
});

// 7. 修改金币
app.post('/api/modify-gold-coins', async (req, res) => {
  try {
    const { authToken, amount, operationType = 'set' } = req.body;
    
    console.log('💛 修改金币:', amount, operationType);
    
    if (!authToken || amount === undefined) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    
    const playerDataUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (!playerData?.result) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    
    const parsedPlayerData = JSON.parse(playerData.result);
    const currentGoldCoins = parsedPlayerData.coin || parsedPlayerData.Coin || parsedPlayerData.money || 0;
    const goldCoinsValue = Number(amount);
    
    let newGoldCoins;
    if (operationType === 'add') {
      newGoldCoins = Math.min(currentGoldCoins + goldCoinsValue, 999999999);
    } else {
      newGoldCoins = Math.min(goldCoinsValue, 999999999);
    }
    
    parsedPlayerData.coin = newGoldCoins;
    parsedPlayerData.Coin = newGoldCoins;
    parsedPlayerData.money = newGoldCoins;
    
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    
    const updateRes = await sendCPMRequest(`${CPM_BASE_URL}/SavePlayerRecordsIOS`, { 
      data: JSON.stringify(parsedPlayerData)
    }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (updateRes?.result) {
      res.json({ 
        ok: true, 
        error: 0, 
        message: "SUCCESSFUL",
        details: { oldValue: currentGoldCoins, newValue: newGoldCoins }
      });
    } else {
      res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
    }
  } catch (error) {
    res.json({ ok: false, error: 500, message: error.message });
  }
});

// 8. 一键最大
app.post('/api/max-money', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    if (!authToken) {
      return res.json({ ok: false, error: 400, message: "MISSING_TOKEN" });
    }
    
    const playerDataUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (!playerData?.result) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    
    const parsedPlayerData = JSON.parse(playerData.result);
    parsedPlayerData.cash = 999999999;
    parsedPlayerData.Cash = 999999999;
    parsedPlayerData.coin = 999999999;
    parsedPlayerData.Coin = 999999999;
    parsedPlayerData.money = 999999999;
    
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    
    const updateRes = await sendCPMRequest(`${CPM_BASE_URL}/SavePlayerRecordsIOS`, { 
      data: JSON.stringify(parsedPlayerData)
    }, {
      "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    
    if (updateRes?.result) {
      res.json({ ok: true, error: 0, message: "SUCCESSFUL" });
    } else {
      res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
    }
  } catch (error) {
    res.json({ ok: false, error: 500, message: error.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy Clone Service',
        timestamp: new Date().toISOString(),
        version: '3.0-fixed'
    });
});

app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'cpmcy API is working',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

app.listen(PORT, () => {
    console.log(`
    🚀 cpmcy API Server 已启动
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    ⚡ 版本: 3.0-fixed
    ====================================
    `);
});
