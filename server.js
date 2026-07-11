const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const FIREBASE_API_KEY = "AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM";
const FIREBASE_INSTANCE_ID_TOKEN = "fdEMFcKoR2iSrZAzViyFkh:APA91bEQsP8kAGfBuPTL_ATg25AmnqpssGTkc7IAS2CgLiILjBbneFuSEzOJr2a97eDvQOPGxlphSIV7gCk2k4Wl0UxMK5x298LrJYa5tJmVRqdyz0j3KDSKLCtCbldkRFwNnjU3lwfP";
const CPM_BASE_URL = "https://us-central1-cp-multiplayer.cloudfunctions.net";

// 工具函数
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 请求函数
async function sendCPMRequest(url, payload, headers) {
    try {
        const response = await axios({
            method: 'post',
            url: url,
            data: payload,
            headers: headers,
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error('请求失败:', error.message);
        return null;
    }
}

// ==================== API ====================

// 登录
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.json({ ok: false, message: "请输入邮箱和密码" });
        }

        const response = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: { email, password, returnSecureToken: true },
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });
        
        if (response.data?.idToken) {
            res.json({
                ok: true,
                auth: response.data.idToken,
                email: email
            });
        } else {
            res.json({ ok: false, message: "登录失败" });
        }
    } catch (error) {
        const msg = error.response?.data?.error?.message || "登录失败";
        res.json({ ok: false, message: msg });
    }
});

// 获取账号数据 - 终极修复版
app.post('/api/get-account-data', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, message: "缺少token" });
        }

        console.log('正在获取账号数据...');
        
        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        console.log('CPM响应:', JSON.stringify(response));

        if (!response || !response.result) {
            return res.json({ ok: false, message: "获取失败" });
        }

        let accountData;
        try {
            accountData = JSON.parse(response.result);
        } catch(e) {
            accountData = response.result;
        }

        // 确保返回格式统一
        res.json({
            ok: true,
            data: accountData
        });

    } catch (error) {
        console.error('错误:', error.message);
        res.json({ ok: false, message: error.message });
    }
});

// 修改绿钞
app.post('/api/modify-green-cash', async (req, res) => {
    try {
        const { authToken, amount, operationType = 'set' } = req.body;
        
        if (!authToken || amount === undefined) {
            return res.json({ ok: false, message: "缺少参数" });
        }

        const greenAmount = Number(amount);
        
        // 获取当前数据
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
            return res.json({ ok: false, message: "获取数据失败" });
        }

        const playerData = JSON.parse(response.result);
        const oldCash = playerData.cash || 0;
        
        let newCash;
        if (operationType === 'add') {
            newCash = Math.min(oldCash + greenAmount, 999999999);
        } else {
            newCash = Math.min(greenAmount, 999999999);
        }

        playerData.cash = newCash;
        playerData.Cash = newCash;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);

        const saveResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveResponse?.result) {
            res.json({
                ok: true,
                details: { oldValue: oldCash, newValue: newCash }
            });
        } else {
            res.json({ ok: false, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// 修改金币
app.post('/api/modify-gold-coins', async (req, res) => {
    try {
        const { authToken, amount, operationType = 'set' } = req.body;
        
        if (!authToken || amount === undefined) {
            return res.json({ ok: false, message: "缺少参数" });
        }

        const goldAmount = Number(amount);
        
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
            return res.json({ ok: false, message: "获取数据失败" });
        }

        const playerData = JSON.parse(response.result);
        const oldCoin = playerData.coin || playerData.money || 0;
        
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

        const saveResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveResponse?.result) {
            res.json({
                ok: true,
                details: { oldValue: oldCoin, newValue: newCoin }
            });
        } else {
            res.json({ ok: false, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// 一键最大
app.post('/api/max-money', async (req, res) => {
    try {
        const { authToken } = req.body;
        
        if (!authToken) {
            return res.json({ ok: false, message: "缺少token" });
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

        if (!response?.result) {
            return res.json({ ok: false, message: "获取数据失败" });
        }

        const playerData = JSON.parse(response.result);
        playerData.cash = 999999999;
        playerData.Cash = 999999999;
        playerData.coin = 999999999;
        playerData.Coin = 999999999;
        playerData.money = 999999999;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);

        const saveResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveResponse?.result) {
            res.json({ ok: true });
        } else {
            res.json({ ok: false, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// 修改ID
app.post('/api/change-localid', async (req, res) => {
    try {
        const { authToken, newLocalId } = req.body;
        
        if (!authToken || !newLocalId) {
            return res.json({ ok: false, message: "缺少参数" });
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

        if (!response?.result) {
            return res.json({ ok: false, message: "获取数据失败" });
        }

        const playerData = JSON.parse(response.result);
        playerData.localID = newLocalId;
        playerData.localId = newLocalId;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);

        const saveResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveResponse?.result) {
            res.json({ ok: true, details: { carsUpdated: 0 } });
        } else {
            res.json({ ok: false, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// 克隆账号
app.post('/api/clone-account', async (req, res) => {
    try {
        const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
        
        if (!sourceAuth || !targetEmail || !targetPassword) {
            return res.json({ ok: false, message: "缺少参数" });
        }

        // 获取源数据
        const sourceResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!sourceResponse?.result) {
            return res.json({ ok: false, message: "获取源数据失败" });
        }

        const sourceData = JSON.parse(sourceResponse.result);
        const newId = customLocalId || Math.random().toString(36).substring(2, 12).toUpperCase();
        
        const targetData = { ...sourceData, localID: newId, localId: newId };

        // 登录目标账号
        const loginResponse = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: { email: targetEmail, password: targetPassword, returnSecureToken: true },
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });

        if (!loginResponse.data?.idToken) {
            return res.json({ ok: false, message: "目标账号登录失败" });
        }

        const targetAuth = loginResponse.data.idToken;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete targetData[f]);

        const saveResponse = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(targetData) },
            {
                "Authorization": `Bearer ${targetAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveResponse?.result) {
            res.json({
                ok: true,
                details: { carsCloned: 0, newLocalId: newId }
            });
        } else {
            res.json({ ok: false, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// 获取车辆
app.post('/api/get-all-cars', async (req, res) => {
    try {
        const { authToken } = req.body;
        
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
            try { data = JSON.parse(response.result); } catch(e) { data = []; }
            res.json({ ok: true, data: data });
        } else {
            res.json({ ok: true, data: [] });
        }
    } catch (error) {
        res.json({ ok: true, data: [] });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '6.0-ultimate-fix' });
});

app.get('/api/test', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
    console.log(`🚀 服务器启动: http://localhost:${PORT}`);
    console.log('✅ 版本: 6.0 终极修复版');
});
