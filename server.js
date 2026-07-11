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
function removeColorCodes(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\[[0-9A-F]{6}\]/g, '');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 请求函数
async function sendCPMRequest(url, payload, headers) {
    console.log('📡 请求:', url.substring(0, 80));
    try {
        const response = await axios({
            method: 'post',
            url: url,
            data: payload,
            headers: headers,
            timeout: 30000
        });
        console.log('✅ 响应:', response.status);
        return response.data;
    } catch (error) {
        console.error('❌ 请求失败:', error.message);
        return null;
    }
}

// 日志
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
    next();
});

// ==================== 1. 登录 ====================
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔑 登录:', email);
        
        if (!email || !password) {
            return res.json({ ok: false, message: "请输入邮箱和密码" });
        }

        const response = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: { email, password, returnSecureToken: true, clientType: "CLIENT_TYPE_ANDROID" },
            headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
            timeout: 10000
        });
        
        if (response.data?.idToken) {
            console.log('✅ 登录成功');
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
            res.json({ ok: false, message: "登录失败" });
        }
    } catch (error) {
        const msg = error.response?.data?.error?.message || "登录失败";
        let userMsg = "登录失败";
        if (msg.includes('EMAIL_NOT_FOUND')) userMsg = "邮箱未注册";
        else if (msg.includes('INVALID_PASSWORD')) userMsg = "密码错误";
        else if (msg.includes('INVALID_EMAIL')) userMsg = "邮箱格式不正确";
        else if (msg.includes('TOO_MANY_ATTEMPTS')) userMsg = "尝试次数过多";
        
        console.log('❌ 登录失败:', userMsg);
        res.json({ ok: false, error: 401, message: userMsg });
    }
});

// ==================== 2. 获取账号数据 ====================
app.post('/api/get-account-data', async (req, res) => {
    try {
        const { authToken } = req.body;
        console.log('📥 获取账号数据');
        
        if (!authToken) {
            return res.json({ ok: false, error: 401, message: "缺少认证令牌", data: null });
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

        if (!response || !response.result) {
            console.log('❌ 获取失败');
            return res.json({ ok: false, error: 404, message: "获取数据失败", data: null });
        }

        let accountData;
        try {
            accountData = JSON.parse(response.result);
            console.log('✅ 数据获取成功');
        } catch(e) {
            accountData = response.result;
        }

        res.json({
            ok: true,
            error: 0,
            message: "获取成功",
            data: accountData
        });

    } catch (error) {
        console.error('❌ 异常:', error.message);
        res.json({ ok: false, error: 500, message: error.message, data: null });
    }
});

// ==================== 3. 获取所有车辆 ====================
app.post('/api/get-all-cars', async (req, res) => {
    try {
        const { authToken } = req.body;
        if (!authToken) return res.json({ ok: false, data: [] });
        
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
            res.json({ ok: true, data: Array.isArray(data) ? data : [] });
        } else {
            res.json({ ok: true, data: [] });
        }
    } catch (error) {
        res.json({ ok: true, data: [] });
    }
});

// ==================== 4. 修改本地ID ====================
app.post('/api/change-localid', async (req, res) => {
    try {
        const { email, password, newLocalId, authToken: providedToken } = req.body;
        console.log('🆔 修改ID:', newLocalId);
        
        if (!newLocalId) {
            return res.json({ ok: false, result: 0, message: "缺少新ID" });
        }

        let authToken = providedToken;
        
        // 如果没有token，用邮箱密码登录
        if (!authToken && email && password) {
            const loginRes = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email, password, returnSecureToken: true },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            if (loginRes.data?.idToken) {
                authToken = loginRes.data.idToken;
            }
        }
        
        if (!authToken) {
            return res.json({ ok: false, result: 0, message: "需要认证令牌" });
        }

        // 获取账号数据
        const accountRes = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!accountRes?.result) {
            return res.json({ ok: false, result: 0, message: "获取账号数据失败" });
        }

        const accountData = JSON.parse(accountRes.result);
        const oldLocalId = accountData.localID || accountData.localId || '';
        const cleanOldId = removeColorCodes(oldLocalId);

        accountData.localID = newLocalId;
        if (accountData.localId !== undefined) accountData.localId = newLocalId;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete accountData[f]);

        // 保存账号数据
        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(accountData) },
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!saveRes?.result) {
            return res.json({ ok: false, result: 0, message: "保存失败" });
        }

        // 更新车辆
        const carsRes = await sendCPMRequest(
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

        if (carsRes?.result) {
            const carsData = JSON.parse(carsRes.result);
            const cars = Array.isArray(carsData) ? carsData : [];

            for (let i = 0; i < cars.length; i++) {
                try {
                    let carStr = JSON.stringify(cars[i]);
                    if (oldLocalId) carStr = carStr.replace(new RegExp(escapeRegExp(oldLocalId), 'g'), newLocalId);
                    if (cleanOldId && cleanOldId !== oldLocalId) carStr = carStr.replace(new RegExp(escapeRegExp(cleanOldId), 'g'), newLocalId);
                    
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

                    if (carSaveRes?.result) updatedCars++;
                    else failedCars++;

                    if (i < cars.length - 1) await new Promise(r => setTimeout(r, 200));
                } catch(e) {
                    failedCars++;
                }
            }
        }

        console.log('✅ ID修改完成, 更新车辆:', updatedCars);
        res.json({
            ok: true,
            result: 1,
            message: "ID修改成功",
            details: {
                oldLocalId: cleanOldId,
                newLocalId: newLocalId,
                carsUpdated: updatedCars,
                carsFailed: failedCars
            }
        });

    } catch (error) {
        console.error('❌ 修改ID错误:', error.message);
        res.json({ ok: false, result: 0, message: error.message });
    }
});

