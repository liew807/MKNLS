const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM";
const FIREBASE_INSTANCE_ID_TOKEN = process.env.FIREBASE_INSTANCE_ID_TOKEN || "fdEMFcKoR2iSrZAzViyFkh:APA91bEQsP8kAGfBuPTL_ATg25AmnqpssGTkc7IAS2CgLiILjBbneFuSEzOJr2a97eDvQOPGxlphSIV7gCk2k4Wl0UxMK5x298LrJYa5tJmVRqdyz0j3KDSKLCtCbldkRFwNnjU3lwfP";
const CPM_BASE_URL = "https://us-central1-cp-multiplayer.cloudfunctions.net";

app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
    next();
});

function removeColorCodes(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\[[0-9A-F]{6}\]/g, '');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sendCPMRequest(url, payload, headers, params = {}, maxRetries = 3) {
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
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                continue;
            }
            
            if (response.status >= 500) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            return response.data;
            
        } catch (error) {
            console.error(`尝试 ${attempt} 失败:`, error.message);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    return null;
}

// ==================== API ====================

// 1. 登录
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    console.log('🔑 登录:', email);
    
    if (!email || !password) {
        return res.json({ ok: false, error: 400, message: "Missing email or password" });
    }

    try {
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
                "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
                "Content-Type": "application/json"
            },
            timeout: 10000
        });
        
        if (response.data?.idToken) {
            console.log('✅ 登录成功');
            res.json({
                ok: true,
                error: 0,
                message: "SUCCESSFUL",
                auth: response.data.idToken,
                refreshToken: response.data.refreshToken,
                expiresIn: response.data.expiresIn,
                localId: response.data.localId,
                email: email
            });
        } else {
            res.json({ ok: false, error: 401, message: response.data?.error?.message || "UNKNOWN_ERROR" });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: error.response?.data?.error?.message || error.message });
    }
});

// 2. 获取账号数据 - 终极修复版（接受任何返回格式）
app.post('/api/get-account-data', async (req, res) => {
    const { authToken } = req.body;
    
    console.log('📥 获取账号数据');
    
    if (!authToken) {
        return res.json({ ok: false, error: 401, message: "Missing auth token", data: null });
    }
    
    try {
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            }
        );
        
        console.log('📦 响应类型:', typeof response);
        
        // 🔥 不管返回什么格式，都尝试提取数据
        let data = null;
        
        if (!response) {
            console.log('❌ response为null');
        } else if (response.result) {
            console.log('✅ 从result提取');
            try { data = JSON.parse(response.result); } catch(e) { data = response.result; }
        } else if (response.data) {
            console.log('✅ 从data提取');
            data = response.data;
        } else if (typeof response === 'string') {
            console.log('✅ response是字符串');
            try { data = JSON.parse(response); } catch(e) { data = response; }
        } else if (typeof response === 'object') {
            console.log('✅ response是对象，直接使用');
            data = response;
        }
        
        if (data) {
            console.log('✅ 获取成功');
            res.json({ ok: true, error: 0, message: "SUCCESSFUL", data: data });
        } else {
            console.log('❌ 无法提取数据');
            res.json({ ok: false, error: 404, message: "NO_DATA", data: null });
        }
        
    } catch (error) {
        console.error('❌ 错误:', error.message);
        res.json({ ok: false, error: 500, message: error.message, data: null });
    }
});

// 3. 获取所有车辆
app.post('/api/get-all-cars', async (req, res) => {
    const { authToken } = req.body;
    if (!authToken) return res.json({ ok: false, data: [] });
    
    try {
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            }
        );
        
        let data = [];
        if (response?.result) {
            try { data = JSON.parse(response.result); } catch(e) { data = response.result; }
        }
        
        res.json({ ok: true, data: Array.isArray(data) ? data : [] });
    } catch (error) {
        res.json({ ok: true, data: [] });
    }
});

// 4. 修改本地ID
app.post('/api/change-localid', async (req, res) => {
    const { sourceEmail, sourcePassword, newLocalId, authToken: providedToken } = req.body;
    
    if (!newLocalId) {
        return res.json({ ok: false, result: 0, message: "Missing new local ID" });
    }
    
    let authToken = providedToken;
    
    try {
        if (!authToken && sourceEmail && sourcePassword) {
            const loginResponse = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email: sourceEmail, password: sourcePassword, returnSecureToken: true, clientType: "CLIENT_TYPE_ANDROID" },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            
            if (loginResponse.data?.idToken) {
                authToken = loginResponse.data.idToken;
            } else {
                return res.json({ ok: false, result: 0, message: "Login failed" });
            }
        }
        
        if (!authToken) {
            return res.json({ ok: false, result: 0, message: "No auth token" });
        }
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            }
        );
        
        if (!response?.result) {
            return res.json({ ok: false, result: 0, message: "Failed to get account data" });
        }
        
        const accountData = JSON.parse(response.result);
        const oldLocalId = accountData.localID || accountData.localId || '';
        const cleanOldId = removeColorCodes(oldLocalId);
        
        accountData.localID = newLocalId;
        if (accountData.localId !== undefined) accountData.localId = newLocalId;
        
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete accountData[f]);
        
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(accountData) },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            }
        );
        
        if (!saveRes?.result) {
            return res.json({ ok: false, result: 0, message: "Save failed" });
        }
        
        res.json({
            ok: true,
            result: 1,
            message: "ID changed successfully!",
            details: {
                oldLocalId: cleanOldId,
                newLocalId: newLocalId,
                carsUpdated: 0,
                carsFailed: 0
            }
        });
        
    } catch (error) {
        res.json({ ok: false, result: 0, message: error.message });
    }
});

