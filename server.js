const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 增强的配置文件路径字典
const CONFIG_PATHS = {
  nodejs: [
    '/package.json', '/package-lock.json', '/yarn.lock',
    '/server.js', '/app.js', '/index.js', '/main.js',
    '/config/', '/src/', '/lib/', '/routes/', '/models/',
    '/controllers/', '/middlewares/', '/utils/', '/config.js',
    '/config.json', '/.env', '/.env.example', '/dockerfile',
    '/docker-compose.yml', '/nginx.conf', '/pm2.config.js'
  ],
  php: [
    '/index.php', '/composer.json', '/composer.lock',
    '/config.php', '/database.php', '/.env', '/.htaccess',
    '/app/', '/src/', '/vendor/', '/public/', '/resources/',
    '/routes/', '/models/', '/controllers/', '/views/',
    '/config/', '/migrations/', '/seeds/'
  ],
  python: [
    '/requirements.txt', '/Pipfile', '/Pipfile.lock',
    '/manage.py', '/app.py', '/main.py', '/wsgi.py',
    '/asgi.py', '/settings.py', '/urls.py', '/views.py',
    '/models.py', '/config.py', '/.env', '/dockerfile'
  ],
  java: [
    '/pom.xml', '/build.gradle', '/build.sbt',
    '/src/main/java/', '/src/main/resources/',
    '/src/test/java/', '/web.xml', '/application.properties',
    '/application.yml', '/pom.xml'
  ],
  ruby: [
    '/Gemfile', '/Gemfile.lock', '/config.ru',
    '/app/', '/config/', '/db/', '/lib/', '/public/',
    '/test/', '/vendor/', '/Rakefile', '/config/database.yml'
  ]
};

// 通用文件探测
const COMMON_FILES = [
  // 配置文件
  '/.git/config', '/.git/HEAD', '/.gitignore',
  '/.dockerignore', '/.editorconfig', '/.eslintrc.js',
  '/.prettierrc', '/tsconfig.json', '/babel.config.js',
  '/webpack.config.js', '/vite.config.js',
  
  // 数据库相关
  '/prisma/schema.prisma', '/schema.graphql',
  '/database/', '/migrations/', '/seeds/',
  
  // 部署配置
  '/.github/workflows/', '/gitlab-ci.yml',
  '/jenkinsfile', '/vercel.json', '/netlify.toml',
  
  // 日志和文档
  '/CHANGELOG.md', '/README.md', '/LICENSE',
  '/docs/', '/logs/', '/tmp/'
];

// API: 深度探测后端文件结构
app.get('/api/deep-probe', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL参数是必需的' });
    }

    const targetUrl = new URL(url);
    const baseUrl = targetUrl.origin;
    
    console.log(`开始深度探测: ${url}`);

    // 1. 首先检测技术栈
    const techStack = await detectTechStack(baseUrl);
    
    // 2. 基于技术栈探测对应文件
    const fileResults = [];
    const detectedFiles = [];
    
    // 探测该技术栈特有的文件
    if (techStack.primary) {
      const paths = CONFIG_PATHS[techStack.primary] || [];
      for (const filePath of paths) {
        const result = await probeFile(baseUrl, filePath);
        if (result.exists) {
          detectedFiles.push(result);
          
          // 如果是配置文件，尝试获取内容
          if (shouldFetchContent(filePath)) {
            const content = await fetchFileContent(baseUrl, filePath);
            if (content) {
              result.content = content.substring(0, 5000); // 限制大小
              result.hasContent = true;
            }
          }
        }
        fileResults.push(result);
      }
    }
    
    // 3. 探测通用文件
    for (const filePath of COMMON_FILES) {
      const result = await probeFile(baseUrl, filePath);
      fileResults.push(result);
      if (result.exists) {
        detectedFiles.push(result);
      }
    }
    
    // 4. 特殊探测：Git信息
    const gitInfo = await probeGitInfo(baseUrl);
    
    // 5. 探测API端点
    const apiEndpoints = await probeApiEndpoints(baseUrl);
    
    // 6. 探测子目录
    const subdirectories = await probeSubdirectories(baseUrl);
    
    res.json({
      target: url,
      timestamp: new Date().toISOString(),
      techStack,
      files: {
        totalProbed: fileResults.length,
        found: detectedFiles.length,
        list: detectedFiles,
        allResults: fileResults
      },
      git: gitInfo,
      apis: apiEndpoints,
      directories: subdirectories,
      analysis: analyzeBackendStructure(detectedFiles, techStack)
    });

  } catch (error) {
    console.error('深度探测错误:', error);
    res.status(500).json({ 
      error: '探测失败',
      details: error.message
    });
  }
});

