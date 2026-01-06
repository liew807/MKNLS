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

// 请求函数（增强版）
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

// ==================== 修复的修改ID API ====================
app.post('/api/change-localid', async (req, res) => {
    console.log('📝 收到修改ID请求');
    
    const { sourceEmail, sourcePassword, newLocalId, authToken: providedToken } = req.body;
    
    // 验证参数
    if (!newLocalId) {
        return res.json({ ok: false, result: 0, message: "Missing new local ID" });
    }
    
    // 验证ID格式
    if (newLocalId.length < 3 || newLocalId.length > 30) {
        return res.json({ 
            ok: false, 
            result: 0, 
            message: "Local ID length must be between 3 and 30 characters" 
        });
    }
    
    let authToken = providedToken;
    
    try {
        // 步骤1: 获取认证令牌
        if (!authToken) {
            if (!sourceEmail || !sourcePassword) {
                return res.json({ 
                    ok: false, 
                    result: 0, 
                    message: "Missing authentication credentials" 
                });
            }
            
            console.log('🔑 登录获取令牌...');
            const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
            const loginResponse = await sendCPMRequest(loginUrl, {
                email: sourceEmail,
                password: sourcePassword,
                returnSecureToken: true,
                clientType: "CLIENT_TYPE_ANDROID"
            }, {
                "Content-Type": "application/json"
            }, { key: FIREBASE_API_KEY });
            
            if (!loginResponse?.idToken) {
                return res.json({ 
                    ok: false, 
                    result: 0, 
                    message: "Login failed. Check credentials." 
                });
            }
            
            authToken = loginResponse.idToken;
            console.log('✅ 登录成功');
        }
        
        // 步骤2: 获取当前账号数据
        console.log('📋 获取账号数据...');
        const getAccountUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const accountResponse = await sendCPMRequest(getAccountUrl, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        if (!accountResponse?.result) {
            console.error('❌ 获取账号数据失败:', accountResponse);
            return res.json({ 
                ok: false, 
                result: 0, 
                message: "Failed to get account data" 
            });
        }
        
        let accountData;
        try { 
            accountData = JSON.parse(accountResponse.result); 
        } catch (e) { 
            accountData = accountResponse.result; 
        }
        
        const oldLocalId = accountData.localID || accountData.localId;
        const cleanOldLocalId = removeColorCodes(oldLocalId);
        
        console.log(`🔄 旧ID: ${cleanOldLocalId} → 新ID: ${newLocalId}`);
        
        if (newLocalId === cleanOldLocalId) {
            return res.json({ 
                ok: false, 
                result: 0, 
                message: "New ID is same as old ID" 
            });
        }
        
        // 步骤3: 获取车辆数据
        console.log('🚗 获取车辆数据...');
        const getCarsUrl = `${CPM_BASE_URL}/TestGetAllCars`;
        const carsResponse = await sendCPMRequest(getCarsUrl, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        let carsData = [];
        if (carsResponse?.result) {
            try { 
                carsData = JSON.parse(carsResponse.result); 
            } catch (e) { 
                carsData = carsResponse.result; 
            }
        }
        
        const carCount = Array.isArray(carsData) ? carsData.length : 0;
        console.log(`📊 账号有 ${carCount} 辆车`);
        
        // 步骤4: 更新账号ID
        console.log('✏️ 更新账号ID...');
        accountData.localID = newLocalId;
        if (accountData.localId) accountData.localId = newLocalId;
        
        // 清理不需要的字段
        const fieldsToDelete = ['_id', 'id', 'createdAt', 'updatedAt', '__v', 'userId', 'firebaseId'];
        fieldsToDelete.forEach(field => {
            delete accountData[field];
        });
        
        // 步骤5: 保存账号数据
        console.log('💾 保存账号数据...');
        const saveAccountUrl = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const saveAccountResponse = await sendCPMRequest(saveAccountUrl, { 
            data: JSON.stringify(accountData)
        }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        console.log('📦 保存账号响应:', saveAccountResponse);
        
        // 检查保存结果
        if (!saveAccountResponse || 
            (saveAccountResponse.result !== "1" && 
             saveAccountResponse.result !== 1 && 
             saveAccountResponse.result !== '{"result":1}')) {
            console.error('❌ 保存账号数据失败');
            return res.json({
                ok: false,
                result: 0,
                message: "Failed to save account data"
            });
        }
        
        console.log('✅ 账号数据保存成功');
        
        // 步骤6: 更新车辆数据
        let updatedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(carsData) && carsData.length > 0) {
            console.log(`🔄 开始更新 ${carCount} 辆车...`);
            
            // 分批处理车辆
            const batchSize = 2;
            for (let i = 0; i < carsData.length; i += batchSize) {
                const batch = carsData.slice(i, Math.min(i + batchSize, carsData.length));
                console.log(`📦 处理批次 ${i/batchSize + 1} (${batch.length} 辆车)`);
                
                const batchPromises = batch.map(async (car, index) => {
                    try {
                        let carCopy = JSON.parse(JSON.stringify(car));
                        
                        // 替换所有出现的旧ID
                        if (oldLocalId && cleanOldLocalId) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            try { 
                                carCopy = JSON.parse(newCarStr); 
                            } catch (e) {
                                console.warn(`⚠️ 车辆 ${i + index} JSON解析失败，继续处理`);
                            }
                        }
                        
                        // 清理字段
                        fieldsToDelete.forEach(field => {
                            delete carCopy[field];
                        });
                        
                        // 更新CarID字段
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (oldLocalId && carCopy.CarID.includes(oldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                            }
                            if (cleanOldLocalId && carCopy.CarID.includes(cleanOldLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(cleanOldLocalId), 'g'), newLocalId);
                            }
                        }
                        
                        // 保存车辆
                        const saveCarUrl = `${CPM_BASE_URL}/SaveCars`;
                        const saveCarResponse = await sendCPMRequest(saveCarUrl, { 
                            data: JSON.stringify(carCopy)
                        }, {
                            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                            "Authorization": `Bearer ${authToken}`,
                            "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
                            "Content-Type": "application/json; charset=utf-8",
                            "User-Agent": "okhttp/3.12.13"
                        });
                        
                        if (saveCarResponse && (saveCarResponse.result === '{"result":1}' || saveCarResponse.result === 1 || saveCarResponse.success)) {
                            updatedCars++;
                            return true;
                        } else {
                            failedCars++;
                            console.error(`❌ 车辆 ${i + index} 保存失败:`, saveCarResponse);
                            return false;
                        }
                    } catch (error) {
                        failedCars++;
                        console.error(`❌ 车辆 ${i + index} 处理错误:`, error.message);
                        return false;
                    }
                });
                
                await Promise.all(batchPromises);
                
                // 批次间等待
                if (i + batchSize < carsData.length) {
                    const waitTime = 1500;
                    console.log(`⏳ 等待 ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`🎉 车辆更新完成: ${updatedCars}成功, ${failedCars}失败`);
        
        // 最终验证
        console.log('🔍 验证更改...');
        const verifyResponse = await sendCPMRequest(getAccountUrl, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json"
        });
        
        let verified = false;
        if (verifyResponse?.result) {
            try {
                const verifiedData = JSON.parse(verifyResponse.result);
                verified = (verifiedData.localID === newLocalId) || (verifiedData.localId === newLocalId);
            } catch (e) {}
        }
        
        res.json({
            ok: true,
            result: 1,
            message: verified ? "Local ID changed successfully!" : "ID changed, please verify in game",
            details: {
                oldLocalId: cleanOldLocalId,
                newLocalId: newLocalId,
                carsUpdated: updatedCars,
                carsFailed: failedCars,
                totalCars: carCount,
                verification: verified ? "SUCCESS" : "PENDING"
            }
        });
        
    } catch (error) {
        console.error('💥 修改ID过程错误:', error);
        res.json({ 
            ok: false, 
            result: 0, 
            message: `Process failed: ${error.message}` 
        });
    }
});

// ==================== 修复的克隆账号 API ====================
app.post('/api/clone-account', async (req, res) => {
    console.log('👥 收到克隆请求');
    
    const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
        return res.json({
            ok: false,
            error: 400,
            message: "Missing required parameters"
        });
    }
    
    try {
        // 步骤1: 登录目标账号
        console.log(`🔑 登录目标账号: ${targetEmail}`);
        const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
        const loginResponse = await sendCPMRequest(loginUrl, {
            email: targetEmail,
            password: targetPassword,
            returnSecureToken: true,
            clientType: "CLIENT_TYPE_ANDROID"
        }, {
            "Content-Type": "application/json"
        }, { key: FIREBASE_API_KEY });
        
        if (!loginResponse?.idToken) {
            const error = loginResponse?.error?.message || "UNKNOWN_ERROR";
            console.error(`❌ 目标账号登录失败: ${error}`);
            return res.json({
                ok: false,
                error: 401,
                message: `Failed to login to target account: ${error}`
            });
        }
        
        const targetAuth = loginResponse.idToken;
        console.log('✅ 目标账号登录成功');
        
        // 步骤2: 获取源账号数据
        console.log('📋 获取源账号数据...');
        const getSourceDataUrl = `${CPM_BASE_URL}/GetPlayerRecords2`;
        const sourceDataResponse = await sendCPMRequest(getSourceDataUrl, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        if (!sourceDataResponse?.result) {
            console.error('❌ 获取源账号数据失败');
            return res.json({
                ok: false,
                error: 404,
                message: "Failed to get source account data"
            });
        }
        
        let sourceData;
        try { 
            sourceData = JSON.parse(sourceDataResponse.result); 
        } catch (e) { 
            sourceData = sourceDataResponse.result; 
        }
        
        const sourceLocalId = sourceData.localID || sourceData.localId;
        const cleanSourceLocalId = removeColorCodes(sourceLocalId);
        
        // 步骤3: 生成或使用自定义ID
        let newLocalId;
        if (customLocalId && customLocalId.trim() !== '') {
            newLocalId = customLocalId.trim();
        } else {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            newLocalId = '';
            for (let i = 0; i < 10; i++) {
                newLocalId += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        }
        
        console.log(`🔄 源ID: ${cleanSourceLocalId} → 新ID: ${newLocalId}`);
        
        // 步骤4: 获取源账号车辆
        console.log('🚗 获取源账号车辆...');
        const getSourceCarsUrl = `${CPM_BASE_URL}/TestGetAllCars`;
        const sourceCarsResponse = await sendCPMRequest(getSourceCarsUrl, { data: null }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${sourceAuth}`,
            "Content-Type": "application/json"
        });
        
        let sourceCars = [];
        if (sourceCarsResponse?.result) {
            try { 
                sourceCars = JSON.parse(sourceCarsResponse.result); 
            } catch (e) { 
                sourceCars = sourceCarsResponse.result; 
            }
        }
        
        const carCount = Array.isArray(sourceCars) ? sourceCars.length : 0;
        console.log(`📊 源账号有 ${carCount} 辆车`);
        
        // 步骤5: 准备目标数据
        console.log('✏️ 准备目标数据...');
        const targetData = { ...sourceData };
        targetData.localID = newLocalId;
        targetData.localId = newLocalId;
        
        // 清理字段
        const fieldsToDelete = ['_id', 'id', 'createdAt', 'updatedAt', '__v', 'userId', 'firebaseId'];
        fieldsToDelete.forEach(field => {
            delete targetData[field];
        });
        
        // 确保必要字段存在
        if (!targetData.Name) targetData.Name = "TELMunn";
        if (!targetData.money) targetData.money = 500000000;
        
        // 步骤6: 保存目标账号数据
        console.log('💾 保存目标账号数据...');
        const saveTargetDataUrl = `${CPM_BASE_URL}/SavePlayerRecordsIOS`;
        const saveTargetResponse = await sendCPMRequest(saveTargetDataUrl, { 
            data: JSON.stringify(targetData)
        }, {
            "User-Agent": "okhttp/3.12.13",
            "Authorization": `Bearer ${targetAuth}`,
            "Content-Type": "application/json"
        });
        
        console.log('📦 保存目标账号响应:', saveTargetResponse);
        
        if (!saveTargetResponse || 
            (saveTargetResponse.result !== "1" && 
             saveTargetResponse.result !== 1 && 
             saveTargetResponse.result !== '{"result":1}')) {
            console.error('❌ 保存目标账号数据失败');
            return res.json({
                ok: false,
                error: 500,
                message: "Failed to save target account data"
            });
        }
        
        console.log('✅ 目标账号数据保存成功');
        
        // 步骤7: 克隆车辆数据
        let clonedCars = 0;
        let failedCars = 0;
        
        if (Array.isArray(sourceCars) && sourceCars.length > 0) {
            console.log(`🔄 开始克隆 ${carCount} 辆车...`);
            
            const batchSize = 1; // 更小的批次，提高成功率
            for (let i = 0; i < sourceCars.length; i += batchSize) {
                const batch = sourceCars.slice(i, Math.min(i + batchSize, sourceCars.length));
                console.log(`📦 处理批次 ${i/batchSize + 1} (${batch.length} 辆车)`);
                
                const batchPromises = batch.map(async (car, index) => {
                    try {
                        let carCopy = JSON.parse(JSON.stringify(car));
                        
                        // 替换源ID为新ID
                        if (sourceLocalId && cleanSourceLocalId) {
                            const carStr = JSON.stringify(carCopy);
                            let newCarStr = carStr.replace(new RegExp(escapeRegExp(sourceLocalId), 'g'), newLocalId);
                            newCarStr = newCarStr.replace(new RegExp(escapeRegExp(cleanSourceLocalId), 'g'), newLocalId);
                            try { 
                                carCopy = JSON.parse(newCarStr); 
                            } catch (e) {
                                console.warn(`⚠️ 车辆 ${i + index} JSON解析失败，继续处理`);
                            }
                        }
                        
                        // 清理字段
                        fieldsToDelete.forEach(field => {
                            delete carCopy[field];
                        });
                        
                        // 更新CarID字段
                        if (carCopy.CarID && typeof carCopy.CarID === 'string') {
                            if (sourceLocalId && carCopy.CarID.includes(sourceLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(sourceLocalId), 'g'), newLocalId);
                            }
                            if (cleanSourceLocalId && carCopy.CarID.includes(cleanSourceLocalId)) {
                                carCopy.CarID = carCopy.CarID.replace(new RegExp(escapeRegExp(cleanSourceLocalId), 'g'), newLocalId);
                            }
                        }
                        
                        // 保存车辆
                        const saveCarUrl = `${CPM_BASE_URL}/SaveCars`;
                        const saveCarResponse = await sendCPMRequest(saveCarUrl, { 
                            data: JSON.stringify(carCopy)
                        }, {
                            "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                            "Authorization": `Bearer ${targetAuth}`,
                            "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
                            "Content-Type": "application/json; charset=utf-8",
                            "User-Agent": "okhttp/3.12.13"
                        });
                        
                        if (saveCarResponse && (saveCarResponse.result === '{"result":1}' || saveCarResponse.result === 1 || saveCarResponse.success)) {
                            clonedCars++;
                            return true;
                        } else {
                            failedCars++;
                            console.error(`❌ 车辆 ${i + index} 克隆失败:`, saveCarResponse);
                            return false;
                        }
                    } catch (error) {
                        failedCars++;
                        console.error(`❌ 车辆 ${i + index} 处理错误:`, error.message);
                        return false;
                    }
                });
                
                await Promise.all(batchPromises);
                
                // 批次间等待更长（减少服务器压力）
                if (i + batchSize < sourceCars.length) {
                    const waitTime = 2000;
                    console.log(`⏳ 等待 ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`🎉 克隆完成: ${clonedCars}成功, ${failedCars}失败`);
        
        res.json({
            ok: true,
            error: 0,
            message: `Account cloned successfully! ${clonedCars} cars cloned.`,
            details: {
                targetAccount: targetEmail,
                carsCloned: clonedCars,
                carsFailed: failedCars,
                newLocalId: newLocalId,
                totalCars: carCount
            }
        });
        
    } catch (error) {
        console.error('💥 克隆过程错误:', error);
        res.json({
            ok: false,
            error: 500,
            message: `Clone failed: ${error.message}`
        });
    }
});

// ==================== 其他API（保持原样） ====================

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

// 6. 修改绿钞和金币（保持原样）
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

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy Clone Service',
        timestamp: new Date().toISOString(),
        version: '2.4-fixed'
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
    ⚡ 版本: 2.4-fixed (修复ID修改和克隆问题)
    
    启动时间: ${new Date().toLocaleString()}
    ====================================
    `);
});
