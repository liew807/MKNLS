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

// 增强的请求函数（带详细日志）
async function sendCPMRequest(url, payload, headers, params = {}, maxRetries = 3) {
    let lastError;
    const requestId = Math.random().toString(36).substring(7);
    
    console.log(`🔄 [${requestId}] 开始请求: ${url}`);
    console.log(`📦 [${requestId}] Payload:`, payload ? JSON.stringify(payload).substring(0, 200) + '...' : 'null');
    console.log(`🔑 [${requestId}] Headers:`, headers);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const fullUrl = url + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
            
            console.log(`📡 [${requestId}] 尝试 ${attempt}/${maxRetries}: ${fullUrl}`);
            
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
            
            console.log(`✅ [${requestId}] 状态码: ${response.status}`);
            console.log(`📥 [${requestId}] 响应数据:`, JSON.stringify(response.data).substring(0, 300) + '...');
            
            // 处理429（太多请求）
            if (response.status === 429) {
                const waitTime = Math.min(2000 * attempt, 10000);
                console.log(`⏳ [${requestId}] 请求过多，等待 ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            // 处理5xx服务器错误
            if (response.status >= 500) {
                console.log(`⚠️ [${requestId}] 服务器错误 ${response.status}，重试...`);
                const waitTime = 1000 * attempt;
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response.data;
            
        } catch (error) {
            lastError = error;
            console.error(`❌ [${requestId}] 尝试 ${attempt}/${maxRetries} 失败:`, error.message);
            
            if (error.response) {
                console.error(`❌ [${requestId}] 响应错误:`, error.response.status, error.response.data);
            }
            
            if (attempt < maxRetries) {
                const waitTime = 1000 * attempt;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    console.error(`💥 [${requestId}] 所有 ${maxRetries} 次尝试都失败了`);
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
            console.log('✅ 登录成功:', email);
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
            console.log('❌ 登录失败:', error);
            res.json({
                ok: false,
                error: 401,
                message: error,
                auth: null
            });
        }
    } catch (error) {
        console.error('💥 登录服务器错误:', error);
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

// 7. 获取账号日志（详细调试版）
app.post('/api/get-account-log', async (req, res) => {
  console.log('📜 ========== 开始获取账号日志 ==========');
  console.log('请求时间:', new Date().toISOString());
  console.log('请求体:', JSON.stringify(req.body, null, 2));
  
  const debugInfo = {
    timestamp: new Date().toISOString(),
    steps: [],
    errors: [],
    responses: {},
    suggestions: []
  };
  
  try {
    const { authToken, email, password } = req.body;
    
    // 验证参数
    if (!authToken && (!email || !password)) {
      debugInfo.errors.push("缺少认证参数");
      return res.json({ 
        ok: false, 
        error: 400, 
        message: "需要提供 authToken 或 email/password",
        debug: debugInfo
      });
    }
    
    let finalAuthToken = authToken;
    
    // 如果需要使用账号密码登录
    if (!finalAuthToken && email && password) {
      debugInfo.steps.push("开始登录流程");
      console.log('🔐 使用账号密码登录获取Token...');
      
      try {
        const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
        const loginPayload = {
          email: email,
          password: password,
          returnSecureToken: true,
          clientType: "CLIENT_TYPE_ANDROID"
        };
        
        debugInfo.steps.push(`发送登录请求到: ${loginUrl}`);
        
        const loginResponse = await sendCPMRequest(loginUrl, loginPayload, {
          "Content-Type": "application/json",
          "Accept": "application/json"
        }, { key: FIREBASE_API_KEY });
        
        debugInfo.responses.login = loginResponse;
        
        if (loginResponse?.idToken) {
          finalAuthToken = loginResponse.idToken;
          debugInfo.steps.push(`✅ 登录成功，Token长度: ${finalAuthToken.length}`);
          console.log('✅ 登录成功，Token前30位:', finalAuthToken.substring(0, 30) + '...');
        } else {
          debugInfo.errors.push(`登录失败: ${JSON.stringify(loginResponse)}`);
          return res.json({
            ok: false,
            error: 401,
            message: "登录失败",
            debug: debugInfo
          });
        }
      } catch (loginError) {
        debugInfo.errors.push(`登录错误: ${loginError.message}`);
        return res.json({
          ok: false,
          error: 500,
          message: "登录过程出错",
          debug: debugInfo
        });
      }
    } else if (finalAuthToken) {
      debugInfo.steps.push("使用提供的Token");
      console.log('🔑 使用提供的Token');
    }
    
    // 验证Token有效性
    debugInfo.steps.push("验证Token有效性");
    console.log('🔍 验证Token是否有效...');
    
    try {
      const testUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
      const testResponse = await sendCPMRequest(testUrl, { data: null }, {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${finalAuthToken}`,
        "Content-Type": "application/json"
      });
      
      debugInfo.responses.tokenTest = testResponse;
      
      if (testResponse?.result) {
        debugInfo.steps.push("✅ Token有效，可以访问玩家数据");
        console.log('✅ Token验证通过');
        
        // 解析玩家数据作为日志的一部分
        try {
          const playerData = JSON.parse(testResponse.result);
          debugInfo.responses.playerData = {
            localID: playerData.localID || playerData.localId,
            Name: playerData.Name,
            cash: playerData.cash,
            coin: playerData.coin,
            level: playerData.level
          };
        } catch (e) {
          // 忽略解析错误
        }
      } else {
        debugInfo.errors.push(`Token无效: ${JSON.stringify(testResponse)}`);
        debugInfo.suggestions.push("请检查Token是否过期");
        debugInfo.suggestions.push("尝试重新登录获取新Token");
        return res.json({
          ok: false,
          error: 403,
          message: "Token无效或没有访问权限",
          debug: debugInfo
        });
      }
    } catch (testError) {
      debugInfo.errors.push(`Token测试失败: ${testError.message}`);
      return res.json({
        ok: false,
        error: 500,
        message: "Token验证失败",
        debug: debugInfo
      });
    }
    
    // 尝试获取账号日志
    debugInfo.steps.push("开始尝试获取账号日志");
    const allLogs = [];
    
    // 方法1: 直接调用CPM的GetAccountLog接口
    debugInfo.steps.push("方法1: 尝试CPM GetAccountLog接口");
    console.log('🔄 方法1: 尝试CPM GetAccountLog接口...');
    
    try {
      const cpmUrl = `${CPM_BASE_URL}/GetAccountLog`;
      console.log(`📡 发送请求到: ${cpmUrl}`);
      
      // 尝试不同的payload
      const payloads = [
        { data: null },
        { data: JSON.stringify({}) },
        { data: JSON.stringify({ limit: 50 }) },
        { data: JSON.stringify({ timestamp: Date.now() }) },
        { data: JSON.stringify({ action: "get_logs" }) },
        { data: JSON.stringify({ userId: "default" }) }
      ];
      
      let cpmSuccess = false;
      
      for (let i = 0; i < payloads.length; i++) {
        const payload = payloads[i];
        console.log(`📦 尝试payload ${i + 1}/${payloads.length}`);
        
        try {
          const headers = {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${finalAuthToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          };
          
          const response = await sendCPMRequest(cpmUrl, payload, headers);
          
          if (response) {
            debugInfo.responses[`cpm_attempt_${i}`] = response;
            console.log(`📡 Payload ${i + 1} 收到响应`);
            
            // 检查响应
            if (response.result !== undefined || response.data !== undefined || response.logs !== undefined) {
              debugInfo.steps.push(`✅ CPM接口有响应 (payload ${i + 1})`);
              cpmSuccess = true;
              
              // 提取日志数据
              let logData;
              if (response.result) {
                try {
                  logData = typeof response.result === 'string' ? JSON.parse(response.result) : response.result;
                } catch (e) {
                  logData = response.result;
                }
              } else if (response.data) {
                logData = response.data;
              } else if (response.logs) {
                logData = response.logs;
              } else {
                logData = response;
              }
              
              const logs = Array.isArray(logData) ? logData : [logData];
              
              logs.forEach((log, index) => {
                allLogs.push({
                  source: "cpm_getaccountlog",
                  attempt: i + 1,
                  timestamp: new Date().toISOString(),
                  data: log
                });
              });
              
              console.log(`✅ 从CPM接口获取到 ${logs.length} 条日志`);
              break; // 成功获取数据，跳出循环
            }
          }
        } catch (payloadError) {
          console.log(`⚠️ Payload ${i + 1} 失败: ${payloadError.message}`);
          continue;
        }
      }
      
      if (!cpmSuccess) {
        debugInfo.steps.push("❌ CPM GetAccountLog接口所有尝试都失败");
        debugInfo.suggestions.push("GetAccountLog接口可能不存在或需要特定权限");
        console.log('❌ CPM GetAccountLog接口失败');
      }
      
    } catch (error) {
      debugInfo.errors.push(`CPM接口错误: ${error.message}`);
      console.log('❌ CPM GetAccountLog接口失败:', error.message);
    }
    
    // 方法2: 获取其他可能包含日志的数据
    debugInfo.steps.push("方法2: 获取其他数据作为日志");
    console.log('🔄 方法2: 获取其他数据作为日志...');
    
    try {
      // 获取玩家数据
      const playerUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
      const playerResponse = await sendCPMRequest(playerUrl, { data: null }, {
        "User-Agent": "okhttp/3.12.13",
        "Authorization": `Bearer ${finalAuthToken}`,
        "Content-Type": "application/json"
      });
      
      if (playerResponse?.result) {
        debugInfo.steps.push("✅ 获取玩家数据成功");
        
        let playerData;
        try {
          playerData = typeof playerResponse.result === 'string' ? 
            JSON.parse(playerResponse.result) : playerResponse.result;
        } catch (e) {
          playerData = playerResponse.result;
        }
        
        // 创建玩家数据日志
        const playerLog = {
          source: "player_records",
          type: "account_data",
          timestamp: new Date().toISOString(),
          data: {
            localID: playerData.localID || playerData.localId || "unknown",
            Name: playerData.Name || "Unknown Player",
            level: playerData.level || 1,
            exp: playerData.exp || playerData.experience || 0,
            cash: playerData.cash || playerData.Cash || 0,
            coin: playerData.coin || playerData.Coin || 0,
            money: playerData.money || 0,
            wins: playerData.wins || 0,
            losses: playerData.losses || 0,
            totalRaces: playerData.totalRaces || 0,
            lastLogin: playerData.lastLogin || new Date().toISOString()
          }
        };
        
        allLogs.push(playerLog);
        debugInfo.responses.playerLog = playerLog;
      }
    } catch (error) {
      debugInfo.errors.push(`获取玩家数据失败: ${error.message}`);
    }
    
    // 方法3: 生成模拟日志（如果其他方法都失败）
    if (allLogs.length === 0) {
      debugInfo.steps.push("方法3: 生成模拟日志");
      debugInfo.suggestions.push("实际日志接口可能不存在，使用模拟数据");
      console.log('🔄 方法3: 生成模拟日志...');
      
      // 创建模拟日志数据
      const simulatedLogs = [
        {
          source: "simulated",
          type: "login_history",
          timestamp: new Date().toISOString(),
          data: {
            event: "account_login",
            status: "success",
            time: new Date().toISOString(),
            ip: "192.168.1.100",
            device: "Android 12"
          }
        },
        {
          source: "simulated",
          type: "game_activity",
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          data: {
            event: "race_completed",
            track: "Tokyo Highway",
            result: "win",
            earnings: 50000
          }
        },
        {
          source: "simulated",
          type: "system_info",
          timestamp: new Date().toISOString(),
          data: {
            message: "GetAccountLog接口未启用",
            suggestion: "请联系管理员启用日志功能",
            api_status: "not_available"
          }
        }
      ];
      
      allLogs.push(...simulatedLogs);
      debugInfo.steps.push("✅ 生成模拟日志完成");
    }
    
    // 总结
    debugInfo.steps.push(`总共收集到 ${allLogs.length} 条日志`);
    debugInfo.summary = {
      totalLogs: allLogs.length,
      sources: [...new Set(allLogs.map(log => log.source))],
      timestamp: new Date().toISOString()
    };
    
    console.log(`📊 总共收集到 ${allLogs.length} 条日志记录`);
    console.log('✅ ========== 获取账号日志完成 ==========');
    
    // 返回结果
    res.json({ 
      ok: true, 
      error: 0, 
      message: "SUCCESSFUL",
      data: allLogs,
      debug: debugInfo,
      metadata: {
        total_logs: allLogs.length,
        timestamp: new Date().toISOString(),
        note: allLogs.some(log => log.source === "simulated") ? 
              "部分日志为模拟数据（实际接口可能不存在）" : 
              "所有日志均来自实际接口"
      }
    });
    
  } catch (error) {
    console.error('💥 获取账号日志过程中发生错误:', error);
    debugInfo.errors.push(`处理错误: ${error.message}`);
    
    res.json({ 
      ok: false, 
      error: 500, 
      message: `服务器错误: ${error.message}`,
      debug: debugInfo,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 8. 测试所有CPM接口
app.post('/api/test-all-endpoints', async (req, res) => {
  console.log('🧪 测试所有CPM接口');
  
  try {
    const { authToken } = req.body;
    
    if (!authToken) {
      return res.json({ ok: false, error: 400, message: "缺少authToken" });
    }
    
    const endpoints = [
      "GetAccountLog",
      "GetPlayerRecords2",
      "TestGetAllCars",
      "SavePlayerRecordsIOS",
      "SaveCars",
      "GetPlayerLogs",
      "GetUserLogs",
      "GetLoginHistory",
      "GetActivityLog",
      "GetPlayerStats"
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      console.log(`🔍 测试接口: ${endpoint}`);
      
      try {
        const url = `${CPM_BASE_URL}/${endpoint}`;
        const response = await sendCPMRequest(url, { data: null }, {
          "User-Agent": "okhttp/3.12.13",
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json"
        });
        
        results.push({
          endpoint: endpoint,
          status: response ? "success" : "failed",
          response: response
        });
        
        console.log(`✅ ${endpoint}: ${response ? '有响应' : '无响应'}`);
      } catch (error) {
        results.push({
          endpoint: endpoint,
          status: "error",
          error: error.message
        });
        
        console.log(`❌ ${endpoint}: ${error.message}`);
      }
      
      // 稍微等待一下，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 分析结果
    const successEndpoints = results.filter(r => r.status === "success");
    const failedEndpoints = results.filter(r => r.status === "failed");
    const errorEndpoints = results.filter(r => r.status === "error");
    
    res.json({
      ok: true,
      error: 0,
      message: "接口测试完成",
      results: results,
      summary: {
        total: endpoints.length,
        success: successEndpoints.length,
        failed: failedEndpoints.length,
        error: errorEndpoints.length,
        available_endpoints: successEndpoints.map(r => r.endpoint)
      }
    });
    
  } catch (error) {
    console.error('💥 测试接口错误:', error);
    res.json({ ok: false, error: 500, message: `测试失败: ${error.message}` });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy Clone Service',
        timestamp: new Date().toISOString(),
        version: '2.6-debug',
        endpoints: [
            '/api/login',
            '/api/get-account-data',
            '/api/get-all-cars',
            '/api/change-localid',
            '/api/clone-account',
            '/api/modify-money',
            '/api/get-account-log',
            '/api/test-all-endpoints',
            '/api/health',
            '/api/test'
        ]
    });
});

// 测试端点
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'cpmcy API is working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        firebase_key: FIREBASE_API_KEY ? 'Set' : 'Not set',
        cpm_base_url: CPM_BASE_URL
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

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('💥 未捕获的错误:', err);
    res.status(500).json({
        ok: false,
        error: 500,
        message: 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`
    🚀 cpmcy API Server 已启动
    📍 端口: ${PORT}
    🌐 地址: http://localhost:${PORT}
    🔑 Firebase API Key: ${FIREBASE_API_KEY ? '已设置 ✓' : '未设置 ✗'}
    ⚡ 版本: 2.6-debug (调试版)
    
    主要修复和改进:
    ====================================
    1. 📜 获取账号日志 - 详细调试信息
    2. 🧪 新增测试所有接口端点
    3. 🔍 增强请求日志，包含请求ID
    4. 💡 智能回退到模拟数据
    5. 📊 完整的错误追踪
    ====================================
    
    启动时间: ${new Date().toLocaleString()}
    ====================================
    `);
});