// 探测单个文件
async function probeFile(baseUrl, filePath) {
  const fileUrl = new URL(filePath, baseUrl).href;
  
  try {
    // 先尝试HEAD请求（更快）
    const response = await axios.head(fileUrl, {
      timeout: 3000,
      validateStatus: (status) => status < 400
    });
    
    return {
      path: filePath,
      url: fileUrl,
      exists: true,
      status: response.status,
      type: getFileType(filePath),
      size: response.headers['content-length'],
      lastModified: response.headers['last-modified']
    };
    
  } catch (headError) {
    // HEAD失败，尝试GET
    try {
      const response = await axios.get(fileUrl, {
        timeout: 3000,
        validateStatus: (status) => status < 400
      });
      
      return {
        path: filePath,
        url: fileUrl,
        exists: true,
        status: response.status,
        type: getFileType(filePath),
        size: response.data.length,
        hasContent: true
      };
      
    } catch (getError) {
      return {
        path: filePath,
        url: fileUrl,
        exists: false,
        status: getError.response?.status || 0,
        error: getError.message
      };
    }
  }
}

// 获取文件内容（如果可读）
async function fetchFileContent(baseUrl, filePath) {
  try {
    const fileUrl = new URL(filePath, baseUrl).href;
    const response = await axios.get(fileUrl, {
      timeout: 5000,
      responseType: 'text',
      headers: {
        'Accept': 'text/plain,application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    return null;
  }
}

// 检测技术栈
async function detectTechStack(baseUrl) {
  const techIndicators = {
    nodejs: 0,
    php: 0,
    python: 0,
    java: 0,
    ruby: 0,
    dotnet: 0
  };
  
  try {
    // 检查HTTP头
    const response = await axios.head(baseUrl, { timeout: 3000 });
    const headers = response.headers;
    
    // 基于HTTP头的检测
    if (headers['x-powered-by']) {
      const poweredBy = headers['x-powered-by'].toLowerCase();
      if (poweredBy.includes('express') || poweredBy.includes('node')) techIndicators.nodejs += 3;
      if (poweredBy.includes('php')) techIndicators.php += 3;
      if (poweredBy.includes('python')) techIndicators.python += 3;
      if (poweredBy.includes('asp.net')) techIndicators.dotnet += 3;
    }
    
    if (headers['server']) {
      const server = headers['server'].toLowerCase();
      if (server.includes('node')) techIndicators.nodejs += 2;
      if (server.includes('apache') || server.includes('nginx/php')) techIndicators.php += 2;
      if (server.includes('gunicorn') || server.includes('waitress')) techIndicators.python += 2;
      if (server.includes('tomcat') || server.includes('jetty')) techIndicators.java += 2;
    }
    
    // 检查Cookie
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      if (setCookie.includes('connect.sid')) techIndicators.nodejs += 1;
      if (setCookie.includes('PHPSESSID')) techIndicators.php += 1;
      if (setCookie.includes('JSESSIONID')) techIndicators.java += 1;
      if (setCookie.includes('ASP.NET_SessionId')) techIndicators.dotnet += 1;
    }
    
  } catch (error) {
    // 忽略错误，继续其他检测
  }
  
  // 快速探测关键文件来验证
  const quickChecks = [
    { tech: 'nodejs', files: ['/package.json', '/server.js'] },
    { tech: 'php', files: ['/index.php', '/composer.json'] },
    { tech: 'python', files: ['/requirements.txt', '/manage.py'] },
    { tech: 'java', files: ['/pom.xml', '/WEB-INF/'] },
    { tech: 'ruby', files: ['/Gemfile', '/config.ru'] }
  ];
  
  for (const check of quickChecks) {
    for (const file of check.files) {
      try {
        await axios.head(new URL(file, baseUrl).href, { timeout: 1000 });
        techIndicators[check.tech] += 2;
        break;
      } catch (e) {
        // 文件不存在
      }
    }
  }
  
  // 找出最高分的技术
  let primaryTech = null;
  let maxScore = 0;
  
  for (const [tech, score] of Object.entries(techIndicators)) {
    if (score > maxScore) {
      maxScore = score;
      primaryTech = tech;
    }
  }
  
  return {
    primary: primaryTech,
    scores: techIndicators,
    confidence: maxScore > 0 ? Math.min(100, (maxScore / 10) * 100) : 0
  };
}

// 探测Git信息
async function probeGitInfo(baseUrl) {
  const gitFiles = [
    '/.git/HEAD',
    '/.git/config',
    '/.git/description',
    '/.git/index'
  ];
  
  const results = [];
  
  for (const file of gitFiles) {
    try {
      const response = await axios.get(new URL(file, baseUrl).href, {
        timeout: 2000,
        responseType: 'text'
      });
      
      results.push({
        file,
        exists: true,
        content: response.data.substring(0, 500)
      });
    } catch (error) {
      results.push({
        file,
        exists: false
      });
    }
  }
  
  return {
    hasGit: results.some(r => r.exists),
    files: results
  };
}

// 探测API端点
async function probeApiEndpoints(baseUrl) {
  const commonEndpoints = [
    '/api', '/api/v1', '/api/v2',
    '/graphql', '/graphiql',
    '/rest', '/soap',
    '/auth', '/login', '/register',
    '/users', '/products', '/posts',
    '/admin', '/dashboard',
    '/swagger', '/swagger-ui', '/api-docs',
    '/health', '/status', '/ping'
  ];
  
  const endpoints = [];
  
  for (const endpoint of commonEndpoints) {
    try {
      const response = await axios.head(new URL(endpoint, baseUrl).href, {
        timeout: 2000
      });
      
      endpoints.push({
        endpoint,
        exists: true,
        status: response.status,
        method: 'GET'
      });
    } catch (error) {
      // 忽略错误
    }
  }
  
  return endpoints;
}

// 探测子目录
async function probeSubdirectories(baseUrl) {
  const commonDirs = [
    '/src/', '/app/', '/lib/', '/config/',
    '/public/', '/static/', '/assets/',
    '/views/', '/templates/', '/components/',
    '/models/', '/controllers/', '/routes/',
    '/middlewares/', '/utils/', '/helpers/',
    '/database/', '/migrations/', '/seeds/',
    '/tests/', '/specs/', '/docs/'
  ];
  
  const directories = [];
  
  for (const dir of commonDirs) {
    try {
      const response = await axios.get(new URL(dir, baseUrl).href, {
        timeout: 2000,
        validateStatus: null
      });
      
      if (response.status === 200 || response.status === 403) {
        directories.push({
          directory: dir,
          exists: true,
          status: response.status,
          listing: response.status === 200 ? '可能开启目录列表' : '禁止访问'
        });
      }
    } catch (error) {
      // 忽略错误
    }
  }
  
  return directories;
}

// 分析后端结构
function analyzeBackendStructure(files, techStack) {
  const analysis = {
    hasConfigFiles: false,
    hasSourceCode: false,
    hasBuildFiles: false,
    hasDatabaseConfig: false,
    hasDeploymentConfig: false,
    structureScore: 0,
    recommendations: []
  };
  
  const foundPaths = files.map(f => f.path);
  
  // 检查配置文件
  if (foundPaths.some(p => p.includes('package.json') || p.includes('composer.json') || p.includes('pom.xml'))) {
    analysis.hasConfigFiles = true;
    analysis.structureScore += 20;
  }
  
  // 检查源代码
  if (foundPaths.some(p => p.includes('.js') || p.includes('.php') || p.includes('.py') || p.includes('.java'))) {
    analysis.hasSourceCode = true;
    analysis.structureScore += 30;
  }
  
  // 检查构建文件
  if (foundPaths.some(p => p.includes('docker') || p.includes('Dockerfile') || p.includes('.yml'))) {
    analysis.hasBuildFiles = true;
    analysis.structureScore += 15;
  }
  
  // 检查数据库配置
  if (foundPaths.some(p => p.includes('database') || p.includes('.env') || p.includes('config.json'))) {
    analysis.hasDatabaseConfig = true;
    analysis.structureScore += 20;
  }
  
  // 检查部署配置
  if (foundPaths.some(p => p.includes('.github') || p.includes('vercel') || p.includes('netlify'))) {
    analysis.hasDeploymentConfig = true;
    analysis.structureScore += 15;
  }
  
  // 生成建议
  if (analysis.structureScore > 50) {
    analysis.recommendations.push('后端结构相对完整，可以进一步分析具体代码');
  } else if (analysis.structureScore > 20) {
    analysis.recommendations.push('发现部分后端文件，但结构不完整');
  } else {
    analysis.recommendations.push('后端文件隐藏较好，可能需要其他探测方式');
  }
  
  return analysis;
}

// 工具函数
function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.js': 'JavaScript',
    '.json': 'JSON Config',
    '.php': 'PHP',
    '.py': 'Python',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.yml': 'YAML Config',
    '.yaml': 'YAML Config',
    '.xml': 'XML Config',
    '.md': 'Documentation',
    '.txt': 'Text',
    '.lock': 'Lock File',
    '.env': 'Environment',
    '.gitignore': 'Git Ignore',
    '': 'Directory'
  };
  
  return types[ext] || 'Unknown';
}

function shouldFetchContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fetchable = ['.json', '.js', '.txt', '.md', '.env', '.yml', '.yaml', '.xml'];
  return fetchable.includes(ext);
}

// 新增API：获取具体文件内容
app.get('/api/get-file-content', async (req, res) => {
  try {
    const { url, filePath } = req.query;
    
    if (!url || !filePath) {
      return res.status(400).json({ error: 'URL和文件路径都是必需的' });
    }
    
    const content = await fetchFileContent(new URL(url), filePath);
    
    if (content) {
      res.json({
        filePath,
        content,
        length: content.length,
        type: getFileType(filePath)
      });
    } else {
      res.status(404).json({ error: '无法获取文件内容' });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 新增API：批量探测
app.post('/api/batch-probe', async (req, res) => {
  try {
    const { url, filePaths } = req.body;
    
    if (!url || !filePaths || !Array.isArray(filePaths)) {
      return res.status(400).json({ error: '参数错误' });
    }
    
    const results = [];
    for (const filePath of filePaths) {
      const result = await probeFile(new URL(url), filePath);
      results.push(result);
    }
    
    res.json({ results });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`后端代码分析器运行在 http://localhost:${PORT}`);
});
