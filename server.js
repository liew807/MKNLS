import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import NodeCache from 'node-cache';

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 600 }); // 10分鐘緩存

// 中間件配置
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://c0.wp.com", "https://cpmlstw.com", "https://fonts.gstatic.com", "https://stats.wp.com", "https://MKNLS.onrender.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://c0.wp.com", "https://MKNLS.onrender.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://MKNLS.onrender.com"],
      connectSrc: ["'self'", "https://cpmlstw.com", "https://MKNLS.onrender.com"],
      frameSrc: ["'self'", "https://www.youtube.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
  origin: [
    'https://MKNLS.onrender.com',
    'https://cpmlstw.com',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 靜態文件服務
app.use(express.static('public'));

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'MKNLS Woocommerce API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API路由 - 產品數據
app.get('/api/products', async (req, res) => {
  try {
    const cacheKey = 'products_all';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return res.json({
        ...cached,
        cached: true
      });
    }

    // 模擬產品數據 - 實際應該從數據庫獲取
    const products = {
      hot_sales: [
        {
          id: 5491,
          name: "[230]BMW M3 E92 甘城なつき 雙面痛車塗裝",
          price: "RM20.5",
          image: "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-03_10-19-28-588.png",
          rating: 5.0,
          category: "熱銷TOP10"
        },
        {
          id: 5481,
          name: "[220]BMW 520i (M5) 台灣國道公路警察局 紅斑馬警車",
          price: "RM8.2",
          image: "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-02_22-28-57-503.png",
          category: "熱銷TOP10"
        }
      ],
      total: 10,
      timestamp: new Date().toISOString()
    };

    cache.set(cacheKey, products);
    
    res.json({
      status: 'success',
      data: products,
      cached: false
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: '獲取產品數據失敗',
      error: error.message
    });
  }
});

// 購物車API
app.post('/api/cart/add', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  
  // 驗證輸入
  if (!productId) {
    return res.status(400).json({
      status: 'error',
      message: '產品ID是必需的'
    });
  }

  // 模擬添加到購物車成功
  res.json({
    status: 'success',
    message: '產品已添加到購物車',
    data: {
      cartItem: {
        productId,
        quantity,
        addedAt: new Date().toISOString()
      },
      cartTotal: 1
    }
  });
});

// 貨幣轉換API
app.get('/api/currency/convert', (req, res) => {
  const { amount, from = 'TWD', to = 'MYR' } = req.query;
  
  // 簡單的貨幣轉換率（實際應該使用實時匯率）
  const rates = {
    TWD: { MYR: 0.136, USD: 0.032, CNY: 0.23 },
    MYR: { TWD: 7.35, USD: 0.21, CNY: 1.52 },
    USD: { TWD: 31.2, MYR: 4.76, CNY: 7.24 },
    CNY: { TWD: 4.31, MYR: 0.66, USD: 0.14 }
  };

  if (!amount || isNaN(amount)) {
    return res.status(400).json({
      status: 'error',
      message: '請提供有效的金額'
    });
  }

  const rate = rates[from]?.[to];
  if (!rate) {
    return res.status(400).json({
      status: 'error',
      message: '不支持的貨幣轉換'
    });
  }

  const convertedAmount = (parseFloat(amount) * rate).toFixed(2);

  res.json({
    status: 'success',
    data: {
      original: { amount, currency: from },
      converted: { amount: convertedAmount, currency: to },
      rate: rate,
      timestamp: new Date().toISOString()
    }
  });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error('服務器錯誤:', err);
  res.status(500).json({
    status: 'error',
    message: '內部服務器錯誤',
    requestId: req.id
  });
});

// 404處理
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: '接口不存在',
    path: req.originalUrl
  });
});

// 啟動服務器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 MKNLS 商城服務器已啟動
📍 本地地址: http://localhost:${PORT}
🌐 生產地址: https://MKNLS.onrender.com
⏰ 啟動時間: ${new Date().toLocaleString('zh-TW')}
  `);
});

export default app;