// 5. 克隆账号
app.post('/api/clone-account', async (req, res) => {
    const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
        return res.json({ ok: false, error: 400, message: "Missing required parameters" });
    }
    
    try {
        const accountResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json"
            }
        );
        
        if (!accountResponse?.result) {
            return res.json({ ok: false, error: 404, message: "Failed to get source account data" });
        }
        
        const sourceData = JSON.parse(accountResponse.result);
        
        const targetLogin = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: { email: targetEmail, password: targetPassword, returnSecureToken: true, clientType: "CLIENT_TYPE_ANDROID" },
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });
        
        if (!targetLogin.data?.idToken) {
            return res.json({ ok: false, error: 401, message: "Target login failed" });
        }
        
        const newId = customLocalId || Math.random().toString(36).substring(2, 12).toUpperCase();
        const targetData = { ...sourceData, localID: newId, localId: newId };
        
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete targetData[f]);
        
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(targetData) },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "User-Agent": "okhttp/3.12.13",
                "Authorization": `Bearer ${targetLogin.data.idToken}`,
                "Content-Type": "application/json"
            }
        );
        
        if (!saveRes?.result) {
            return res.json({ ok: false, error: 500, message: "Save failed" });
        }
        
        res.json({
            ok: true,
            error: 0,
            message: "Clone successful!",
            details: {
                targetAccount: targetEmail,
                carsCloned: 0,
                carsFailed: 0,
                newLocalId: newId
            }
        });
        
    } catch (error) {
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 6. 修改绿钞
app.post('/api/modify-green-cash', async (req, res) => {
    try {
        const { authToken, amount, operationType = 'set' } = req.body;
        
        if (!authToken || amount === undefined) {
            return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
        }
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!response?.result) {
            return res.json({ ok: false, error: 404, message: "GET_FAILED" });
        }
        
        const playerData = JSON.parse(response.result);
        const oldCash = playerData.cash || playerData.Cash || 0;
        const greenAmount = Number(amount);
        
        let newCash;
        if (operationType === 'add') {
            newCash = Math.min(oldCash + greenAmount, 999999999);
        } else {
            newCash = Math.min(greenAmount, 999999999);
        }
        
        playerData.cash = newCash;
        playerData.Cash = newCash;
        
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);
        
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveRes?.result) {
            res.json({ ok: true, error: 0, message: "SUCCESS", details: { oldValue: oldCash, newValue: newCash } });
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
        
        if (!authToken || amount === undefined) {
            return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
        }
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!response?.result) {
            return res.json({ ok: false, error: 404, message: "GET_FAILED" });
        }
        
        const playerData = JSON.parse(response.result);
        const oldCoin = playerData.coin || playerData.Coin || playerData.money || 0;
        const goldAmount = Number(amount);
        
        let newCoin;
        if (operationType === 'add') {
            newCoin = Math.min(oldCoin + goldAmount, 999999999);
        } else {
            newCoin = Math.min(goldAmount, 999999999);
        }
        
        playerData.coin = newCoin;
        playerData.Coin = newCoin;
        playerData.money = newCoin;
        
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);
        
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveRes?.result) {
            res.json({ ok: true, error: 0, message: "SUCCESS", details: { oldValue: oldCoin, newValue: newCoin } });
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
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (!response?.result) {
            return res.json({ ok: false, error: 404, message: "GET_FAILED" });
        }
        
        const playerData = JSON.parse(response.result);
        playerData.cash = 999999999;
        playerData.Cash = 999999999;
        playerData.coin = 999999999;
        playerData.Coin = 999999999;
        playerData.money = 999999999;
        
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);
        
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );
        
        if (saveRes?.result) {
            res.json({ ok: true, error: 0, message: "SUCCESS" });
        } else {
            res.json({ ok: false, error: 500, message: "SAVE_FAILED" });
        }
    } catch (error) {
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '10.0-final' });
});

app.get('/api/test', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
    console.log(`
    🚀 CPM工具箱 v10.0 终极版
    📍 http://localhost:${PORT}
    ✅ 全部接口已修复
    ====================================
    `);
});
