const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 修复URL处理函数
function normalizeUrl(url) {
  try {
    // 如果URL没有协议，添加https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // 创建URL对象进行标准化
    const urlObj = new URL(url);
    
    // 确保hostname有效
    if (!urlObj.hostname || urlObj.hostname === '') {
      throw new Error('无效的主机名');
    }
    
    return urlObj.toString();
  } catch (error) {
    throw new Error(`URL格式错误: ${error.message}`);
  }
}

// 通用文件获取API（修复版）
app.get('/api/fetch-source', async (req, res) => {
  try {
    let { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        error: 'URL参数是必需的',
        example: '/api/fetch-source?url=https://example.com'
      });
    }
    
    // 标准化URL
    url = normalizeUrl(url);
    console.log(`正在获取: ${url}`);
    
    // 验证URL格式
    const urlPattern = /^https?:\/\/[^\s$.?#].[^\s]*$/i;
    if (!urlPattern.test(url)) {
      return res.status(400).json({ 
        error: 'URL格式无效',
        received: url,
        expected: 'http://example.com 或 https://example.com'
      });
    }
    
    // 设置超时和重试
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      },
      // 处理重定向
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
    
    // 解析HTML获取资源
    let resources = { scripts: [], stylesheets: [], images: [] };
    try {
      const $ = cheerio.load(response.data);
      
      // 获取脚本
      $('script[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          try {
            const scriptUrl = new URL(src, url).href;
            resources.scripts.push({
              src: scriptUrl,
              type: $(el).attr('type') || 'text/javascript'
            });
          } catch (e) {
            // 忽略无效的URL
          }
        }
      });
      
      // 获取样式表
      $('link[rel="stylesheet"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            const styleUrl = new URL(href, url).href;
            resources.stylesheets.push({
              href: styleUrl,
              type: 'text/css'
            });
          } catch (e) {
            // 忽略无效的URL
          }
        }
      });
      
      // 获取图片
      $('img[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:')) {
          try {
            const imgUrl = new URL(src, url).href;
            resources.images.push({
              src: imgUrl,
              alt: $(el).attr('alt') || ''
            });
          } catch (e) {
            // 忽略无效的URL
          }
        }
      });
      
    } catch (parseError) {
      console.log('解析HTML时出错:', parseError.message);
    }
    
    // 成功响应
    res.json({
      success: true,
      url: url,
      statusCode: response.status,
      contentType: response.headers['content-type'] || 'text/html',
      contentLength: response.data.length,
      html: response.data,
      resources: resources,
      headers: response.headers,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取源码失败:', error.message);
    
    let errorMessage = '获取网站源码失败';
    let errorDetails = {
      message: error.message,
      code: error.code
    };
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        errorMessage = '连接被拒绝，网站可能未运行或端口错误';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = '无法解析域名，请检查URL是否正确';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = '连接超时，网站响应太慢或不可达';
      } else if (error.response) {
        errorMessage = `HTTP错误 ${error.response.status}: ${error.response.statusText}`;
        errorDetails.status = error.response.status;
        errorDetails.headers = error.response.headers;
      } else if (error.request) {
        errorMessage = '没有收到响应，可能是网络问题或网站屏蔽';
      }
    }
    
    res.status(500).json({
      error: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString()
    });
  }
});

// 简单测试端点
app.get('/api/test', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/fetch-source?url=YOUR_URL',
      '/api/test',
      '/api/health'
    ]
  });
});

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 文件资源获取API（修复版）
app.get('/api/get-resource', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }
    
    const normalizedUrl = normalizeUrl(url);
    
    const response = await axios.get(normalizedUrl, {
      timeout: 10000,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': req.headers.referer || ''
      }
    });
    
    // 设置内容类型
    const contentType = response.headers['content-type'];
    if (contentType) {
      res.set('Content-Type', contentType);
    }
    
    // 设置缓存头
    res.set('Cache-Control', 'public, max-age=300');
    
    // 发送数据
    res.send(response.data);
    
  } catch (error) {
    console.error('获取资源失败:', error.message);
    res.status(500).json({
      error: '获取资源失败',
      details: error.message
    });
  }
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📡 API端点:`);
  console.log(`   http://localhost:${PORT}/api/test`);
  console.log(`   http://localhost:${PORT}/api/fetch-source?url=https://example.com`);
  console.log(`🌐 前端界面: http://localhost:${PORT}`);
});
