require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// ============ PHP函数 ============
function strtoupper(str) {
  return str.toUpperCase();
}

function substr(str, start, length) {
  return str.substr(start, length);
}

function str_shuffle(str) {
  return str.split('').sort(() => 0.5 - Math.random()).join('');
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function microtime() {
  const [seconds, microseconds] = process.hrtime();
  return seconds + microseconds / 1e6;
}

// 环境变量
const API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_INSTANCE_ID_TOKEN = process.env.FIREBASE_INSTANCE_ID_TOKEN;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 请求函数
const sendRequest = async (url, data, headers, params = {}) => {
  try {
    console.log(`发送请求到: ${url}`);
    
    // 构建完整URL
    let fullUrl = url;
    if (Object.keys(params).length > 0) {
      fullUrl += '?' + new URLSearchParams(params).toString();
    }
    
    // 对于SavePlayerRecordsIOS，直接传字符串
    let requestData = data;
    if (url.includes('SavePlayerRecordsIOS') && data.data) {
      requestData = data.data;
    }
    
    const response = await axios({
      method: 'POST',
      url: fullUrl,
      data: requestData,
      headers: headers,
      timeout: 60000
    });
    
    return response.data;
  } catch (error) {
    console.error(`请求失败: ${error.message}`);
    return null;
  }
};

// ============ API 路由 ============

// 1. 登录
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const url = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
    const data = {
      email: email,
      password: password,
      returnSecureToken: true,
      clientType: "CLIENT_TYPE_ANDROID"
    };
    
    const headers = {
      "Content-Type": "application/json"
    };
    
    const result = await sendRequest(url, data, headers, { key: API_KEY });
    
    if (result && result.idToken) {
      res.json({
        ok: true,
        authToken: result.idToken,
        localId: result.localId,
        email: result.email
      });
    } else {
      res.json({
        ok: false,
        message: result?.error?.message || "登录失败"
      });
    }
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 2. 获取账号信息 - 完全修复版
app.post('/api/account-info', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    if (!authToken) {
      return res.json({ ok: false, message: "缺少token" });
    }
    
    // 1. 获取玩家数据
    const playerUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const playerHeaders = {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    };
    
    const playerResult = await sendRequest(playerUrl, { data: null }, playerHeaders);
    
    if (!playerResult || !playerResult.result) {
      return res.json({ ok: false, message: "获取玩家数据失败" });
    }
    
    const playerData = JSON.parse(playerResult.result);
    
    // 2. 获取账号信息
    const infoUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo";
    const infoData = await sendRequest(infoUrl, { idToken: authToken }, {}, { key: API_KEY });
    
    // 3. 获取车辆
    const carsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const carsResult = await sendRequest(carsUrl, { data: null }, playerHeaders);
    const cars = carsResult?.result ? JSON.parse(carsResult.result) : [];
    
    res.json({
      ok: true,
      data: {
        email: infoData?.users?.[0]?.email || "",
        localId: playerData?.localID || "",
        nickname: playerData?.Name || "未设置",
        gold: playerData?.coin || 0,
        money: playerData?.money || 0,
        carCount: cars.length
      }
    });
    
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 3. 修改LocalID - 完全修复版
app.post('/api/modify-localid', async (req, res) => {
  try {
    const { authToken, customLocalId } = req.body;
    
    if (!authToken || !customLocalId) {
      return res.json({ ok: false, message: "缺少参数" });
    }
    
    // 1. 获取当前数据
    const playerUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const headers = {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    };
    
    const playerResult = await sendRequest(playerUrl, { data: null }, headers);
    
    if (!playerResult || !playerResult.result) {
      return res.json({ ok: false, message: "获取数据失败" });
    }
    
    const playerData = JSON.parse(playerResult.result);
    const oldLocalId = playerData.localID;
    
    // 2. 更新localID
    playerData.localID = customLocalId;
    
    // 清理字段
    delete playerData._id;
    delete playerData.id;
    delete playerData.createdAt;
    delete playerData.updatedAt;
    delete playerData.__v;
    
    // 3. 保存数据
    const saveUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const saveResult = await sendRequest(saveUrl, { data: JSON.stringify(playerData) }, headers);
    
    if (!saveResult || saveResult.result !== '{"result":1}') {
      return res.json({ ok: false, message: "保存失败" });
    }
    
    // 4. 更新车辆
    const carsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const carsResult = await sendRequest(carsUrl, { data: null }, headers);
    const cars = carsResult?.result ? JSON.parse(carsResult.result) : [];
    
    let updatedCars = 0;
    for (const car of cars) {
      // 替换localID
      const carStr = JSON.stringify(car);
      const newCarStr = carStr.replace(new RegExp(oldLocalId, 'g'), customLocalId);
      const newCar = JSON.parse(newCarStr);
      
      delete newCar._id;
      delete newCar.createdAt;
      delete newCar.updatedAt;
      delete newCar.__v;
      
      // 保存车辆
      const saveCarUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SaveCars";
      const saveCarResult = await sendRequest(saveCarUrl, { data: JSON.stringify(newCar) }, {
        "Authorization": `Bearer ${authToken}`,
        "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
        "Content-Type": "application/json"
      });
      
      if (saveCarResult?.result === '{"result":1}') {
        updatedCars++;
      }
    }
    
    res.json({
      ok: true,
      newLocalId: customLocalId,
      carsUpdated: updatedCars,
      message: "修改成功"
    });
    
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 4. 修改金币 - 完全修复版
app.post('/api/modify-gold', async (req, res) => {
  try {
    const { authToken, goldAmount } = req.body;
    
    if (!authToken || goldAmount === undefined) {
      return res.json({ ok: false, message: "缺少参数" });
    }
    
    const gold = parseInt(goldAmount);
    if (isNaN(gold)) {
      return res.json({ ok: false, message: "金币必须是数字" });
    }
    
    // 1. 获取数据
    const playerUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const headers = {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    };
    
    const playerResult = await sendRequest(playerUrl, { data: null }, headers);
    
    if (!playerResult || !playerResult.result) {
      return res.json({ ok: false, message: "获取数据失败" });
    }
    
    const playerData = JSON.parse(playerResult.result);
    
    // 2. 修改金币
    playerData.coin = gold;
    
    // 清理字段
    delete playerData._id;
    delete playerData.id;
    delete playerData.createdAt;
    delete playerData.updatedAt;
    delete playerData.__v;
    
    // 3. 保存
    const saveUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const saveResult = await sendRequest(saveUrl, { data: JSON.stringify(playerData) }, headers);
    
    if (!saveResult || saveResult.result !== '{"result":1}') {
      return res.json({ ok: false, message: "保存失败" });
    }
    
    res.json({
      ok: true,
      goldAmount: gold,
      message: "金币修改成功"
    });
    
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 5. 修改绿钞 - 完全修复版
app.post('/api/modify-money', async (req, res) => {
  try {
    const { authToken, moneyAmount } = req.body;
    
    if (!authToken || moneyAmount === undefined) {
      return res.json({ ok: false, message: "缺少参数" });
    }
    
    const money = parseInt(moneyAmount);
    if (isNaN(money)) {
      return res.json({ ok: false, message: "绿钞必须是数字" });
    }
    
    // 1. 获取数据
    const playerUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const headers = {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json"
    };
    
    const playerResult = await sendRequest(playerUrl, { data: null }, headers);
    
    if (!playerResult || !playerResult.result) {
      return res.json({ ok: false, message: "获取数据失败" });
    }
    
    const playerData = JSON.parse(playerResult.result);
    
    // 2. 修改绿钞
    playerData.money = money;
    
    // 清理字段
    delete playerData._id;
    delete playerData.id;
    delete playerData.createdAt;
    delete playerData.updatedAt;
    delete playerData.__v;
    
    // 3. 保存
    const saveUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const saveResult = await sendRequest(saveUrl, { data: JSON.stringify(playerData) }, headers);
    
    if (!saveResult || saveResult.result !== '{"result":1}') {
      return res.json({ ok: false, message: "保存失败" });
    }
    
    res.json({
      ok: true,
      moneyAmount: money,
      message: "绿钞修改成功"
    });
    
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 6. 克隆账号 - 完全修复版
app.post('/api/clone-account', async (req, res) => {
  try {
    const { sourceAuth, targetEmail, targetPassword } = req.body;
    
    if (!sourceAuth || !targetEmail || !targetPassword) {
      return res.json({ ok: false, message: "缺少参数" });
    }
    
    // 1. 登录目标账号
    const loginUrl = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword";
    const loginData = {
      email: targetEmail,
      password: targetPassword,
      returnSecureToken: true,
      clientType: "CLIENT_TYPE_ANDROID"
    };
    
    const loginResult = await sendRequest(loginUrl, loginData, {}, { key: API_KEY });
    
    if (!loginResult || !loginResult.idToken) {
      return res.json({ ok: false, message: "目标账号登录失败" });
    }
    
    const targetAuth = loginResult.idToken;
    
    // 2. 获取源账号数据
    const sourceUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2";
    const sourceHeaders = {
      "Authorization": `Bearer ${sourceAuth}`,
      "Content-Type": "application/json"
    };
    
    const sourceResult = await sendRequest(sourceUrl, { data: null }, sourceHeaders);
    
    if (!sourceResult || !sourceResult.result) {
      return res.json({ ok: false, message: "获取源数据失败" });
    }
    
    const sourceData = JSON.parse(sourceResult.result);
    const sourceLocalId = sourceData.localID;
    
    // 3. 生成目标LocalID
    const targetLocalId = strtoupper(substr(str_shuffle(md5(microtime().toString())), 0, 10));
    
    // 4. 准备目标数据
    const targetData = { ...sourceData };
    targetData.localID = targetLocalId;
    targetData.Name = "TELMunn";
    
    // 清理字段
    delete targetData._id;
    delete targetData.id;
    delete targetData.createdAt;
    delete targetData.updatedAt;
    delete targetData.__v;
    delete targetData.allData;
    
    if (sourceData.platesData) {
      targetData.platesData = sourceData.platesData;
    }
    
    // 5. 保存目标数据
    const saveUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerRecordsIOS";
    const targetHeaders = {
      "Authorization": `Bearer ${targetAuth}`,
      "Content-Type": "application/json"
    };
    
    const saveResult = await sendRequest(saveUrl, { data: JSON.stringify(targetData) }, targetHeaders);
    
    if (!saveResult || saveResult.result !== '{"result":1}') {
      return res.json({ ok: false, message: "保存目标数据失败" });
    }
    
    // 6. 克隆车辆
    const carsUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/TestGetAllCars";
    const carsResult = await sendRequest(carsUrl, { data: null }, sourceHeaders);
    const cars = carsResult?.result ? JSON.parse(carsResult.result) : [];
    
    let clonedCars = 0;
    for (const car of cars) {
      const carStr = JSON.stringify(car);
      const newCarStr = carStr.replace(new RegExp(sourceLocalId, 'g'), targetLocalId);
      const newCar = JSON.parse(newCarStr);
      
      delete newCar._id;
      delete newCar.createdAt;
      delete newCar.updatedAt;
      delete newCar.__v;
      
      const saveCarUrl = "https://us-central1-cp-multiplayer.cloudfunctions.net/SaveCars";
      const saveCarResult = await sendRequest(saveCarUrl, { data: JSON.stringify(newCar) }, {
        "Authorization": `Bearer ${targetAuth}`,
        "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
        "Content-Type": "application/json"
      });
      
      if (saveCarResult?.result === '{"result":1}') {
        clonedCars++;
      }
    }
    
    res.json({
      ok: true,
      targetEmail: targetEmail,
      carsCloned: clonedCars,
      message: "克隆成功"
    });
    
  } catch (error) {
    console.error(error);
    res.json({ ok: false, message: "服务器错误" });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
  console.log(`📋 可用API:`);
  console.log(`   POST /api/login`);
  console.log(`   POST /api/account-info`);
  console.log(`   POST /api/modify-localid`);
  console.log(`   POST /api/modify-gold`);
  console.log(`   POST /api/modify-money`);
  console.log(`   POST /api/clone-account`);
});
