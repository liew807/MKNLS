require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// ============ 环境变量 ============
const API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_INSTANCE_ID_TOKEN = process.env.FIREBASE_INSTANCE_ID_TOKEN || "f4ke-t0ken-f0r-t3st";

// ============ 中间件 ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ 日志中间件 ============
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    const logBody = { ...req.body };
    if (logBody.authToken) logBody.authToken = '***' + logBody.authToken.slice(-10);
    console.log('请求体:', JSON.stringify(logBody, null, 2));
  }
  next();
});

// ============ 通用请求函数 ============
async function makeGameRequest(url, data, authToken, customHeaders = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; SM-G991B Build/RP1A.200720.012)',
      ...customHeaders
    };

    console.log(`发送游戏请求到: ${url}`);
    console.log('请求数据:', JSON.stringify(data, null, 2));

    const response = await axios({
      method: 'POST',
      url: url,
      data: data,
      headers: headers,
      timeout: 10000
    });

    console.log('游戏响应:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('游戏请求失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
    return null;
  }
}

// ============ 获取玩家信息 ============
async function getPlayerInfo(authToken) {
  try {
    // 1. 获取Firebase账号信息
    const accountInfo = await axios.post(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${API_KEY}`,
      { idToken: authToken }
    );

    if (!accountInfo.data.users || accountInfo.data.users.length === 0) {
      throw new Error('获取账号信息失败');
    }

    const user = accountInfo.data.users[0];
    const playerId = user.localId;
    const email = user.email;

    // 2. 获取游戏数据 - 尝试多种可能的API
    const gameDataUrls = [
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerData',
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2',
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerInfo'
    ];

    let gameData = null;
    for (const url of gameDataUrls) {
      try {
        const result = await makeGameRequest(url, { playerId: playerId }, authToken);
        if (result && result.success !== false) {
          gameData = result;
          console.log(`从 ${url} 获取到数据`);
          break;
        }
      } catch (e) {
        console.log(`${url} 失败: ${e.message}`);
      }
    }

    // 3. 获取车辆数据
    const carsResult = await makeGameRequest(
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerCars',
      { playerId: playerId },
      authToken
    );

    return {
      playerId,
      email,
      gameData: gameData || {},
      cars: carsResult || [],
      gold: gameData?.coin || gameData?.gold || 0,
      money: gameData?.money || gameData?.cash || 0,
      nickname: gameData?.name || gameData?.nickname || '未设置'
    };
  } catch (error) {
    console.error('获取玩家信息失败:', error);
    throw error;
  }
}

// ============ API 路由 ============

// 1. 登录
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await axios.post(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${API_KEY}`,
      {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: "CLIENT_TYPE_ANDROID"
      }
    );

    if (result.data.idToken) {
      res.json({
        ok: true,
        authToken: result.data.idToken,
        localId: result.data.localId,
        email: result.data.email
      });
    } else {
      res.json({
        ok: false,
        message: '登录失败'
      });
    }
  } catch (error) {
    console.error('登录错误:', error.response?.data || error.message);
    res.json({
      ok: false,
      message: error.response?.data?.error?.message || '登录失败'
    });
  }
});

// 2. 获取账号信息
app.post('/api/account-info', async (req, res) => {
  try {
    const { authToken } = req.body;

    if (!authToken) {
      return res.json({ ok: false, message: '缺少认证令牌' });
    }

    const playerInfo = await getPlayerInfo(authToken);

    res.json({
      ok: true,
      data: {
        email: playerInfo.email,
        localId: playerInfo.playerId,
        nickname: playerInfo.nickname,
        gold: playerInfo.gold,
        money: playerInfo.money,
        carCount: playerInfo.cars.length || 0
      }
    });
  } catch (error) {
    console.error('获取账号信息错误:', error);
    res.json({
      ok: false,
      message: '获取账号信息失败: ' + error.message
    });
  }
});

// 3. 修改金币 - 猜测的正确格式
app.post('/api/modify-gold', async (req, res) => {
  try {
    const { authToken, goldAmount } = req.body;

    if (!authToken || goldAmount === undefined) {
      return res.json({ ok: false, message: '缺少参数' });
    }

    const gold = parseInt(goldAmount);
    if (isNaN(gold) || gold < 0) {
      return res.json({ ok: false, message: '无效的金币数量' });
    }

    // 先获取玩家信息
    const playerInfo = await getPlayerInfo(authToken);
    
    // 尝试多种可能的API格式
    const updateApis = [
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/UpdatePlayerCoin',
        data: {
          playerId: playerInfo.playerId,
          coin: gold,
          timestamp: Date.now()
        }
      },
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetPlayerGold',
        data: {
          uid: playerInfo.playerId,
          gold: gold
        }
      },
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerEconomy',
        data: {
          userId: playerInfo.playerId,
          coin: gold,
          money: playerInfo.money  // 保持绿钞不变
        }
      }
    ];

    let success = false;
    let lastError = '';

    for (const api of updateApis) {
      try {
        console.log(`尝试调用: ${api.url}`);
        const result = await makeGameRequest(api.url, api.data, authToken);
        
        if (result && (result.success === true || result.status === 'OK' || result.updated === true)) {
          success = true;
          console.log(`${api.url} 调用成功`);
          break;
        }
      } catch (error) {
        lastError = error.message;
        console.log(`${api.url} 失败: ${error.message}`);
      }
    }

    if (success) {
      res.json({
        ok: true,
        message: '金币修改成功',
        goldAmount: gold
      });
    } else {
      res.json({
        ok: false,
        message: '金币修改失败: ' + lastError
      });
    }
  } catch (error) {
    console.error('修改金币错误:', error);
    res.json({
      ok: false,
      message: '服务器错误: ' + error.message
    });
  }
});

