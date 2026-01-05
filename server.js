require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// 补全PHP同款字符串工具函数
function strtoupper(str) {
  return str.toUpperCase();
}
function substr(str, start, length) {
  return str.substr(start, length);
}
function str_shuffle(str) {
  return str.split('').sort(() => 0.5 - Math.random()).join('');
}

// 生成PHP同款动态User-Agent
const generateCarUserAgent = () => {
  const randomNum = Math.floor(Math.random() * (888889 - 111111) + 111111);
  return `Dalvik/2.1.0 (Linux; U; Android 8.1.0; ASUS_X00TD MIUI/16.2017.2009.087-20${randomNum})`;
};

// 环境变量验证
const API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_INSTANCE_ID_TOKEN = process.env.FIREBASE_INSTANCE_ID_TOKEN;
if (!API_KEY || !FIREBASE_INSTANCE_ID_TOKEN) {
  console.error('❌ 缺失环境变量！请配置 FIREBASE_API_KEY 和 FIREBASE_INSTANCE_ID_TOKEN');
  process.exit(1);
}

// 中间件（修复跨域+请求解析）
app.use(cors({ 
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// 日志中间件
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path} | IP: ${req.ip}`);
  const logBody = { ...req.body };
  if (logBody.password) logBody.password = '***';
  if (logBody.targetPassword) logBody.targetPassword = '***';
  console.log('请求参数:', JSON.stringify(logBody, null, 2));
  next();
});

// 封装请求函数（适配SavePlayerRecordsIOS字符串格式）
const sendCPMRequest = async (url, payload, headers, params = {}) => {
  try {
    const fullUrl = url + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
    console.log(`发送请求: ${fullUrl}`);
    
    // 关键修复：SavePlayerRecordsIOS接口直接传字符串payload（与PHP一致）
    const requestData = url.includes('SavePlayerRecordsIOS') ? payload.data : payload;
    
    const response = await axios({
      method: 'POST',
      url: fullUrl,
      data: requestData, // 改用处理后的数据
      headers: headers,
      timeout: 60000,
      validateStatus: (status) => status >= 200 && status < 300
    });
    
    console.log(`响应状态: ${response.status} | 响应体: ${JSON.stringify(response.data, null, 2)}`);
    return response.data;
  } catch (error) {
    console.error(`请求失败: ${error.message} | 堆栈: ${error.stack}`);
    return null;
  }
};

// 辅助函数：错误码映射
function getErrorCode(errorMsg) {
  switch (errorMsg) {
    case "EMAIL_NOT_FOUND": return 100;
    case "INVALID_PASSWORD": return 101;
    case "WEAK_PASSWORD": return 102;
    case "INVALID_ID_TOKEN": return 103;
    case "EMAIL_EXISTS": return 105;
    case "MISSING_PASSWORD": return 106;
    case "INVALID_EMAIL": return 107;
    case "MISSING_EMAIL": return 108;
    default: return 404;
  }
}

// 1. 账号登录
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({ ok: false, error: 400, message: "MISSING_EMAIL_OR_PASSWORD" });
    }
    const url = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
    const payload = { email, password, returnSecureToken: true, clientType: "CLIENT_TYPE_ANDROID" };
    const headers = {
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
      "Content-Type": "application/json"
    };
    const data = await sendCPMRequest(url, payload, headers, { key: API_KEY });
    if (data?.idToken) {
      res.json({
        ok: true, error: 0, message: "SUCCESSFUL",
        authToken: data.idToken, localId: data.localId, email: data.email
      });
    } else {
      const errorMsg = data?.error?.message || "UNKNOWN_ERROR";
      const errorCode = getErrorCode(errorMsg);
      res.json({ ok: false, error: errorCode, message: errorMsg, authToken: null });
    }
  } catch (error) {
    console.error('登录接口错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 2. 获取账号信息
app.post('/api/account-info', async (req, res) => {
  try {
    const { authToken } = req.body;
    if (!authToken) {
      return res.json({ ok: false, error: 401, message: "NO_AUTH_TOKEN" });
    }
    // 步骤1: 获取玩家详细数据
    const playerDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "User-Agent": "okhttp/3.12.13",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    });
    const parsedPlayerData = playerData?.result ? JSON.parse(playerData.result) : {};
    // 步骤2: 获取基础信息
    const infoUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo";
    const infoData = await sendCPMRequest(infoUrl, { idToken: authToken }, {
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
      "Content-Type": "application/json"
    }, { key: API_KEY });
    // 步骤3: 获取车辆数量
    const carsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const carsData = await sendCPMRequest(carsUrl, { data: null }, {
      "User-Agent": "okhttp/3.12.13",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    });
    const carsList = carsData?.result ? JSON.parse(carsData.result) : [];
    
    res.json({
      ok: true, error: 0, message: "SUCCESSFUL",
      data: {
        email: infoData?.users?.[0]?.email || "",
        localId: parsedPlayerData?.localID || infoData?.users?.[0]?.localId || "",
        nickname: parsedPlayerData?.Name || "未设置",
        gold: parsedPlayerData?.coin || 0,
        money: parsedPlayerData?.money || 0,
        carCount: carsList.length,
        allData: parsedPlayerData
      }
    });
  } catch (error) {
    console.error('获取账号信息错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 3. 修改LocalID（适配PHP的车辆数据更新逻辑）
app.post('/api/modify-localid', async (req, res) => {
  try {
    const { authToken, customLocalId } = req.body;
    if (!authToken || !customLocalId) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    // 步骤1: 获取当前账号数据
    const playerDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "User-Agent": "okhttp/3.12.13",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    });
    const parsedPlayerData = playerData?.result ? JSON.parse(playerData.result) : {};
    if (!parsedPlayerData?.localID) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    const oldLocalId = parsedPlayerData.localID;
    console.log(`修改LocalID：旧ID=${oldLocalId} → 新ID=${customLocalId}`);
    // 步骤2: 更新LocalID + 清理字段（与PHP一致，保留allData）
    parsedPlayerData.localID = customLocalId;
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    // 步骤3: 保存账号数据（关键：传字符串格式，与PHP一致）
    const updateUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const updateRes = await sendCPMRequest(updateUrl, { 
      data: JSON.stringify(parsedPlayerData) // 直接传字符串
    }, {
      "User-Agent": "okhttp/3.12.13",
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    });
    if (updateRes?.result !== '{"result":1}') {
      console.error('保存账号数据失败:', updateRes);
      return res.json({ ok: false, error: 500, message: "SAVE_ACCOUNT_DATA_FAILED" });
    }
    // 步骤4: 更新车辆数据（关键：添加firebase-instance-id-token和动态User-Agent）
    const carsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const carsData = await sendCPMRequest(carsUrl, { data: null }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    const carsList = carsData?.result ? JSON.parse(carsData.result) : [];
    let carsUpdatedCount = 0;
    if (carsList.length > 0) {
      const saveCarsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SaveCars";
      for (const car of carsList) {
        const carCopy = JSON.parse(JSON.stringify(car));
        // 全局替换旧LocalID（与PHP的str_replace一致）
        const carStr = JSON.stringify(carCopy);
        const newCarStr = carStr.replace(new RegExp(oldLocalId, 'g'), customLocalId);
        const updatedCar = JSON.parse(newCarStr);
        // 清理车辆字段
        delete updatedCar._id;
        delete updatedCar.createdAt;
        delete updatedCar.updatedAt;
        delete updatedCar.__v;
        // 关键修复：添加PHP要求的请求头
        const carSaveRes = await sendCPMRequest(saveCarsUrl, { data: JSON.stringify(updatedCar) }, {
          "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
          "Authorization": `Bearer ${authToken}`,
          "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN, // 必需
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": generateCarUserAgent() // 动态生成
        });
        if (carSaveRes?.result === '{"result":1}') carsUpdatedCount++;
      }
    }
    res.json({
      ok: true, error: 0, message: "SUCCESSFUL",
      oldLocalId, newLocalId: customLocalId,
      carsUpdated: carsUpdatedCount
    });
  } catch (error) {
    console.error('修改LocalID错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 4. 克隆账号（适配PHP的随机LocalID和数据清理逻辑）
app.post('/api/clone-account', async (req, res) => {
  try {
    const { sourceAuth, targetEmail, targetPassword } = req.body;
    if (!sourceAuth || !targetEmail || !targetPassword) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    // 步骤1: 登录目标账号
    console.log('步骤1: 登录目标账号', targetEmail);
    const targetLoginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
    const targetLoginRes = await sendCPMRequest(targetLoginUrl, {
      email: targetEmail, password: targetPassword,
      returnSecureToken: true, clientType: "CLIENT_TYPE_ANDROID"
    }, {
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-A025F Build/SP1A.210812.016)",
      "Content-Type": "application/json"
    }, { key: API_KEY });
    if (!targetLoginRes?.idToken) {
      const errorMsg = targetLoginRes?.error?.message || "TARGET_LOGIN_FAILED";
      return res.json({ ok: false, error: getErrorCode(errorMsg), message: errorMsg });
    }
    const targetAuth = targetLoginRes.idToken;
    // 关键修复：生成PHP同款随机10位大写LocalID
    const targetLocalId = strtoupper(substr(str_shuffle(md5(microtime())), 0, 10));
    // 步骤2: 获取源账号数据
    console.log('步骤2: 获取源账号数据');
    const sourceDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const sourceDataRes = await sendCPMRequest(sourceDataUrl, { data: null }, {
      "Authorization": `Bearer ${sourceAuth}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    const sourceData = sourceDataRes?.result ? JSON.parse(sourceDataRes.result) : {};
    if (!sourceData?.localID) {
      return res.json({ ok: false, error: 404, message: "GET_SOURCE_DATA_FAILED" });
    }
    const sourceLocalId = sourceData.localID;
    // 步骤3: 准备目标账号数据（与PHP一致：unset allData + 设Name为TELMunn）
    console.log(`步骤3: 替换LocalID ${sourceLocalId} → ${targetLocalId}`);
    const targetData = { ...sourceData };
    targetData.localID = targetLocalId;
    targetData.Name = "TELMunn"; // PHP强制设置
    delete targetData._id;
    delete targetData.id;
    delete targetData.createdAt;
    delete targetData.updatedAt;
    delete targetData.__v;
    delete targetData.allData; // PHP必需删除
    if (sourceData.platesData) targetData.platesData = sourceData.platesData;
    // 步骤4: 保存目标账号数据（传字符串格式）
    console.log('步骤4: 保存目标账号数据');
    const saveTargetDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const saveTargetRes = await sendCPMRequest(saveTargetDataUrl, { 
      data: JSON.stringify(targetData) // 与PHP一致
    }, {
      "Authorization": `Bearer ${targetAuth}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    if (saveTargetRes?.result !== '{"result":1}') {
      console.error('保存目标账号数据失败:', saveTargetRes);
      return res.json({ ok: false, error: 500, message: "SAVE_TARGET_DATA_FAILED" });
    }
    // 步骤5: 克隆车辆数据（添加PHP要求的请求头）
    console.log('步骤5: 克隆车辆数据');
    const sourceCarsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const sourceCarsRes = await sendCPMRequest(sourceCarsUrl, { data: null }, {
      "Authorization": `Bearer ${sourceAuth}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    const sourceCars = sourceCarsRes?.result ? JSON.parse(sourceCarsRes.result) : [];
    let carsClonedCount = 0;
    if (sourceCars.length > 0) {
      const saveCarsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SaveCars";
      for (const car of sourceCars) {
        const carCopy = JSON.parse(JSON.stringify(car));
        // 替换源LocalID为目标LocalID
        const carStr = JSON.stringify(carCopy);
        const newCarStr = carStr.replace(new RegExp(sourceLocalId, 'g'), targetLocalId);
        const updatedCar = JSON.parse(newCarStr);
        // 清理车辆字段
        delete updatedCar._id;
        delete updatedCar.createdAt;
        delete updatedCar.updatedAt;
        delete updatedCar.__v;
        // 关键修复：添加PHP要求的请求头
        const carSaveRes = await sendCPMRequest(saveCarsUrl, { data: JSON.stringify(updatedCar) }, {
          "Host": "us-central1-cp-multiplayer.cloudfunctions.net",
          "Authorization": `Bearer ${targetAuth}`,
          "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN, // 必需
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": generateCarUserAgent() // 动态生成
        });
        if (carSaveRes?.result === '{"result":1}') carsClonedCount++;
      }
    }
    res.json({
      ok: true, error: 0, message: "SUCCESSFUL",
      targetEmail, targetLocalId, carsCloned: carsClonedCount
    });
  } catch (error) {
    console.error('克隆账号错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 5. 修改金币（与PHP的account_set_data格式一致）
app.post('/api/modify-gold', async (req, res) => {
  try {
    const { authToken, goldAmount } = req.body;
    if (!authToken || goldAmount === undefined) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    const gold = Number(goldAmount);
    if (isNaN(gold)) {
      return res.json({ ok: false, error: 400, message: "INVALID_GOLD_AMOUNT" });
    }
    // 步骤1: 获取当前账号数据
    const playerDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    const parsedPlayerData = playerData?.result ? JSON.parse(playerData.result) : {};
    if (!parsedPlayerData) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    // 步骤2: 修改金币字段
    parsedPlayerData.coin = gold;
    // 清理字段
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    // 步骤3: 保存数据（关键：传字符串格式）
    const updateUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const updateRes = await sendCPMRequest(updateUrl, { 
      data: JSON.stringify(parsedPlayerData) // 与PHP的account_set_data一致
    }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    if (updateRes?.result === '{"result":1}') {
      res.json({ 
        ok: true, error: 0, message: "SUCCESSFUL",
        goldAmount: gold,
        data: { coin: gold }
      });
    } else {
      console.error('修改金币保存失败:', updateRes);
      res.json({ ok: false, error: 500, message: "SAVE_GOLD_FAILED" });
    }
  } catch (error) {
    console.error('修改金币错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 6. 修改绿钞（与PHP的account_set_data格式一致）
app.post('/api/modify-money', async (req, res) => {
  try {
    const { authToken, moneyAmount } = req.body;
    if (!authToken || moneyAmount === undefined) {
      return res.json({ ok: false, error: 400, message: "MISSING_PARAMS" });
    }
    const money = Number(moneyAmount);
    if (isNaN(money)) {
      return res.json({ ok: false, error: 400, message: "INVALID_MONEY_AMOUNT" });
    }
    // 步骤1: 获取当前账号数据
    const playerDataUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const playerData = await sendCPMRequest(playerDataUrl, { data: null }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    const parsedPlayerData = playerData?.result ? JSON.parse(playerData.result) : {};
    if (!parsedPlayerData) {
      return res.json({ ok: false, error: 404, message: "GET_ACCOUNT_DATA_FAILED" });
    }
    // 步骤2: 修改绿钞字段
    parsedPlayerData.money = money;
    // 清理字段
    delete parsedPlayerData._id;
    delete parsedPlayerData.id;
    delete parsedPlayerData.createdAt;
    delete parsedPlayerData.updatedAt;
    delete parsedPlayerData.__v;
    // 步骤3: 保存数据（关键：传字符串格式）
    const updateUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const updateRes = await sendCPMRequest(updateUrl, { 
      data: JSON.stringify(parsedPlayerData) // 与PHP的account_set_data一致
    }, {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/3.12.13"
    });
    if (updateRes?.result === '{"result":1}') {
      res.json({ 
        ok: true, error: 0, message: "SUCCESSFUL",
        moneyAmount: money,
        data: { money: money }
      });
    } else {
      console.error('修改绿钞保存失败:', updateRes);
      res.json({ ok: false, error: 500, message: "SAVE_MONEY_FAILED" });
    }
  } catch (error) {
    console.error('修改绿钞错误:', error);
    res.json({ ok: false, error: 500, message: `SERVER_ERROR: ${error.message}` });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    apiKeyConfigured: !!API_KEY
  });
});

// 404处理
app.use((req, res) => {
  console.log(`404 请求: ${req.method} ${req.path}`);
  res.status(404).json({ ok: false, error: 404, message: "API_NOT_FOUND" });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('全局错误:', err.stack);
  res.status(500).json({ ok: false, error: 500, message: `INTERNAL_SERVER_ERROR: ${err.message}` });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`🚀 服务启动成功！端口: ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`🔑 API Key 配置: ${API_KEY ? '已配置' : '未配置'}`);
});
