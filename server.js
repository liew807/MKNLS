import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import NodeCache from 'node-cache';
import path from 'path';
import { fileURLToPath } from 'url';

// ES6 模块的 __dirname 等效实现
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 600 }); // 10分鐘緩存

// 中間件配置
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
  origin: [
    'https://mknls.onrender.com',
    'https://cpmlstw.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 根路由 - 返回 HTML 页面（假设 index.html 在根目录）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API 信息路由
app.get('/api', (req, res) => {
  res.json({
    message: 'MKNLS Woocommerce API 服務運行中',
    service: '多人停車塗裝商城',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      products: '/api/products',
      cart: '/api/cart/add',
      currency: '/api/currency/convert'
    }
  });
});

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'MKNLS Woocommerce API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// API路由 - 產品數據
app.get('/api/products', async (req, res) => {
  try {
    const cacheKey = 'products_all';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return res.json({
        status: 'success',
        ...cached,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }

    // 模擬產品數據
    const products = {
      hot_sales: [
        {
          id: 5491,
          name: "[230]BMW M3 E92 甘城なつき 雙面痛車塗裝",
          price: "RM20.5",
          original_price: "RM25.0",
          discount: "18%",
          image: "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-03_10-19-28-588.png",
          rating: 5.0,
          reviews: 128,
          category: "熱銷TOP10",
          tags: ["BMW", "痛車", "動漫"]
        },
        {
          id: 5481,
          name: "[220]BMW 520i (M5) 台灣國道公路警察局 紅斑馬警車",
          price: "RM8.2",
          original_price: "RM10.0",
          discount: "18%",
          image: "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-02_22-28-57-503.png",
          rating: 4.8,
          reviews: 95,
          category: "熱銷TOP10",
          tags: ["BMW", "警車", "台灣"]
        },
        {
          id: 5475,
          name: "[218]BMW M3 E92 初音未來 賽車塗裝",
          price: "RM15.0",
          image: "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-02_22-22-44-636.png",
          rating: 4.9,
          reviews: 87,
          category: "熱銷TOP10",
          tags: ["BMW", "初音未來", "賽車"]
        }
      ],
      new_arrivals: [
        {
          id: 5501,
          name: "[235]Porsche 911 GT3 原神主題塗裝",
          price: "RM25.0",
          image: "https://via.placeholder.com/300x200/4A90E2/FFFFFF?text=Porsche+911+GT3",
          rating: 4.7,
          category: "新上市",
          is_new: true
        }
      ],
      total: 15,
      timestamp: new Date().toISOString()
    };

    cache.set(cacheKey, products);
    
    res.json({
      status: 'success',
      data: products,
      cached: false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('獲取產品數據錯誤:', error);
    res.status(500).json({
      status: 'error',
      message: '獲取產品數據失敗',
      error: error.message
    });
  }
});

// 單個產品詳情
app.get('/api/products/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const cacheKey = `product_${productId}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return res.json({
        status: 'success',
        data: cached,
        cached: true
      });
    }

    // 模擬產品詳情數據
    const productDetails = {
      id: productId,
      name: `產品 ${productId} 詳細資訊`,
      description: "這是產品的詳細描述，包含所有相關資訊和規格說明。",
      price: "RM20.5",
      images: [
        "https://i0.wp.com/cpmlstw.com/wp-content/uploads/2024/07/Picsart_24-07-03_10-19-28-588.png",
        "https://via.placeholder.com/400x300/4A90E2/FFFFFF?text=產品圖2",
        "https://via.placeholder.com/400x300/50E3C2/FFFFFF?text=產品圖3"
      ],
      specifications: {
        compatible_models: ["BMW M3 E92", "BMW M4"],
        file_format: "PNG",
        resolution: "4096x4096",
        file_size: "15.2 MB"
      },
      features: ["高清質量", "易於安裝", "多平台兼容"],
      created_at: "2024-07-01",
      updated_at: new Date().toISOString()
    };

    cache.set(cacheKey, productDetails);
    
    res.json({
      status: 'success',
      data: productDetails,
      cached: false
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: '獲取產品詳情失敗',
      error: error.message
    });
  }
});

// 購物車API
app.post('/api/cart/add', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  
  if (!productId) {
    return res.status(400).json({
      status: 'error',
      message: '產品ID是必需的'
    });
  }

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

// 獲取購物車
app.get('/api/cart', (req, res) => {
  res.json({
    status: 'success',
    data: {
      items: [],
      total: 0,
      itemCount: 0
    }
  });
});

// 貨幣轉換API
app.get('/api/currency/convert', (req, res) => {
  const { amount, from = 'TWD', to = 'MYR' } = req.query;
  
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
      original: { amount: parseFloat(amount), currency: from },
      converted: { amount: parseFloat(convertedAmount), currency: to },
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
    timestamp: new Date().toISOString()
  });
});

// 404處理
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: '接口不存在',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// 啟動服務器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 MKNLS 商城服務器已啟動
📍 端口: ${PORT}
🌐 環境: ${process.env.NODE_ENV || 'development'}
📁 目錄: ${__dirname}
⏰ 啟動時間: ${new Date().toLocaleString('zh-TW')}
🔗 本地訪問: http://localhost:${PORT}
🔗 API信息: http://localhost:${PORT}/api
  `);
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

export default app;
