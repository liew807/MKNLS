const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 修复URL处理函数 - 处理相对路径
function normalizeUrl(url, baseUrl = null) {
  try {
    // 如果是相对路径且有baseUrl
    if (baseUrl && !url.startsWith('http://') && !url.startsWith('https://')) {
      try {
        const base = new URL(baseUrl);
        const resolved = new URL(url, base.origin);
        return resolved.toString();
      } catch (e) {
        // 如果相对路径解析失败，尝试拼接
        const cleanedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const cleanedUrl = url.startsWith('/') ? url : '/' + url;
        return cleanedBase + cleanedUrl;
      }
    }
    
    // 如果是完整URL但没有协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // 检查是否是类似"jbc518.onrender.com"的格式
      if (url.includes('.')) {
        url = 'https://' + url;
      } else {
        throw new Error('URL格式不正确');
      }
    }
    
    // 验证URL格式
    const urlObj = new URL(url);
    
    // 确保hostname有效
    if (!urlObj.hostname || urlObj.hostname === '') {
      throw new Error('无效的主机名');
    }
    
    return urlObj.toString();
  } catch (error) {
    throw new Error(`URL处理错误: ${error.message}`);
  }
}

// 主API：获取网站源码（修复版）
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
    console.log(`正在获取主网站: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });
    
    // 解析HTML获取资源
    let resources = { scripts: [], stylesheets: [], images: [] };
    try {
      const $ = cheerio.load(response.data);
      const baseUrl = url;
      
      // 获取脚本 - 修复相对路径
      $('script[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          try {
            // 尝试解析相对路径
            let scriptUrl;
            if (src.startsWith('http://') || src.startsWith('https://')) {
              scriptUrl = src;
            } else if (src.startsWith('//')) {
              scriptUrl = 'https:' + src;
            } else {
              // 相对路径，基于baseUrl构建完整URL
              const base = new URL(baseUrl);
              if (src.startsWith('/')) {
                scriptUrl = `${base.origin}${src}`;
              } else {
                scriptUrl = `${base.origin}${base.pathname.endsWith('/') ? base.pathname : base.pathname + '/'}${src}`;
              }
            }
            
            resources.scripts.push({
              src: scriptUrl,
              originalSrc: src,
              type: $(el).attr('type') || 'text/javascript',
              isExternal: scriptUrl.includes('://') && !scriptUrl.includes(base.hostname)
            });
          } catch (e) {
            console.log(`解析脚本URL失败: ${src}`, e.message);
          }
        }
      });
      
      // 获取样式表 - 修复相对路径
      $('link[rel="stylesheet"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            let styleUrl;
            if (href.startsWith('http://') || href.startsWith('https://')) {
              styleUrl = href;
            } else if (href.startsWith('//')) {
              styleUrl = 'https:' + href;
            } else {
              const base = new URL(baseUrl);
              if (href.startsWith('/')) {
                styleUrl = `${base.origin}${href}`;
              } else {
                styleUrl = `${base.origin}${base.pathname.endsWith('/') ? base.pathname : base.pathname + '/'}${href}`;
              }
            }
            
            resources.stylesheets.push({
              href: styleUrl,
              originalHref: href,
              isExternal: styleUrl.includes('://') && !styleUrl.includes(base.hostname)
            });
          } catch (e) {
            console.log(`解析样式URL失败: ${href}`, e.message);
          }
        }
      });
      
      // 获取图片 - 修复相对路径
      $('img[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:')) {
          try {
            let imgUrl;
            if (src.startsWith('http://') || src.startsWith('https://')) {
              imgUrl = src;
            } else if (src.startsWith('//')) {
              imgUrl = 'https:' + src;
            } else {
              const base = new URL(baseUrl);
              if (src.startsWith('/')) {
                imgUrl = `${base.origin}${src}`;
              } else {
                imgUrl = `${base.origin}${base.pathname.endsWith('/') ? base.pathname : base.pathname + '/'}${src}`;
              }
            }
            
            resources.images.push({
              src: imgUrl,
              originalSrc: src,
              alt: $(el).attr('alt') || '',
              isExternal: imgUrl.includes('://') && !imgUrl.includes(base.hostname)
            });
          } catch (e) {
            console.log(`解析图片URL失败: ${src}`, e.message);
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
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取源码失败:', error.message);
    
    let errorMessage = '获取网站源码失败';
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        errorMessage = '连接被拒绝';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = '无法解析域名';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = '连接超时';
      } else if (error.response) {
        errorMessage = `HTTP错误 ${error.response.status}`;
      }
    }
    
    res.status(500).json({
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 专门处理资源获取的API
app.get('/api/get-resource', async (req, res) => {
  try {
    let { url, baseUrl } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }
    
    console.log(`获取资源: url=${url}, baseUrl=${baseUrl || 'none'}`);
    
    // 标准化URL，处理相对路径
    const normalizedUrl = normalizeUrl(url, baseUrl);
    console.log(`标准化后URL: ${normalizedUrl}`);
    
    const response = await axios.get(normalizedUrl, {
      timeout: 10000,
      responseType: 'stream', // 使用流式响应
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': baseUrl || '',
        'Accept': '*/*'
      }
    });
    
    // 设置响应头
    const contentType = response.headers['content-type'];
    if (contentType) {
      res.set('Content-Type', contentType);
    }
    
    // 设置CORS头
    res.set('Access-Control-Allow-Origin', '*');
    
    // 将响应流直接转发给客户端
    response.data.pipe(res);
    
  } catch (error) {
    console.error('获取资源失败:', error.message);
    
    // 返回详细的错误信息
    res.status(500).json({
      error: '获取资源失败',
      url: req.query.url,
      baseUrl: req.query.baseUrl,
      details: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
});

// 简单版资源获取（直接返回文本内容）
app.get('/api/get-resource-text', async (req, res) => {
  try {
    let { url, baseUrl } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }
    
    console.log(`获取文本资源: ${url}`);
    
    // 标准化URL
    const normalizedUrl = normalizeUrl(url, baseUrl);
    
    const response = await axios.get(normalizedUrl, {
      timeout: 8000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    res.json({
      success: true,
      url: normalizedUrl,
      content: response.data,
      contentType: response.headers['content-type'],
      length: response.data.length
    });
    
  } catch (error) {
    console.error('获取文本资源失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      url: req.query.url
    });
  }
});

// 测试端点
app.get('/api/test-url', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }
    
    // 测试URL标准化
    const normalized = normalizeUrl(url, 'https://jbc518.onrender.com');
    
    res.json({
      original: url,
      normalized: normalized,
      isValid: true
    });
    
  } catch (error) {
    res.json({
      original: req.query.url,
      error: error.message,
      isValid: false
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'website-viewer',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📡 可用端点:`);
  console.log(`   GET /api/fetch-source?url={website_url}`);
  console.log(`   GET /api/get-resource?url={resource_url}&baseUrl={base_url}`);
  console.log(`   GET /api/test-url?url={url_to_test}`);
  console.log(`   GET /api/health`);
  console.log(`🌐 前端界面: http://localhost:${PORT}`);
});