// ==================== 5. 克隆账号 ====================
app.post('/api/clone-account', async (req, res) => {
    try {
        const { sourceAuth, targetEmail, targetPassword, customLocalId } = req.body;
        console.log('📋 克隆到:', targetEmail);
        
        if (!sourceAuth || !targetEmail || !targetPassword) {
            return res.json({ ok: false, error: 400, message: "缺少参数" });
        }

        // 获取源数据
        const sourceRes = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!sourceRes?.result) {
            return res.json({ ok: false, error: 404, message: "获取源数据失败" });
        }

        const sourceData = JSON.parse(sourceRes.result);
        let from_id = sourceData.localID || sourceData.localId;
        const clean_from_id = removeColorCodes(from_id);

        // 获取源车辆
        const sourceCarsRes = await sendCPMRequest(
            `${CPM_BASE_URL}/TestGetAllCars`,
            { data: null },
            {
                "Authorization": `Bearer ${sourceAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        let sourceCars = [];
        if (sourceCarsRes?.result) {
            try { sourceCars = JSON.parse(sourceCarsRes.result); } catch(e) {}
        }
        if (!Array.isArray(sourceCars)) sourceCars = [];

        // 生成新ID
        let newId = customLocalId || Math.random().toString(36).substring(2, 12).toUpperCase();

        // 准备目标数据
        const targetData = { ...sourceData, localID: newId, localId: newId };
        if (!targetData.Name) targetData.Name = "Player";

        // 登录目标账号
        const targetLogin = await axios({
            method: 'post',
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
            data: { email: targetEmail, password: targetPassword, returnSecureToken: true },
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });

        if (!targetLogin.data?.idToken) {
            return res.json({ ok: false, error: 401, message: "目标账号登录失败" });
        }

        const targetAuth = targetLogin.data.idToken;

        // 保存目标数据
        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete targetData[f]);

        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(targetData) },
            {
                "Authorization": `Bearer ${targetAuth}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!saveRes?.result) {
            return res.json({ ok: false, error: 500, message: "保存目标数据失败" });
        }

        // 克隆车辆
        let clonedCars = 0;
        let failedCars = 0;

        for (let i = 0; i < sourceCars.length; i++) {
            try {
                let carStr = JSON.stringify(sourceCars[i]);
                if (from_id) carStr = carStr.replace(new RegExp(escapeRegExp(from_id), 'g'), newId);
                if (clean_from_id && clean_from_id !== from_id) carStr = carStr.replace(new RegExp(escapeRegExp(clean_from_id), 'g'), newId);
                
                const carCopy = JSON.parse(carStr);
                ['_id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete carCopy[f]);

                const carSave = await sendCPMRequest(
                    `${CPM_BASE_URL}/SaveCars`,
                    { data: JSON.stringify(carCopy) },
                    {
                        "Authorization": `Bearer ${targetAuth}`,
                        "Content-Type": "application/json",
                        "User-Agent": "okhttp/3.12.13"
                    }
                );

                if (carSave?.result) clonedCars++;
                else failedCars++;

                if (i < sourceCars.length - 1) await new Promise(r => setTimeout(r, 500));
            } catch(e) {
                failedCars++;
            }
        }

        console.log('✅ 克隆完成, 车辆:', clonedCars);
        res.json({
            ok: true,
            error: 0,
            message: `克隆成功！${clonedCars}辆车`,
            details: {
                targetAccount: targetEmail,
                carsCloned: clonedCars,
                carsFailed: failedCars,
                newLocalId: newId
            }
        });

    } catch (error) {
        console.error('❌ 克隆错误:', error.message);
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// ==================== 6. 修改绿钞 ====================
app.post('/api/modify-green-cash', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        console.log('💚 修改绿钞:', amount, operationType);
        
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入绿钞数量" });
        }

        let token = authToken;
        if (!token && email && password) {
            const loginRes = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email, password, returnSecureToken: true },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            if (loginRes.data?.idToken) token = loginRes.data.idToken;
        }

        if (!token) return res.json({ ok: false, error: 401, message: "需要认证令牌" });

        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!response?.result) return res.json({ ok: false, error: 404, message: "获取数据失败" });

        const playerData = JSON.parse(response.result);
        const oldCash = playerData.cash || playerData.Cash || 0;
        const greenAmount = Number(amount);
        
        let newCash;
        if (operationType === 'add') newCash = Math.min(oldCash + greenAmount, 999999999);
        else newCash = Math.min(greenAmount, 999999999);

        playerData.cash = newCash;
        playerData.Cash = newCash;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);

        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveRes?.result) {
            console.log('✅ 绿钞:', oldCash, '->', newCash);
            res.json({
                ok: true,
                error: 0,
                message: "绿钞修改成功",
                details: { oldValue: oldCash, newValue: newCash }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// ==================== 7. 修改金币 ====================
app.post('/api/modify-gold-coins', async (req, res) => {
    try {
        const { authToken, email, password, amount, operationType = 'set' } = req.body;
        console.log('💛 修改金币:', amount, operationType);
        
        if (amount === undefined || amount === null || amount === '') {
            return res.json({ ok: false, error: 400, message: "请输入金币数量" });
        }

        let token = authToken;
        if (!token && email && password) {
            const loginRes = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email, password, returnSecureToken: true },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            if (loginRes.data?.idToken) token = loginRes.data.idToken;
        }

        if (!token) return res.json({ ok: false, error: 401, message: "需要认证令牌" });

        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!response?.result) return res.json({ ok: false, error: 404, message: "获取数据失败" });

        const playerData = JSON.parse(response.result);
        const oldCoin = playerData.coin || playerData.Coin || playerData.money || 0;
        const goldAmount = Number(amount);
        
        let newCoin;
        if (operationType === 'add') newCoin = Math.min(oldCoin + goldAmount, 999999999);
        else newCoin = Math.min(goldAmount, 999999999);

        playerData.coin = newCoin;
        playerData.Coin = newCoin;
        playerData.money = newCoin;

        ['_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach(f => delete playerData[f]);

        const saveRes = await sendCPMRequest(
            `${CPM_BASE_URL}/SavePlayerRecordsIOS`,
            { data: JSON.stringify(playerData) },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveRes?.result) {
            console.log('✅ 金币:', oldCoin, '->', newCoin);
            res.json({
                ok: true,
                error: 0,
                message: "金币修改成功",
                details: { oldValue: oldCoin, newValue: newCoin }
            });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// ==================== 8. 一键最大货币 ====================
app.post('/api/max-money', async (req, res) => {
    try {
        const { authToken, email, password } = req.body;
        console.log('💎 一键最大');
        
        let token = authToken;
        if (!token && email && password) {
            const loginRes = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email, password, returnSecureToken: true },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            if (loginRes.data?.idToken) token = loginRes.data.idToken;
        }

        if (!token) return res.json({ ok: false, error: 401, message: "需要认证令牌" });

        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!response?.result) return res.json({ ok: false, error: 404, message: "获取数据失败" });

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
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (saveRes?.result) {
            console.log('✅ 一键最大成功');
            res.json({ ok: true, error: 0, message: "已设置为最大值" });
        } else {
            res.json({ ok: false, error: 500, message: "保存失败" });
        }

    } catch (error) {
        res.json({ ok: false, error: 500, message: error.message });
    }
});

// ==================== 9. 查询货币 ====================
app.post('/api/get-money', async (req, res) => {
    try {
        const { authToken, email, password } = req.body;
        
        let token = authToken;
        if (!token && email && password) {
            const loginRes = await axios({
                method: 'post',
                url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`,
                data: { email, password, returnSecureToken: true },
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
            if (loginRes.data?.idToken) token = loginRes.data.idToken;
        }

        if (!token) return res.json({ ok: false, message: "需要认证令牌" });

        const response = await sendCPMRequest(
            `${CPM_BASE_URL}/GetPlayerRecords2`,
            { data: null },
            {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/3.12.13"
            }
        );

        if (!response?.result) return res.json({ ok: false, message: "获取失败" });

        const data = JSON.parse(response.result);
        
        res.json({
            ok: true,
            data: {
                greenCash: data.cash || data.Cash || 0,
                goldCoins: data.coin || data.Coin || data.money || 0
            }
        });

    } catch (error) {
        res.json({ ok: false, message: error.message });
    }
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'cpmcy API',
        version: '9.0-full',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/test', (req, res) => {
    res.json({ status: 'ok', message: 'API正常' });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

// 启动
app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('🚀 CPM工具箱服务器 v9.0 完整版');
    console.log('📍 http://localhost:' + PORT);
    console.log('========================================');
    console.log('📋 接口列表:');
    console.log('  1. POST /api/login');
    console.log('  2. POST /api/get-account-data');
    console.log('  3. POST /api/get-all-cars');
    console.log('  4. POST /api/change-localid');
    console.log('  5. POST /api/clone-account');
    console.log('  6. POST /api/modify-green-cash');
    console.log('  7. POST /api/modify-gold-coins');
    console.log('  8. POST /api/max-money');
    console.log('  9. POST /api/get-money');
    console.log('========================================');
    console.log('');
});