// 4. 修改绿钞 - 猜测的正确格式
app.post('/api/modify-money', async (req, res) => {
  try {
    const { authToken, moneyAmount } = req.body;

    if (!authToken || moneyAmount === undefined) {
      return res.json({ ok: false, message: '缺少参数' });
    }

    const money = parseInt(moneyAmount);
    if (isNaN(money) || money < 0) {
      return res.json({ ok: false, message: '无效的绿钞数量' });
    }

    // 先获取玩家信息
    const playerInfo = await getPlayerInfo(authToken);
    
    // 尝试多种可能的API格式
    const updateApis = [
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/UpdatePlayerMoney',
        data: {
          playerId: playerInfo.playerId,
          money: money,
          timestamp: Date.now()
        }
      },
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetPlayerCash',
        data: {
          uid: playerInfo.playerId,
          cash: money
        }
      },
      {
        url: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SavePlayerEconomy',
        data: {
          userId: playerInfo.playerId,
          coin: playerInfo.gold,  // 保持金币不变
          money: money
        }
      }
    ];

    let success = false;
    let lastError = '';

    for (const api of updateApis) {
      try {
        console.log(`尝试调用: ${api.url}`);
        const result = await makeGameRequest(api.url, api.data, authToken);
        
        if (result && (result.success === true || result.status === 'OK' || result.updated === true)) {
          success = true;
          console.log(`${api.url} 调用成功`);
          break;
        }
      } catch (error) {
        lastError = error.message;
        console.log(`${api.url} 失败: ${error.message}`);
      }
    }

    if (success) {
      res.json({
        ok: true,
        message: '绿钞修改成功',
        moneyAmount: money
      });
    } else {
      res.json({
        ok: false,
        message: '绿钞修改失败: ' + lastError
      });
    }
  } catch (error) {
    console.error('修改绿钞错误:', error);
    res.json({
      ok: false,
      message: '服务器错误: ' + error.message
    });
  }
});

// 5. 修改LocalID
app.post('/api/modify-localid', async (req, res) => {
  try {
    const { authToken, customLocalId } = req.body;

    if (!authToken || !customLocalId) {
      return res.json({ ok: false, message: '缺少参数' });
    }

    // 获取玩家信息
    const playerInfo = await getPlayerInfo(authToken);
    
    // 更新玩家ID
    const updateResult = await makeGameRequest(
      'https://us-central1-cp-multiplayer.cloudfunctions.net/UpdatePlayerId',
      {
        oldPlayerId: playerInfo.playerId,
        newPlayerId: customLocalId,
        email: playerInfo.email
      },
      authToken
    );

    if (updateResult && updateResult.success) {
      res.json({
        ok: true,
        message: 'LocalID修改成功',
        newLocalId: customLocalId
      });
    } else {
      res.json({
        ok: false,
        message: 'LocalID修改失败'
      });
    }
  } catch (error) {
    console.error('修改LocalID错误:', error);
    res.json({
      ok: false,
      message: '服务器错误: ' + error.message
    });
  }
});

// 6. 克隆账号（简化版）
app.post('/api/clone-account', async (req, res) => {
  try {
    const { sourceAuth, targetEmail, targetPassword } = req.body;

    if (!sourceAuth || !targetEmail || !targetPassword) {
      return res.json({ ok: false, message: '缺少参数' });
    }

    res.json({
      ok: false,
      message: '克隆功能暂时不可用，需要游戏API支持'
    });
  } catch (error) {
    console.error('克隆账号错误:', error);
    res.json({
      ok: false,
      message: '服务器错误: ' + error.message
    });
  }
});

// ============ 测试路由 ============
app.post('/api/test', async (req, res) => {
  try {
    const { authToken } = req.body;
    
    if (!authToken) {
      return res.json({ ok: false, message: '需要认证令牌' });
    }

    // 测试各个游戏API
    const testUrls = [
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerData',
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerRecords2',
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerInfo',
      'https://us-central1-cp-multiplayer.cloudfunctions.net/GetPlayerCars'
    ];

    const results = [];
    for (const url of testUrls) {
      try {
        const result = await makeGameRequest(url, { test: true }, authToken);
        results.push({
          url: url,
          success: !!result,
          data: result
        });
      } catch (error) {
        results.push({
          url: url,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      ok: true,
      message: '测试完成',
      results: results
    });
  } catch (error) {
    res.json({
      ok: false,
      message: '测试失败: ' + error.message
    });
  }
});

// ============ 健康检查 ============
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    apiKey: API_KEY ? '已配置' : '未配置'
  });
});

// ============ 启动服务器 ============
app.listen(PORT, () => {
  console.log(`
🚀 服务器已启动!
📡 端口: ${PORT}
🌐 地址: http://localhost:${PORT}
🔑 API Key: ${API_KEY ? '已配置' : '警告：未配置！'}

📋 可用API:
   POST /api/login
   POST /api/account-info
   POST /api/modify-gold
   POST /api/modify-money
   POST /api/modify-localid
   POST /api/test (测试用)
  `);
});
