class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        console.log('cpmcy Clone 初始化成功');
    }

    init() {
        this.bindEvents();
        this.checkSession();
        this.testConnection();
        this.initStepIndicator();
        this.initOperationType();
        this.initMoneyOperation();
    }

    initStepIndicator() {
        const cloneSection = document.getElementById('clone-section');
        if (cloneSection) {
            const stepHtml = `
                <div class="step-indicator">
                    <div class="step active" id="step-1">
                        <div class="step-number">1</div>
                        <div class="step-text">登录源账号</div>
                    </div>
                    <div class="step" id="step-2">
                        <div class="step-number">2</div>
                        <div class="step-text">选择操作类型</div>
                    </div>
                    <div class="step" id="step-3">
                        <div class="step-number">3</div>
                        <div class="step-text">开始执行</div>
                    </div>
                </div>
            `;
            cloneSection.insertAdjacentHTML('afterbegin', stepHtml);
        }
    }

    initMoneyOperation() {
        document.querySelectorAll('input[name="money-operation"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.updateMoneyOperationUI(e.target.value));
        });
        this.updateMoneyOperationUI('set');
        
        document.getElementById('modify-money-btn')?.addEventListener('click', () => this.modifyMoney());
        document.getElementById('refresh-money-btn')?.addEventListener('click', () => this.refreshMoney());
    }

    updateMoneyOperationUI(type) {
        const gc = document.getElementById('green-cash');
        const gd = document.getElementById('gold-coins');
        if (type === 'max') {
            if (gc) gc.style.display = 'none';
            if (gd) gd.style.display = 'none';
        } else {
            if (gc) gc.style.display = 'block';
            if (gd) gd.style.display = 'block';
        }
    }

    initOperationType() {
        document.querySelectorAll('input[name="operation-type"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.updateOperationUI(e.target.value));
        });
        this.updateOperationUI('modify-id');
    }

    updateOperationUI(type) {
        const tc = document.getElementById('target-credentials');
        const btn = document.getElementById('clone-btn');
        if (type === 'modify-id') {
            if (tc) tc.style.display = 'none';
            if (btn) btn.innerHTML = '<i class="fas fa-user-edit"></i> 修改当前账号ID';
        } else {
            if (tc) tc.style.display = 'block';
            if (btn) btn.innerHTML = '<i class="fas fa-clone"></i> 开始克隆';
        }
    }

    bindEvents() {
        document.getElementById('login-btn')?.addEventListener('click', () => this.login());
        document.getElementById('clone-btn')?.addEventListener('click', () => this.cloneAccount());
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        
        document.getElementById('source-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.login(); }
        });
    }

    async testConnection() {
        try {
            const response = await fetch(`${this.baseUrl}/api/health`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.addLog('✓ 服务器连接正常');
            }
        } catch (error) {
            this.addLog('⚠ 服务器连接失败');
        }
    }

    checkSession() {
        const savedAuth = localStorage.getItem('jbcacc_auth');
        if (savedAuth) {
            this.sourceAuth = savedAuth;
            this.hideElement('login-section');
            this.showElement('clone-section');
            this.showElement('account-info-section');
            this.showElement('money-section');
            this.verifyAndLoadAccount(savedAuth);
        }
    }

    // ==================== 获取并显示账号数据 ====================
    async verifyAndLoadAccount(authToken) {
        try {
            this.updateStep(1);
            
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            console.log('获取账号数据返回:', data);
            
            // 尝试多种方式提取数据
            let accountData = null;
            
            if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
                accountData = data.data;
            } else if (data.result) {
                try { accountData = JSON.parse(data.result); } catch(e) { accountData = data.result; }
            } else if (data.Name || data.name || data.localID || data.localId) {
                accountData = data;
            }
            
            if (accountData) {
                console.log('账号数据:', Object.keys(accountData));
                this.sourceAccountInfo = accountData;
                this.displayAccountInfo(accountData);
                this.showStatus('success', '登录成功！', 'login-status');
                this.updateStep(2);
                this.addLog('✓ 账号数据加载成功');
                await this.loadCarsCount(authToken);
            } else {
                this.showStatus('error', '获取数据失败，请重试', 'login-status');
                this.addLog('✗ 获取数据失败');
            }
        } catch (error) {
            console.log('错误:', error);
            this.showStatus('error', '网络错误', 'login-status');
        }
    }

    // 显示账号信息
    displayAccountInfo(accountData) {
        if (!accountData) return;
        
        console.log('显示账号信息, 字段:', Object.keys(accountData));
        console.log('Name:', accountData.Name || accountData.name);
        console.log('cash:', accountData.cash || accountData.Cash);
        console.log('coin:', accountData.coin || accountData.Coin || accountData.money);
        console.log('localID:', accountData.localID || accountData.localId);
        
        // 名称
        const name = accountData.Name || accountData.name || accountData.username || '未知';
        document.getElementById('account-name').textContent = name;
        
        // 绿钞
        const greenCash = accountData.cash || accountData.Cash || accountData.greenCash || 0;
        document.getElementById('account-green-cash').textContent = this.formatNumber(greenCash);
        
        // 金币
        const goldCoins = accountData.coin || accountData.Coin || accountData.money || accountData.Money || 0;
        document.getElementById('account-money').textContent = this.formatNumber(goldCoins);
        
        // Local ID
        const localID = accountData.localID || accountData.localId || '未知';
        document.getElementById('account-localid').textContent = localID;
        
        // 状态
        const badge = document.getElementById('account-status');
        if (badge) {
            badge.textContent = '已登录';
            badge.setAttribute('data-status', 'online');
            badge.style.color = '#27ae60';
        }
    }

    async loadCarsCount(authToken) {
        try {
            const response = await fetch(`${this.baseUrl}/api/get-all-cars`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                document.getElementById('account-cars').textContent = data.data.length;
            } else {
                document.getElementById('account-cars').textContent = '0';
            }
        } catch (error) {
            document.getElementById('account-cars').textContent = '--';
        }
    }

    formatNumber(num) {
        if (num === undefined || num === null) return '0';
        return Number(num).toLocaleString('zh-CN');
    }

    // ==================== 登录 ====================
    async login() {
        if (this.isProcessing) return;

        const email = document.getElementById('source-email').value.trim();
        const password = document.getElementById('source-password').value;

        if (!email || !password) {
            this.showStatus('error', '请输入邮箱和密码', 'login-status');
            return;
        }

        this.isProcessing = true;
        this.updateButtonState('login-btn', true, '登录中...');
        this.showStatus('info', '正在登录...', 'login-status');
        this.addLog('正在登录: ' + email);

        try {
            const response = await fetch(`${this.baseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            console.log('登录响应:', data);

            if (data.ok && data.auth) {
                this.sourceAuth = data.auth;
                localStorage.setItem('jbcacc_auth', data.auth);
                
                this.hideElement('login-section');
                this.showElement('clone-section');
                this.showElement('account-info-section');
                this.showElement('money-section');
                
                this.addLog('✓ 登录成功');
                this.updateStep(1);
                
                await this.verifyAndLoadAccount(data.auth);
                
                const targetEmail = document.getElementById('target-email');
                if (targetEmail && !targetEmail.value) {
                    targetEmail.value = email;
                }
            } else {
                this.showStatus('error', data.message || '登录失败', 'login-status');
                this.addLog('✗ 登录失败: ' + (data.message || ''));
            }
        } catch (error) {
            this.showStatus('error', '网络错误', 'login-status');
            this.addLog('✗ 网络错误');
        } finally {
            this.isProcessing = false;
            this.updateButtonState('login-btn', false, '登录并验证账号');
        }
    }

    logout() {
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        localStorage.removeItem('jbcacc_auth');
        
        this.showElement('login-section');
        this.hideElement('clone-section');
        this.hideElement('account-info-section');
        this.hideElement('money-section');
        
        document.getElementById('source-email').value = '';
        document.getElementById('source-password').value = '';
        document.getElementById('account-name').textContent = '--';
        document.getElementById('account-money').textContent = '--';
        document.getElementById('account-green-cash').textContent = '--';
        document.getElementById('account-cars').textContent = '--';
        document.getElementById('account-localid').textContent = '--';
        
        const badge = document.getElementById('account-status');
        if (badge) { badge.textContent = '未登录'; badge.setAttribute('data-status', 'offline'); badge.style.color = '#e74c3c'; }
        
        this.addLog('已退出登录');
        this.updateStep(1);
    }

    // ==================== 刷新货币 ====================
    async refreshMoney() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录', 'money-status');
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });
            
            const data = await response.json();
            let accountData = null;
            
            if (data.data && typeof data.data === 'object') {
                accountData = data.data;
            } else if (data.result) {
                try { accountData = JSON.parse(data.result); } catch(e) {}
            }
            
            if (accountData) {
                this.displayAccountInfo(accountData);
                this.showStatus('success', '已刷新', 'money-status');
            }
        } catch (error) {
            this.showStatus('error', '刷新失败', 'money-status');
        }
    }

    // ==================== 修改货币 ====================
    async modifyMoney() {
        if (this.isProcessing || !this.sourceAuth) return;

        const operationType = document.querySelector('input[name="money-operation"]:checked')?.value;
        if (!operationType) {
            this.showStatus('error', '请选择操作类型', 'money-status');
            return;
        }

        let greenVal = '', goldVal = '';
        
        if (operationType === 'max') {
            if (!confirm('确认设置为最大值 999,999,999？')) return;
        } else {
            greenVal = document.getElementById('green-cash')?.value?.trim() || '';
            goldVal = document.getElementById('gold-coins')?.value?.trim() || '';
            
            if (!greenVal && !goldVal) {
                this.showStatus('error', '请至少输入一个数值', 'money-status');
                return;
            }
            
            if (!confirm(`确认修改货币？\n绿钞: ${greenVal || '不修改'}\n金币: ${goldVal || '不修改'}`)) return;
        }

        this.isProcessing = true;
        this.updateButtonState('modify-money-btn', true, '修改中...');
        this.clearStatusLog();
        this.addLog('开始修改货币...');

        try {
            if (operationType === 'max') {
                const res = await fetch(`${this.baseUrl}/api/max-money`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authToken: this.sourceAuth })
                });
                const data = await res.json();
                
                if (data.ok) {
                    this.addLog('✓ 已设置为最大值');
                    document.getElementById('account-green-cash').textContent = '999,999,999';
                    document.getElementById('account-money').textContent = '999,999,999';
                    this.showStatus('success', '修改成功！', 'money-status');
                } else {
                    throw new Error(data.message || '失败');
                }
            } else {
                if (greenVal) {
                    this.addLog('修改绿钞: ' + greenVal);
                    const res = await fetch(`${this.baseUrl}/api/modify-green-cash`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ authToken: this.sourceAuth, amount: Number(greenVal), operationType })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        this.addLog('✓ 绿钞修改成功');
                        if (data.details) {
                            document.getElementById('account-green-cash').textContent = this.formatNumber(data.details.newValue);
                        }
                    } else {
                        this.addLog('✗ 绿钞失败: ' + (data.message || ''));
                    }
                    await new Promise(r => setTimeout(r, 500));
                }
                
                if (goldVal) {
                    this.addLog('修改金币: ' + goldVal);
                    const res = await fetch(`${this.baseUrl}/api/modify-gold-coins`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ authToken: this.sourceAuth, amount: Number(goldVal), operationType })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        this.addLog('✓ 金币修改成功');
                        if (data.details) {
                            document.getElementById('account-money').textContent = this.formatNumber(data.details.newValue);
                        }
                    } else {
                        this.addLog('✗ 金币失败: ' + (data.message || ''));
                    }
                }
                
                this.showStatus('success', '修改完成！', 'money-status');
            }
            
            document.getElementById('green-cash').value = '';
            document.getElementById('gold-coins').value = '';
            
        } catch (error) {
            this.addLog('✗ 错误: ' + error.message);
            this.showStatus('error', error.message, 'money-status');
        } finally {
            this.isProcessing = false;
            this.updateButtonState('modify-money-btn', false, '确认修改货币');
        }
    }

    // ==================== 克隆/修改ID ====================
    async cloneAccount() {
        if (this.isProcessing || !this.sourceAuth) return;

        const operationType = document.querySelector('input[name="operation-type"]:checked')?.value;
        const customLocalId = document.getElementById('custom-localid')?.value?.trim();
        
        if (!customLocalId) {
            this.showStatus('error', '请输入Local ID', 'clone-status');
            return;
        }

        if (operationType === 'clone-to-new') {
            const targetEmail = document.getElementById('target-email')?.value?.trim();
            const targetPassword = document.getElementById('target-password')?.value;
            
            if (!targetEmail || !targetPassword) {
                this.showStatus('error', '请输入目标账号信息', 'clone-status');
                return;
            }
            
            if (!confirm(`确认克隆到 ${targetEmail}？`)) return;
            
            this.isProcessing = true;
            this.updateButtonState('clone-btn', true, '克隆中...');
            this.clearStatusLog();
            this.addLog('开始克隆...');
            
            try {
                const res = await fetch(`${this.baseUrl}/api/clone-account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sourceAuth: this.sourceAuth, targetEmail, targetPassword, customLocalId })
                });
                const data = await res.json();
                
                if (data.ok) {
                    this.addLog('✓ 克隆成功！');
                    this.showStatus('success', '克隆成功！', 'clone-status');
                    setTimeout(() => location.reload(), 3000);
                } else {
                    throw new Error(data.message || '克隆失败');
                }
            } catch (error) {
                this.addLog('✗ ' + error.message);
                this.showStatus('error', error.message, 'clone-status');
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '开始克隆');
            }
            
        } else {
            if (!confirm(`确认修改ID为 ${customLocalId}？`)) return;
            
            this.isProcessing = true;
            this.updateButtonState('clone-btn', true, '修改中...');
            this.clearStatusLog();
            this.addLog('开始修改ID...');
            
            try {
                const res = await fetch(`${this.baseUrl}/api/change-localid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authToken: this.sourceAuth, newLocalId: customLocalId })
                });
                const data = await res.json();
                
                if (data.ok) {
                    this.addLog('✓ ID修改成功！');
                    document.getElementById('account-localid').textContent = customLocalId;
                    this.showStatus('success', 'ID修改成功！', 'clone-status');
                    setTimeout(() => location.reload(), 3000);
                } else {
                    throw new Error(data.message || '修改失败');
                }
            } catch (error) {
                this.addLog('✗ ' + error.message);
                this.showStatus('error', error.message, 'clone-status');
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '修改当前账号ID');
            }
        }
    }

    // ==================== UI工具 ====================
    updateStep(n) {
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
                if (i < n) step.classList.add('completed');
                if (i === n) step.classList.add('active');
            }
        }
    }

    showStatus(type, message, elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = message;
        el.className = 'status ' + type;
        el.style.display = 'block';
        el.style.padding = '12px';
        el.style.borderRadius = '8px';
        el.style.marginTop = '10px';
        if (type === 'success') { el.style.background = '#d4edda'; el.style.color = '#155724'; }
        if (type === 'error') { el.style.background = '#f8d7da'; el.style.color = '#721c24'; }
        if (type === 'info') { el.style.background = '#d1ecf1'; el.style.color = '#0c5460'; }
    }

    addLog(message) {
        const container = document.getElementById('status-log');
        if (!container) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.style.padding = '8px 12px';
        entry.style.borderBottom = '1px solid #eee';
        entry.textContent = message;
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
    }

    clearStatusLog() {
        const container = document.getElementById('status-log');
        if (container) container.innerHTML = '';
    }

    updateProgress(message, pct) {
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-text');
        if (bar) bar.style.width = pct + '%';
        if (text) text.textContent = message;
    }

    updateButtonState(btnId, disabled, text) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = disabled;
        btn.innerHTML = disabled ? `<i class="fas fa-spinner fa-spin"></i> ${text}` : text;
        btn.style.opacity = disabled ? '0.7' : '1';
    }

    hideElement(id) {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
    }

    showElement(id) {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('hidden'); el.style.display = 'block'; }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new cpmcylone();
        app.init();
        console.log('✅ CPM工具箱 v11.0 启动成功');
    } catch (error) {
        console.error('初始化失败:', error);
    }
});
