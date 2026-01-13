class WebsiteCodeViewer {
    constructor() {
        this.init();
        this.bindEvents();
        this.initCodeMirror();
    }

    init() {
        this.currentUrl = '';
        this.currentData = null;
        this.codeEditor = null;
        this.resourceEditor = null;
    }

    initCodeMirror() {
        // 初始化HTML代码编辑器
        const htmlTextarea = document.getElementById('htmlCode');
        this.codeEditor = CodeMirror.fromTextArea(htmlTextarea, {
            lineNumbers: true,
            mode: 'htmlmixed',
            theme: 'material-darker',
            readOnly: true,
            lineWrapping: true,
            tabSize: 2,
            indentUnit: 2,
            matchBrackets: true,
            autoCloseBrackets: true,
            extraKeys: {
                'Ctrl-Space': 'autocomplete'
            },
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
        });

        // 初始化资源代码编辑器
        const resourceTextarea = document.getElementById('resourceCode');
        this.resourceEditor = CodeMirror.fromTextArea(resourceTextarea, {
            lineNumbers: true,
            theme: 'material-darker',
            readOnly: true,
            lineWrapping: true,
            tabSize: 2
        });
    }

    bindEvents() {
        // URL输入和按钮事件
        document.getElementById('fetchBtn').addEventListener('click', () => this.fetchWebsite());
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyzeWebsite());
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.fetchWebsite();
        });

        // 快速链接
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.target.dataset.url;
                document.getElementById('urlInput').value = url;
                this.fetchWebsite();
            });
        });

        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // 代码操作按钮
        document.getElementById('copyHtmlBtn').addEventListener('click', () => this.copyHtml());
        document.getElementById('formatBtn').addEventListener('click', () => this.formatCode());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadHtml());
        document.getElementById('lineNumbers').addEventListener('change', (e) => {
            this.codeEditor.setOption('lineNumbers', e.target.checked);
        });

        // 预览操作
        document.getElementById('refreshPreview').addEventListener('click', () => this.refreshPreview());
        document.getElementById('openExternal').addEventListener('click', () => {
            if (this.currentUrl) {
                window.open(this.currentUrl, '_blank');
            }
        });

        // 模态框
        document.querySelector('.close-btn').addEventListener('click', () => {
            document.getElementById('resourceModal').style.display = 'none';
        });

        // 点击模态框背景关闭
        document.getElementById('resourceModal').addEventListener('click', (e) => {
            if (e.target.id === 'resourceModal') {
                e.target.style.display = 'none';
            }
        });
    }

    async fetchWebsite() {
        const urlInput = document.getElementById('urlInput');
        const url = urlInput.value.trim();
        
        if (!url) {
            alert('请输入有效的URL');
            return;
        }

        this.currentUrl = url;
        this.updateStatus('loading', '正在获取网站源码...');
        this.updateCurrentUrl();

        try {
            const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.currentData = data;
            this.displayHtml(data.html);
            this.displayResources(data.resources);
            this.displayHeaders(data.headers);
            this.updateStats(data);
            this.updatePreview(data.html);
            this.updateStatus('success', `获取成功！状态码: ${data.statusCode}`);

            // 更新响应时间和大小信息
            document.getElementById('responseTime').textContent = `响应时间: ${new Date().toLocaleTimeString()}`;
            document.getElementById('contentLength').textContent = `大小: ${Math.round(data.contentLength / 1024)} KB`;

        } catch (error) {
            console.error('获取源码失败:', error);
            this.updateStatus('error', `获取失败: ${error.message}`);
            this.codeEditor.setValue(`// 获取源码失败\n// 错误: ${error.message}\n// URL: ${url}`);
        }
    }

    async analyzeWebsite() {
        const url = document.getElementById('urlInput').value.trim();
        if (!url) return;

        this.updateStatus('loading', '正在分析网站结构...');
        
        try {
            // 这里可以添加更详细的分析逻辑
            const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            
            // 显示分析结果
            alert(`网站分析完成！\nHTML大小: ${Math.round(data.contentLength / 1024)}KB\n脚本文件: ${data.resources.scripts.length}\n样式表: ${data.resources.stylesheets.length}\n图片: ${data.resources.images.length}`);
            
        } catch (error) {
            alert('分析失败: ' + error.message);
        }
    }

    displayHtml(html) {
        // 设置HTML代码到编辑器
        this.codeEditor.setValue(html);
        
        // 切换到HTML标签页
        this.switchTab('html');
    }

    displayResources(resources) {
        // 显示JavaScript文件
        const scriptsList = document.getElementById('scriptsList');
        scriptsList.innerHTML = '';
        
        if (resources.scripts && resources.scripts.length > 0) {
            resources.scripts.forEach(script => {
                const div = document.createElement('div');
                div.className = 'resource-item';
                div.innerHTML = `
                    <div class="resource-url">${script.src}</div>
                    <div class="resource-meta">
                        <span>类型: ${script.type}</span>
                    </div>
                `;
                div.addEventListener('click', () => this.viewResource(script.src, 'javascript'));
                scriptsList.appendChild(div);
            });
        } else {
            scriptsList.innerHTML = '<div class="resource-item">未找到外部JavaScript文件</div>';
        }

        // 显示CSS文件
        const stylesheetsList = document.getElementById('stylesheetsList');
        stylesheetsList.innerHTML = '';
        
        if (resources.stylesheets && resources.stylesheets.length > 0) {
            resources.stylesheets.forEach(style => {
                const div = document.createElement('div');
                div.className = 'resource-item';
                div.innerHTML = `
                    <div class="resource-url">${style.href}</div>
                    <div class="resource-meta">
                        <span>类型: ${style.type}</span>
                    </div>
                `;
                div.addEventListener('click', () => this.viewResource(style.href, 'css'));
                stylesheetsList.appendChild(div);
            });
        } else {
            stylesheetsList.innerHTML = '<div class="resource-item">未找到外部CSS文件</div>';
        }

        // 显示图片
        const imagesList = document.getElementById('imagesList');
        imagesList.innerHTML = '';
        
        if (resources.images && resources.images.length > 0) {
            resources.images.forEach(img => {
                const div = document.createElement('div');
                div.className = 'resource-item';
                div.innerHTML = `
                    <div class="resource-url">${img.src}</div>
                    <div class="resource-meta">
                        <span>Alt: ${img.alt || '无'}</span>
                    </div>
                `;
                div.addEventListener('click', () => this.viewResource(img.src, 'image'));
                imagesList.appendChild(div);
            });
        } else {
            imagesList.innerHTML = '<div class="resource-item">未找到图片资源</div>';
        }
    }

    async viewResource(url, type) {
        if (type === 'image') {
            // 图片直接在新窗口打开
            window.open(url, '_blank');
            return;
        }

        this.updateStatus('loading', '正在获取资源内容...');

        try {
            const response = await fetch(`/api/fetch-resource?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // 设置模态框标题
            document.getElementById('modalTitle').textContent = `资源内容 - ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`;
            
            // 设置代码并选择模式
            this.resourceEditor.setValue(data.content || '// 空内容或无内容返回');
            
            // 根据类型设置语法高亮
            const mode = type === 'javascript' ? 'javascript' : type === 'css' ? 'css' : 'text/plain';
            this.resourceEditor.setOption('mode', mode);
            
            // 显示模态框
            document.getElementById('resourceModal').style.display = 'flex';

            this.updateStatus('success', '资源加载完成');

        } catch (error) {
            console.error('获取资源失败:', error);
            this.resourceEditor.setValue(`// 获取资源失败\n// URL: ${url}\n// 错误: ${error.message}`);
            this.resourceEditor.setOption('mode', 'text/plain');
            document.getElementById('resourceModal').style.display = 'flex';
        }
    }

    displayHeaders(headers) {
        const tbody = document.querySelector('#headersTable tbody');
        tbody.innerHTML = '';
        
        for (const [key, value] of Object.entries(headers)) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${key}</td>
                <td>${value}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    updateStats(data) {
        // 更新统计信息
        document.getElementById('htmlSize').textContent = `${Math.round(data.contentLength / 1024)} KB`;
        document.getElementById('jsCount').textContent = data.resources.scripts.length;
        document.getElementById('cssCount').textContent = data.resources.stylesheets.length;
        document.getElementById('imageCount').textContent = data.resources.images.length;
    }

    updatePreview(html) {
        const previewFrame = document.getElementById('previewFrame');
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        previewFrame.src = url;
    }

    refreshPreview() {
        if (this.currentData && this.currentData.html) {
            this.updatePreview(this.currentData.html);
        }
    }

    switchTab(tabName) {
        // 更新标签页按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // 显示对应的标签页内容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        // 如果是预览标签页，刷新预览
        if (tabName === 'preview' && this.currentData) {
            this.refreshPreview();
        }
    }

    updateStatus(status, message) {
        const statusEl = document.getElementById('status');
        statusEl.className = `status ${status}`;
        statusEl.textContent = message;
    }

    updateCurrentUrl() {
        document.getElementById('currentUrl').textContent = this.currentUrl;
    }

    copyHtml() {
        const code = this.codeEditor.getValue();
        navigator.clipboard.writeText(code)
            .then(() => {
                alert('代码已复制到剪贴板！');
            })
            .catch(err => {
                console.error('复制失败:', err);
                alert('复制失败，请手动复制');
            });
    }

    formatCode() {
        const code = this.codeEditor.getValue();
        // 这里可以添加代码格式化逻辑
        // 简单示例：调整缩进
        const formatted = code
            .replace(/</g, '\n<')
            .replace(/>/g, '>\n')
            .split('\n')
            .filter(line => line.trim())
            .map(line => line.trim())
            .join('\n');
        
        this.codeEditor.setValue(formatted);
        alert('代码已格式化！');
    }

    downloadHtml() {
        if (!this.currentData) {
            alert('没有可下载的内容');
            return;
        }

        const html = this.codeEditor.getValue();
        const filename = this.currentUrl
            .replace(/https?:\/\//, '')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase() + '.html';
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert(`已下载: ${filename}`);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.viewer = new WebsiteCodeViewer();
    
    // 自动获取示例网站
    setTimeout(() => {
        document.getElementById('fetchBtn').click();
    }, 500);
});
