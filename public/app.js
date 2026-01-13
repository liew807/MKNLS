class WebsiteViewer {
  constructor() {
    this.currentUrl = '';
    this.currentData = null;
    this.baseUrl = '';
    this.init();
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('fetchBtn').addEventListener('click', () => this.fetchSource());
    document.getElementById('urlInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetchSource();
    });
    
    document.querySelectorAll('.example-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.target.dataset.url || e.target.textContent;
        document.getElementById('urlInput').value = url;
        this.fetchSource();
      });
    });
    
    // 测试按钮
    document.getElementById('testBtn')?.addEventListener('click', () => this.testUrls());
  }

  async fetchSource() {
    const input = document.getElementById('urlInput');
    let url = input.value.trim();
    
    if (!url) {
      this.showError('请输入URL地址');
      return;
    }
    
    // 清理URL
    url = this.cleanUrl(url);
    this.currentUrl = url;
    this.baseUrl = url;
    
    this.showLoading(`正在获取: ${url}`);
    
    try {
      const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      this.currentData = data;
      this.displayResults(data);
      this.showSuccess(`获取成功 (${data.statusCode})`);
      
    } catch (error) {
      console.error('获取失败:', error);
      this.showError(`获取失败: ${error.message}`);
      this.displayError(url, error);
    }
  }

  cleanUrl(url) {
    // 移除末尾的斜杠
    url = url.replace(/\/$/, '');
    
    // 如果没有协议，添加https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    return url;
  }

  displayResults(data) {
    // 更新URL显示
    document.getElementById('currentUrl').textContent = data.url;
    document.getElementById('statusCode').textContent = `状态码: ${data.statusCode}`;
    document.getElementById('contentSize').textContent = `大小: ${this.formatSize(data.contentLength)}`;
    
    // 显示HTML
    this.displayHtml(data.html);
    
    // 显示资源
    this.displayResources(data.resources);
    
    // 显示预览
    this.displayPreview(data.html, data.url);
  }

  displayHtml(html) {
    const htmlCode = document.getElementById('htmlCode');
    
    // 简单的HTML转义和格式化
    const escapedHtml = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    htmlCode.innerHTML = this.syntaxHighlight(escapedHtml);
  }

  syntaxHighlight(html) {
    // 简单的语法高亮
    return html
      .replace(/(&lt;\/?[a-z][a-z0-9]*)/gi, '<span class="tag">$1</span>')
      .replace(/([a-z-]+)=/gi, '<span class="attr">$1</span>=')
      .replace(/&quot;(.*?)&quot;/gi, '<span class="string">&quot;$1&quot;</span>')
      .replace(/&lt;!--(.*?)--&gt;/gi, '<span class="comment">&lt;!--$1--&gt;</span>');
  }

  displayResources(resources) {
    const scriptsList = document.getElementById('scriptsList');
    const stylesList = document.getElementById('stylesList');
    const imagesList = document.getElementById('imagesList');
    
    // 清空列表
    scriptsList.innerHTML = '';
    stylesList.innerHTML = '';
    imagesList.innerHTML = '';
    
    // 显示脚本
    if (resources.scripts && resources.scripts.length > 0) {
      resources.scripts.forEach(script => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="resource-item">
            <span class="resource-type">📜</span>
            <div class="resource-info">
              <div class="resource-url" title="${script.src}">${this.truncateUrl(script.src)}</div>
              <div class="resource-actions">
                <button onclick="viewer.viewResource('${script.src}', '${this.baseUrl}', 'js')" 
                        class="btn-view">
                  查看
                </button>
                <button onclick="viewer.downloadResource('${script.src}', '${this.baseUrl}')" 
                        class="btn-download">
                  下载
                </button>
              </div>
            </div>
          </div>
        `;
        scriptsList.appendChild(li);
      });
    } else {
      scriptsList.innerHTML = '<li>没有找到脚本文件</li>';
    }
    
    // 显示样式表
    if (resources.stylesheets && resources.stylesheets.length > 0) {
      resources.stylesheets.forEach(style => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="resource-item">
            <span class="resource-type">🎨</span>
            <div class="resource-info">
              <div class="resource-url" title="${style.href}">${this.truncateUrl(style.href)}</div>
              <div class="resource-actions">
                <button onclick="viewer.viewResource('${style.href}', '${this.baseUrl}', 'css')">
                  查看
                </button>
              </div>
            </div>
          </div>
        `;
        stylesList.appendChild(li);
      });
    } else {
      stylesList.innerHTML = '<li>没有找到样式表</li>';
    }
    
    // 显示图片
    if (resources.images && resources.images.length > 0) {
      resources.images.forEach(img => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="resource-item">
            <span class="resource-type">🖼️</span>
            <div class="resource-info">
              <div class="resource-url" title="${img.src}">${this.truncateUrl(img.src)}</div>
              ${img.alt ? `<div class="resource-alt">${img.alt}</div>` : ''}
              <div class="resource-actions">
                <button onclick="viewer.viewImage('${img.src}', '${this.baseUrl}')">
                  查看
                </button>
              </div>
            </div>
          </div>
        `;
        imagesList.appendChild(li);
      });
    } else {
      imagesList.innerHTML = '<li>没有找到图片</li>';
    }
  }

  async viewResource(url, baseUrl, type = 'js') {
    try {
      this.showLoading(`正在获取资源: ${this.truncateUrl(url)}`);
      
      const response = await fetch(`/api/get-resource-text?url=${encodeURIComponent(url)}&baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      this.showResourceModal(url, data.content, type);
      this.showSuccess('资源获取成功');
      
    } catch (error) {
      console.error('获取资源失败:', error);
      this.showError(`无法获取资源: ${error.message}`);
      
      // 尝试直接打开
      window.open(url, '_blank');
    }
  }

  viewImage(url, baseUrl) {
    // 图片直接在新窗口打开
    window.open(url, '_blank');
  }

  async downloadResource(url, baseUrl) {
    try {
      // 创建下载链接
      const downloadUrl = `/api/get-resource?url=${encodeURIComponent(url)}&baseUrl=${encodeURIComponent(baseUrl)}`;
      
      // 获取文件名
      const filename = url.split('/').pop() || 'download';
      
      // 创建临时链接并点击
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      this.showSuccess('开始下载');
      
    } catch (error) {
      this.showError('下载失败: ' + error.message);
    }
  }

  showResourceModal(url, content, type) {
    const modal = document.getElementById('resourceModal');
    const title = document.getElementById('modalTitle');
    const contentEl = document.getElementById('modalContent');
    
    title.textContent = `资源内容: ${this.truncateUrl(url, 50)}`;
    
    // 根据类型格式化内容
    let formattedContent = content;
    if (type === 'js') {
      formattedContent = `<pre><code class="language-javascript">${this.escapeHtml(content)}</code></pre>`;
    } else if (type === 'css') {
      formattedContent = `<pre><code class="language-css">${this.escapeHtml(content)}</code></pre>`;
    } else {
      formattedContent = `<pre>${this.escapeHtml(content)}</pre>`;
    }
    
    contentEl.innerHTML = formattedContent;
    modal.style.display = 'block';
    
    // 如果有Prism，应用高亮
    if (window.Prism) {
      Prism.highlightAll();
    }
  }

  displayPreview(html, baseUrl) {
    const previewFrame = document.getElementById('previewFrame');
    
    // 创建包含基础URL的完整HTML
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <base href="${baseUrl}">
          <meta charset="UTF-8">
          <style>
            body { margin: 20px; font-family: Arial, sans-serif; }
            img { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `;
    
    // 使用Blob创建本地URL
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    previewFrame.src = url;
  }

  displayError(url, error) {
    const htmlCode = document.getElementById('htmlCode');
    const errorHtml = `
      <div class="error-container">
        <h3>❌ 获取失败</h3>
        <p><strong>URL:</strong> ${this.escapeHtml(url)}</p>
        <p><strong>错误:</strong> ${this.escapeHtml(error.message)}</p>
        <hr>
        <h4>排查建议:</h4>
        <ul>
          <li>检查URL是否正确</li>
          <li>检查网络连接</li>
          <li>网站可能屏蔽了请求</li>
          <li>尝试其他URL</li>
        </ul>
        <button onclick="viewer.testUrls()" class="btn-test">测试示例URL</button>
      </div>
    `;
    htmlCode.innerHTML = errorHtml;
  }

  async testUrls() {
    const testUrls = [
      'https://jbc518.onrender.com',
      'https://google.com',
      'https://github.com'
    ];
    
    for (const testUrl of testUrls) {
      this.showLoading(`测试: ${testUrl}`);
      
      try {
        const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(testUrl)}`);
        const data = await response.json();
        
        if (data.success) {
          console.log(`✅ ${testUrl}: 成功 (${data.statusCode})`);
        } else {
          console.log(`❌ ${testUrl}: ${data.error}`);
        }
      } catch (error) {
        console.log(`❌ ${testUrl}: ${error.message}`);
      }
    }
    
    this.showSuccess('测试完成，查看控制台结果');
  }

  // 工具函数
  truncateUrl(url, maxLength = 60) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  showLoading(message) {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status loading';
    statusEl.innerHTML = `⏳ ${message}`;
  }

  showSuccess(message) {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status success';
    statusEl.innerHTML = `✅ ${message}`;
  }

  showError(message) {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status error';
    statusEl.innerHTML = `❌ ${message}`;
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.viewer = new WebsiteViewer();
  
  // 关闭模态框
  document.querySelector('.close-modal')?.addEventListener('click', () => {
    document.getElementById('resourceModal').style.display = 'none';
  });
  
  // 点击模态框背景关闭
  document.getElementById('resourceModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('resourceModal')) {
      e.target.style.display = 'none';
    }
  });
});
