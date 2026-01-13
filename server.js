const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// 允许跨域
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 获取网站源码
app.get('/api/fetch-source', async (req, res) => {
  try {
    const { url, format = true } = req.query;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'URL参数是必需的',
        example: '?url=https://example.com'
      });
    }

    // 验证URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ 
        error: 'URL必须以http://或https://开头'
      });
    }

    console.log(`正在获取: ${url}`);

    // 获取网站内容
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      },
      timeout: 15000,
      responseType: 'text',
      maxRedirects: 5
    });

    // 获取响应头信息
    const headers = response.headers;
    
    // 获取资源信息
    let resources = [];
    let scripts = [];
    let stylesheets = [];
    let images = [];
    
    try {
      const $ = cheerio.load(response.data);
      
      // 提取脚本
      $('script[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          scripts.push({
            src: src.startsWith('http') ? src : new URL(src, url).href,
            type: $(el).attr('type') || 'text/javascript'
          });
        }
      });
      
      // 提取样式表
      $('link[rel="stylesheet"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          stylesheets.push({
            href: href.startsWith('http') ? href : new URL(href, url).href,
            type: 'text/css'
          });
        }
      });
      
      // 提取图片
      $('img[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:')) {
          images.push({
            src: src.startsWith('http') ? src : new URL(src, url).href,
            alt: $(el).attr('alt') || ''
          });
        }
      });
      
      resources = { scripts, stylesheets, images };
    } catch (parseError) {
      console.log('解析HTML时出错（不影响主要功能）:', parseError.message);
    }

    res.json({
      url: url,
      statusCode: response.status,
      contentType: headers['content-type'] || 'text/html',
      contentLength: headers['content-length'] || response.data.length,
      headers: headers,
      html: response.data,
      resources: resources,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('获取源码时出错:', error.message);
    
    let errorDetails = {
      message: error.message,
      code: error.code
    };
    
    if (error.response) {
      errorDetails.status = error.response.status;
      errorDetails.data = error.response.data;
    }
    
    res.status(500).json({ 
      error: '获取网站源码失败',
      details: errorDetails
    });
  }
});

// 获取特定资源
app.get('/api/fetch-resource', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }

    const response = await axios.get(url, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    res.json({
      url: url,
      content: response.data,
      contentType: response.headers['content-type'],
      contentLength: response.data.length
    });

  } catch (error) {
    res.status(500).json({ 
      error: '获取资源失败',
      details: error.message 
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`源码查看器访问地址: http://localhost:${PORT}`);
});
