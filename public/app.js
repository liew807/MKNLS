class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        this.accountLogs = [];
        console.log('cpmcy Clone 初始化成功. 基础URL:', this.baseUrl);
    }

    init() {
        this.bindEvents();
        this.checkSession();
        this.testConnection();
        this.initStepIndicator();
        this.initOperationType();
        this.initMoneyOperation();
        console.log('cpmcy Clone应用初始化成功');
    }

    // 检查会话
    checkSession() {
        const savedAuth = localStorage.getItem('jbcacc_auth');
        if (savedAuth) {
            this.sourceAuth = savedAuth;
            this.hideElement('login-section');
            this.showElement('clone-section');
            this.showElement('account-info-section');
            this.showElement('money-section');
            this.showStatus('info', '检测到上次登录会话，正在验证...', 'login-status');
            console.log('从localStorage恢复会话');
            
            this.verifyAndLoadAccount(savedAuth);
        }
    }

    // 测试连接
    async testConnection() {
        try {
            console.log('测试API连接...');
            const response = await fetch(`${this.baseUrl}/api/test`);
            const data = await response.json();
            console.log('API测试结果:', data);
            
            if (data.status === 'ok') {
                this.addLog('✓ API连接正常');
            } else {
                this.addLog('⚠ API连接测试失败');
            }
        } catch (error) {
            console.error('API连接测试失败:', error);
            this.addLog('⚠ API连接测试失败');
        }
    }

    // 初始化步骤指示器
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

    // 初始化操作类型
    initOperationType() {
        const operationRadios = document.querySelectorAll('input[name="operation-type"]');
        operationRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateOperationUI(e.target.value);
            });
        });
        
        this.updateOperationUI('modify-id');
    }

    // 更新操作UI
    updateOperationUI(operationType) {
        const targetCredentials = document.getElementById('target-credentials');
        const warning = document.querySelector('.warning');
        const cloneBtn = document.getElementById('clone-btn');
        
        if (operationType === 'modify-id') {
            this.hideElement('target-credentials');
            
            if (warning) {
                warning.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>警告：</strong> 这将修改当前账号的Local ID！请确保新ID的唯一性！
                `;
            }
            
            if (cloneBtn) {
                cloneBtn.innerHTML = '<i class="fas fa-user-edit"></i> 修改当前账号ID';
            }
            
        } else if (operationType === 'clone-to-new') {
            this.showElement('target-credentials');
            
            if (warning) {
                warning.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>警告：</strong> 这将覆盖目标账号的所有数据！请谨慎操作！
                `;
            }
            
            if (cloneBtn) {
                cloneBtn.innerHTML = '<i class="fas fa-clone"></i> 开始克隆';
            }
        }
    }

    // 初始化货币操作
    initMoneyOperation() {
        const moneyOpRadios = document.querySelectorAll('input[name="money-operation"]');
        moneyOpRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateMoneyOperationUI(e.target.value);
            });
        });
        
        this.updateMoneyOperationUI('set');
        
        const modifyMoneyBtn = document.getElementById('modify-money-btn');
        if (modifyMoneyBtn) {
            modifyMoneyBtn.addEventListener('click', () => this.modifyMoney());
        }
        
        const refreshMoneyBtn = document.getElementById('refresh-money-btn');
        if (refreshMoneyBtn) {
            refreshMoneyBtn.addEventListener('click', () => this.refreshMoney());
        }
    }

    // 更新货币操作UI
    updateMoneyOperationUI(operationType) {
        const greenCashInput = document.getElementById('green-cash');
        const goldCoinsInput = document.getElementById('gold-coins');
        
        if (operationType === 'max') {
            if (greenCashInput) greenCashInput.style.display = 'none';
            if (goldCoinsInput) goldCoinsInput.style.display = 'none';
        } else {
            if (greenCashInput) greenCashInput.style.display = 'block';
            if (goldCoinsInput) goldCoinsInput.style.display = 'block';
        }
    }

    // 刷新货币信息
    async refreshMoney() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'money-status');
            return;
        }

        try {
            this.showStatus('info', '正在刷新货币信息...', 'money-status');
            
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });
            
            const data = await response.json();
            if (data.ok && data.data) {
                const greenCash = data.data.greenCash || data.data.green_cash || data.data.cash || 0;
                const goldCoins = data.data.goldCoins || data.data.gold_coins || data.data.coins || 0;
                
                if (document.getElementById('account-green-cash')) {
                    document.getElementById('account-green-cash').textContent = this.formatNumber(greenCash);
                }
                if (document.getElementById('account-money')) {
                    document.getElementById('account-money').textContent = this.formatNumber(goldCoins);
                }
                
                this.showStatus('success', '货币信息已刷新', 'money-status');
                this.addLog('✓ 货币信息已刷新');
            }
        } catch (error) {
            console.error('刷新货币信息失败:', error);
            this.showStatus('error', '刷新货币信息失败', 'money-status');
        }
    }

    // 绑定事件
    bindEvents() {
        const loginBtn = document.getElementById('login-btn');
        const cloneBtn = document.getElementById('clone-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.login());
        }
        
        if (cloneBtn) {
            cloneBtn.addEventListener('click', () => this.cloneAccount());
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
        
        this.bindMoneyEvents();
        this.bindLogsEvents();
        this.bindKeyboardEvents();
    }

    // 绑定货币事件
    bindMoneyEvents() {
        const modifyMoneyBtn = document.getElementById('modify-money-btn');
        const refreshMoneyBtn = document.getElementById('refresh-money-btn');
        const greenCashInput = document.getElementById('green-cash');
        const goldCoinsInput = document.getElementById('gold-coins');
        
        if (modifyMoneyBtn) {
            modifyMoneyBtn.addEventListener('click', () => this.modifyMoney());
        }
        
        if (refreshMoneyBtn) {
            refreshMoneyBtn.addEventListener('click', () => this.refreshMoney());
        }
        
        if (greenCashInput && goldCoinsInput) {
            greenCashInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    goldCoinsInput.focus();
                }
            });
            
            goldCoinsInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.modifyMoney();
                }
            });
        }
    }

    // 绑定日志事件
    bindLogsEvents() {
        const refreshLogsBtn = document.getElementById('refresh-logs-btn');
        const exportLogsBtn = document.getElementById('export-logs-btn');
        const logsFilterType = document.getElementById('logs-filter-type');
        const logsSearch = document.getElementById('logs-search');
        
        if (refreshLogsBtn) {
            refreshLogsBtn.addEventListener('click', () => this.loadAccountLogs());
        }
        
        if (exportLogsBtn) {
            exportLogsBtn.addEventListener('click', () => this.exportLogs());
        }
        
        if (logsFilterType) {
            logsFilterType.addEventListener('change', () => this.filterLogs());
        }
        
        if (logsSearch) {
            logsSearch.addEventListener('input', () => this.filterLogs());
        }
    }

    // 绑定键盘事件
    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'l' && !e.target.matches('input, textarea, select')) {
                e.preventDefault();
                const loginSection = document.getElementById('login-section');
                if (loginSection && !loginSection.classList.contains('hidden')) {
                    this.login();
                } else if (this.sourceAuth) {
                    this.logout();
                }
            }
            
            if (e.ctrlKey && e.key === 'r' && this.sourceAuth && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.loadAccountLogs();
            }
            
            if (e.key === 'Escape' && this.sourceAuth) {
                this.logout();
            }
        });
    }

    // 验证并加载账号
    async verifyAndLoadAccount(authToken) {
        try {
            this.updateStep(1);
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            if (data.ok) {
                this.sourceAccountInfo = data.data;
                this.displayAccountInfo(data.data);
                this.showStatus('success', '会话验证成功！', 'login-status');
                this.updateStep(2);
                
                await this.loadCarsCount(authToken);
                setTimeout(() => {
                    this.loadAccountLogs();
                }, 1000);
            } else {
                this.logout();
                this.showStatus('error', '会话已过期，请重新登录', 'login-status');
            }
        } catch (error) {
            console.log('会话验证失败:', error);
            this.logout();
        }
    }

    // 加载车辆数量
    async loadCarsCount(authToken) {
        try {
            const response = await fetch(`${this.baseUrl}/api/get-all-cars`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            if (data.ok && Array.isArray(data.data)) {
                const carsCount = data.data.length;
                document.getElementById('account-cars').textContent = carsCount;
            }
        } catch (error) {
            console.log('获取车辆数量失败:', error);
        }
    }

    // 显示账号信息
    displayAccountInfo(accountData) {
        if (!accountData) return;
        
        const name = accountData.Name || accountData.username || '未知';
        document.getElementById('account-name').textContent = name;
        
        const goldCoins = accountData.goldCoins || accountData.gold_coins || accountData.coins || accountData.money || 0;
        document.getElementById('account-money').textContent = this.formatNumber(goldCoins);
        
        const greenCash = accountData.greenCash || accountData.green_cash || accountData.cash || 0;
        document.getElementById('account-green-cash').textContent = this.formatNumber(greenCash);
        
        const localID = accountData.localID || accountData.localId || '未知';
        document.getElementById('account-localid').textContent = localID;
        
        const statusBadge = document.getElementById('account-status');
        statusBadge.textContent = '已登录';
        statusBadge.setAttribute('data-status', 'online');
    }

    // 格式化数字
    formatNumber(num) {
        return Number(num).toLocaleString('zh-CN');
    }

    // 更新步骤
    updateStep(stepNumber) {
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
            }
        }

        for (let i = 1; i <= stepNumber; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                if (i < stepNumber) {
                    step.classList.add('completed');
                } else {
                    step.classList.add('active');
                }
            }
        }
    }

    // 登录
    async login() {
        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'login-status');
            return;
        }

        const emailInput = document.getElementById('source-email');
        const passwordInput = document.getElementById('source-password');
        
        if (!emailInput || !passwordInput) {
            console.error('邮箱或密码输入框未找到');
            return;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            this.showStatus('error', '请输入邮箱和密码', 'login-status');
            return;
        }

        if (!email.includes('@') || !email.includes('.')) {
            this.showStatus('error', '请输入有效的邮箱地址', 'login-status');
            return;
        }

        this.isProcessing = true;
        this.updateButtonState('login-btn', true, '验证中...');
        this.showStatus('info', '正在连接服务器...', 'login-status');
        this.addLog('正在登录账号...');

        try {
            const response = await fetch(`${this.baseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.ok) {
                this.sourceAuth = data.auth;
                this.sourceAccountInfo = null;
                localStorage.setItem('jbcacc_auth', data.auth);
                this.showStatus('success', '登录成功！正在获取账号信息...', 'login-status');
                this.hideElement('login-section');
                this.showElement('clone-section');
                this.showElement('account-info-section');
                this.showElement('money-section');
                this.updateProgress('登录成功', 25);
                this.addLog('✓ 登录成功');
                this.updateStep(1);
                
                await this.verifyAndLoadAccount(data.auth);
                
                setTimeout(() => {
                    this.loadAccountLogs();
                }, 1500);
                
                const targetEmailInput = document.getElementById('target-email');
                if (targetEmailInput && !targetEmailInput.value) {
                    targetEmailInput.value = email;
                    targetEmailInput.focus();
                }
                
            } else {
                let errorMsg = data.message || '登录失败';
                if (data.error === 100) errorMsg = '邮箱未找到';
                if (data.error === 101) errorMsg = '密码错误';
                
                this.showStatus('error', `登录失败: ${errorMsg}`, 'login-status');
                this.addLog(`✗ 登录失败: ${errorMsg}`);
                
                if (data.error === 101) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        } catch (error) {
            console.error('登录错误:', error);
            this.showStatus('error', `网络错误: ${error.message}`, 'login-status');
            this.addLog(`✗ 网络错误: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('login-btn', false, '登录并验证账号');
        }
    }

    // 退出登录
    logout() {
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.accountLogs = [];
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
        
        const statusBadge = document.getElementById('account-status');
        statusBadge.textContent = '未登录';
        statusBadge.setAttribute('data-status', 'offline');
        
        this.showLogsMessage('请先登录账号查看日志');
        document.getElementById('logs-total').textContent = '0';
        document.getElementById('logs-last-login').textContent = '--';
        document.getElementById('logs-login-count').textContent = '0';
        
        this.showStatus('info', '已退出登录', 'login-status');
        this.addLog('已退出登录');
        this.updateStep(1);
    }

    // 克隆账号
    async cloneAccount() {
        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'clone-status');
            return;
        }

        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录源账号', 'clone-status');
            this.addLog('✗ 未找到认证令牌');
            return;
        }

        const operationType = document.querySelector('input[name="operation-type"]:checked').value;
        const customLocalId = document.getElementById('custom-localid').value.trim();
        
        if (!customLocalId) {
            this.showStatus('error', '请输入自定义的Local ID', 'clone-status');
            return;
        }

        if (operationType === 'clone-to-new') {
            const targetEmailInput = document.getElementById('target-email');
            const targetPasswordInput = document.getElementById('target-password');
            
            if (!targetEmailInput || !targetPasswordInput) {
                console.error('目标邮箱或密码输入框未找到');
                return;
            }

            const targetEmail = targetEmailInput.value.trim();
            const targetPassword = targetPasswordInput.value;

            if (!targetEmail || !targetPassword) {
                this.showStatus('error', '请输入目标账号的凭据', 'clone-status');
                return;
            }

            if (!targetEmail.includes('@') || !targetEmail.includes('.')) {
                this.showStatus('error', '请输入有效的目标邮箱地址', 'clone-status');
                return;
            }

            const confirmMessage = `⚠️ 警告：这将完全覆盖目标账号的所有数据！\n\n` +
                                  `目标账号: ${targetEmail}\n` +
                                  `新Local ID: ${customLocalId}\n\n` +
                                  `源账号车辆: ${document.getElementById('account-cars').textContent} 辆\n` +
                                  `源账号金币: ${document.getElementById('account-money').textContent}\n\n` +
                                  `你确定要继续吗？`;
            
            if (!confirm(confirmMessage)) {
                this.addLog('✗ 用户取消操作');
                return;
            }

            this.isProcessing = true;
            this.startTime = Date.now();
            this.updateButtonState('clone-btn', true, '克隆中...');
            this.clearStatusLog();
            this.updateProgress('开始克隆流程...', 5);
            this.updateTimeEstimate();
            this.addLog('开始克隆到新账号...');
            this.addLog(`新Local ID: ${customLocalId}`);
            this.updateStep(3);

            this.cloneTimeout = setTimeout(() => {
                if (this.isProcessing) {
                    this.addLog('⚠ 克隆请求超时，但可能仍在后台处理中...');
                    this.updateTimeEstimate('超时，但可能仍在处理');
                }
            }, 120000);

            try {
                this.addLog('1. 正在向服务器发送克隆请求...');
                this.updateProgress('正在发送请求到服务器...', 10);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 180000);
                
                const response = await fetch(`${this.baseUrl}/api/clone-account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceAuth: this.sourceAuth,
                        targetEmail: targetEmail,
                        targetPassword: targetPassword,
                        customLocalId: customLocalId
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                this.updateProgress('正在处理克隆请求...', 30);
                
                const data = await response.json();

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('克隆完成！', 100);
                    this.addLog('✓ 克隆成功！');
                    this.addLog(`目标账号: ${targetEmail}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `账号克隆成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    targetEmailInput.value = '';
                    targetPasswordInput.value = '';
                    document.getElementById('custom-localid').value = '';
                    
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    let errorMsg = data.message || '克隆失败，未知错误';
                    throw new Error(errorMsg);
                }

            } catch (error) {
                clearTimeout(this.cloneTimeout);
                console.error('克隆错误:', error);
                
                this.addLog(`✗ 错误: ${error.message}`);
                this.showStatus('error', `克隆失败: ${error.message}`, 'clone-status');
                
                this.updateProgress('克隆中断', 0);
                this.updateTimeEstimate('已中断');
                this.showErrorAnimation();
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '开始克隆');
            }
            
        } else if (operationType === 'modify-id') {
            const currentLocalId = document.getElementById('account-localid').textContent;
            const confirmMessage = `⚠️ 确认修改当前账号Local ID？\n\n` +
                                  `当前Local ID: ${currentLocalId}\n` +
                                  `新的Local ID: ${customLocalId}\n\n` +
                                  `此操作会更新所有车辆数据中的Local ID引用。`;
            
            if (!confirm(confirmMessage)) {
                this.addLog('✗ 用户取消操作');
                return;
            }

            this.isProcessing = true;
            this.startTime = Date.now();
            this.updateButtonState('clone-btn', true, '修改中...');
            this.clearStatusLog();
            this.updateProgress('开始修改ID流程...', 5);
            this.updateTimeEstimate();
            this.addLog('开始修改当前账号ID...');
            this.addLog(`新Local ID: ${customLocalId}`);
            this.updateStep(3);

            this.cloneTimeout = setTimeout(() => {
                if (this.isProcessing) {
                    this.addLog('⚠ 修改请求超时，但可能仍在后台处理中...');
                    this.updateTimeEstimate('超时，但可能仍在处理');
                }
            }, 120000);

            try {
                this.addLog('1. 正在向服务器发送修改请求...');
                this.updateProgress('正在发送请求到服务器...', 10);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 180000);
                
                const response = await fetch(`${this.baseUrl}/api/change-localid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        authToken: this.sourceAuth,
                        newLocalId: customLocalId
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                this.updateProgress('正在处理修改请求...', 30);
                
                const data = await response.json();

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('修改完成！', 100);
                    this.addLog('✓ ID修改成功！');
                    this.addLog(`旧Local ID: ${currentLocalId}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `ID修改成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    document.getElementById('account-localid').textContent = customLocalId;
                    document.getElementById('custom-localid').value = '';
                    
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    let errorMsg = data.message || '修改失败，未知错误';
                    throw new Error(errorMsg);
                }

            } catch (error) {
                clearTimeout(this.cloneTimeout);
                console.error('修改错误:', error);
                
                this.addLog(`✗ 错误: ${error.message}`);
                this.showStatus('error', `修改失败: ${error.message}`, 'clone-status');
                
                this.updateProgress('修改中断', 0);
                this.updateTimeEstimate('已中断');
                this.showErrorAnimation();
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '修改当前账号ID');
            }
        }
    }

    // 修改货币
    async modifyMoney() {
        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'money-status');
            return;
        }

        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'money-status');
            this.addLog('✗ 未找到认证令牌');
            return;
        }

        const operationType = document.querySelector('input[name="money-operation"]:checked')?.value;
        if (!operationType) {
            this.showStatus('error', '请选择操作类型', 'money-status');
            return;
        }

        let greenCashValue, goldCoinsValue;
        
        if (operationType === 'max') {
            greenCashValue = 999999999;
            goldCoinsValue = 999999999;
        } else {
            const greenCashInput = document.getElementById('green-cash');
            const goldCoinsInput = document.getElementById('gold-coins');
            
            if (operationType === 'set' || operationType === 'add') {
                greenCashValue = greenCashInput?.value.trim();
                goldCoinsValue = goldCoinsInput?.value.trim();
                
                if ((!greenCashValue && !goldCoinsValue) || 
                    (greenCashValue === '' && goldCoinsValue === '')) {
                    this.showStatus('error', '请至少输入一种货币的数值', 'money-status');
                    return;
                }
            }
            
            if (greenCashValue && (isNaN(greenCashValue) || greenCashValue < 0)) {
                this.showStatus('error', '绿钞值必须是非负数字', 'money-status');
                return;
            }
            
            if (goldCoinsValue && (isNaN(goldCoinsValue) || goldCoinsValue < 0)) {
                this.showStatus('error', '金币值必须是非负数字', 'money-status');
                return;
            }
            
            if (greenCashValue) greenCashValue = parseInt(greenCashValue);
            if (goldCoinsValue) goldCoinsValue = parseInt(goldCoinsValue);
        }

        const confirmMessage = operationType === 'max' ? 
            '⚠️ 确认将绿钞和金币都设置为最大值 999,999,999？' :
            `⚠️ 确认修改货币？\n\n操作类型: ${operationType === 'set' ? '设置为' : '增加'}\n` +
            `${greenCashValue ? `绿钞: ${this.formatNumber(greenCashValue)}\n` : ''}` +
            `${goldCoinsValue ? `金币: ${this.formatNumber(goldCoinsValue)}` : ''}`;
        
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消货币修改操作');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('modify-money-btn', true, '修改中...');
        this.clearStatusLog();
        this.updateProgress('开始修改货币...', 5);
        this.updateTimeEstimate();
        this.addLog('开始修改货币...');
        this.addLog(`操作类型: ${operationType}`);

        this.cloneTimeout = setTimeout(() => {
            if (this.isProcessing) {
                this.addLog('⚠ 修改请求超时，但可能仍在后台处理中...');
                this.updateTimeEstimate('超时，但可能仍在处理');
            }
        }, 60000);

        try {
            this.addLog('1. 正在向服务器发送货币修改请求...');
            this.updateProgress('正在发送请求到服务器...', 10);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            
            const response = await fetch(`${this.baseUrl}/api/modify-money`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    authToken: this.sourceAuth,
                    greenCash: greenCashValue,
                    goldCoins: goldCoinsValue,
                    operationType: operationType
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            this.updateProgress('正在处理货币修改请求...', 30);
            
            const data = await response.json();

            clearTimeout(this.cloneTimeout);

            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('货币修改完成！', 100);
                this.addLog('✓ 货币修改成功！');
                
                if (operationType === 'max') {
                    this.addLog('绿钞已设置为最大值: 999,999,999');
                    this.addLog('金币已设置为最大值: 999,999,999');
                } else {
                    if (greenCashValue) {
                        this.addLog(`绿钞: ${operationType === 'set' ? '设置为' : '增加'} ${this.formatNumber(greenCashValue)}`);
                    }
                    if (goldCoinsValue) {
                        this.addLog(`金币: ${operationType === 'set' ? '设置为' : '增加'} ${this.formatNumber(goldCoinsValue)}`);
                    }
                }
                
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `货币修改成功！耗时 ${elapsedTime} 秒`, 'money-status');
                this.updateTimeEstimate('已完成');
                
                this.showSuccessAnimation();
                
                await this.refreshMoney();
                
                if (operationType !== 'max') {
                    const greenCashInput = document.getElementById('green-cash');
                    const goldCoinsInput = document.getElementById('gold-coins');
                    if (greenCashInput) greenCashInput.value = '';
                    if (goldCoinsInput) goldCoinsInput.value = '';
                }
                
                this.addLog('3秒后刷新页面...');
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            } else {
                let errorMsg = data.message || '货币修改失败，未知错误';
                throw new Error(errorMsg);
            }

        } catch (error) {
            clearTimeout(this.cloneTimeout);
            console.error('货币修改错误:', error);
            
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `货币修改失败: ${error.message}`, 'money-status');
            
            this.updateProgress('修改中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('modify-money-btn', false, '确认修改货币');
        }
    }

    // 更新时间估计
    updateTimeEstimate(text) {
        const timeEstimate = document.getElementById('time-estimate');
        if (!timeEstimate) return;
        
        if (text) {
            timeEstimate.textContent = `预计时间: ${text}`;
        } else if (this.startTime && this.isProcessing) {
            const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            timeEstimate.textContent = `已用时: ${minutes}分${seconds}秒`;
        }
    }

    // 显示成功动画
    showSuccessAnimation() {
        try {
            const successDiv = document.createElement('div');
            successDiv.innerHTML = '✓';
            successDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 80px;
                color: #2ecc71;
                z-index: 1000;
                animation: successPulse 1.5s ease-out;
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes successPulse {
                    0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
                    50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
                    100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(successDiv);
            
            setTimeout(() => {
                document.body.removeChild(successDiv);
            }, 1500);
        } catch (e) {
            console.log('无法显示成功动画');
        }
    }

    // 显示错误动画
    showErrorAnimation() {
        try {
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = '✗';
            errorDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 80px;
                color: #e74c3c;
                z-index: 1000;
                animation: errorShake 0.5s ease-out;
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes errorShake {
                    0%, 100% { transform: translate(-50%, -50%) translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translate(-50%, -50%) translateX(-5px); }
                    20%, 40%, 60%, 80% { transform: translate(-50%, -50%) translateX(5px); }
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(errorDiv);
            
            setTimeout(() => {
                document.body.removeChild(errorDiv);
            }, 1000);
        } catch (e) {
            console.log('无法显示错误动画');
        }
    }

    // 显示状态
    showStatus(type, message, elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`未找到元素: ${elementId}`);
            return;
        }
        
        element.textContent = message;
        element.className = `status ${type}`;
        element.style.display = 'block';
        
        if (type === 'success') {
            setTimeout(() => {
                element.style.display = 'none';
            }, 5000);
        }
        
        console.log(`${type.toUpperCase()}: ${message}`);
    }

    // 添加日志
    addLog(message) {
        const logContainer = document.getElementById('status-log');
        if (!logContainer) {
            console.log('日志:', message);
            return;
        }
        
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        
        let iconClass = 'fa-info-circle';
        if (message.startsWith('✓')) iconClass = 'fa-check-circle';
        else if (message.startsWith('✗')) iconClass = 'fa-times-circle';
        else if (message.startsWith('⚠')) iconClass = 'fa-exclamation-triangle';
        else if (/^\d+\./.test(message)) iconClass = 'fa-arrow-right';
        
        logEntry.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        console.log('日志:', message);
        
        if (this.isProcessing) {
            this.updateTimeEstimate();
        }
    }

    // 清除状态日志
    clearStatusLog() {
        const logContainer = document.getElementById('status-log');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    // 更新进度
    updateProgress(message, percentage) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        
        if (progressBar) {
            progressBar.style.width = `${percentage}%`;
            progressBar.style.transition = 'width 0.5s ease';
            
            if (percentage < 30) {
                progressBar.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
            } else if (percentage < 70) {
                progressBar.style.background = 'linear-gradient(135deg, #f39c12 0%, #d35400 100%)';
            } else if (percentage < 100) {
                progressBar.style.background = 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)';
            } else {
                progressBar.style.background = 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)';
            }
        }
        
        if (progressText) {
            progressText.textContent = message;
            progressText.style.fontWeight = 'bold';
        }
    }

    // 更新按钮状态
    updateButtonState(buttonId, disabled, text) {
        const button = document.getElementById(buttonId);
        if (!button) {
            console.error(`未找到按钮: ${buttonId}`);
            return;
        }
        
        button.disabled = disabled;
        if (disabled) {
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
            button.style.opacity = '0.7';
            button.style.cursor = 'not-allowed';
        } else {
            let icon = 'fa-key';
            if (buttonId === 'clone-btn') {
                const operationType = document.querySelector('input[name="operation-type"]:checked')?.value;
                icon = operationType === 'modify-id' ? 'fa-user-edit' : 'fa-clone';
            } else if (buttonId === 'modify-money-btn') {
                icon = 'fa-coins';
            } else if (buttonId === 'logout-btn') {
                icon = 'fa-sign-out-alt';
            } else if (buttonId === 'refresh-logs-btn') {
                icon = 'fa-sync-alt';
            } else if (buttonId === 'export-logs-btn') {
                icon = 'fa-download';
            }
            
            button.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    }

    // 隐藏元素
    hideElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.add('hidden');
            element.style.display = 'none';
        }
    }

    // 显示元素
    showElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('hidden');
            element.style.display = 'block';
        }
    }

    // ==================== 日志功能 ====================

    // 加载账号日志
    async loadAccountLogs() {
        if (!this.sourceAuth) {
            this.showLogsMessage('请先登录账号查看日志');
            this.showStatus('error', '请先登录账号', 'logs-status');
            return;
        }

        try {
            this.showLogsLoading(true);
            this.showStatus('info', '正在获取账号日志...', 'logs-status');
            
            const response = await fetch(`${this.baseUrl}/api/get-account-logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    authToken: this.sourceAuth,
                    limit: 1000
                })
            });
            
            const data = await response.json();
            
            if (data.ok && Array.isArray(data.logs)) {
                this.accountLogs = data.logs;
                this.updateLogsDisplay();
                this.showStatus('success', `已加载 ${this.accountLogs.length} 条日志`, 'logs-status');
                this.addLog(`已加载账号日志: ${this.accountLogs.length} 条`);
                
                localStorage.setItem('cpmcy_last_logs', JSON.stringify({
                    timestamp: Date.now(),
                    count: this.accountLogs.length
                }));
                
            } else if (data.error === 404) {
                this.showStatus('warning', '日志API未启用，使用演示数据', 'logs-status');
                this.generateDemoLogs();
                this.updateLogsDisplay();
                this.addLog('使用演示日志数据');
                
            } else {
                throw new Error(data.message || '获取日志失败');
            }
        } catch (error) {
            console.error('获取账号日志失败:', error);
            this.showStatus('error', `获取日志失败: ${error.message}`, 'logs-status');
            this.showLogsMessage('获取日志失败，请重试');
            this.accountLogs = [];
            this.updateLogsDisplay();
        } finally {
            this.showLogsLoading(false);
        }
    }

    // 更新日志显示
    updateLogsDisplay() {
        const logsBody = document.getElementById('logs-body');
        const logsTotal = document.getElementById('logs-total');
        const logsLastLogin = document.getElementById('logs-last-login');
        const logsLoginCount = document.getElementById('logs-login-count');
        
        if (!logsBody) return;
        
        logsTotal.textContent = this.accountLogs.length;
        
        const loginLogs = this.accountLogs.filter(log => 
            log.type === 'login' || 
            (log.message && log.message.toLowerCase().includes('login'))
        );
        
        logsLoginCount.textContent = loginLogs.length;
        
        if (loginLogs.length > 0) {
            const latestLogin = loginLogs[0];
            logsLastLogin.textContent = this.formatLogTime(latestLogin.timestamp);
        } else if (this.accountLogs.length > 0) {
            logsLastLogin.textContent = this.formatLogTime(this.accountLogs[0].timestamp);
        } else {
            logsLastLogin.textContent = '--';
        }
        
        if (this.accountLogs.length === 0) {
            logsBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-logs">
                        <i class="fas fa-info-circle"></i>
                        没有日志数据
                    </td>
                </tr>
            `;
            return;
        }
        
        logsBody.innerHTML = '';
        
        const sortedLogs = [...this.accountLogs].sort((a, b) => {
            return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        });
        
        sortedLogs.forEach(log => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td class="log-time">${this.formatLogTime(log.timestamp)}</td>
                <td><span class="log-type log-type-${log.type || 'info'}">${this.getLogTypeText(log.type)}</span></td>
                <td class="log-message">${log.message || '无内容'}</td>
                <td class="log-ip">${log.ip || '--'}</td>
                <td class="log-device">${log.device || '--'}</td>
            `;
            
            row.addEventListener('click', () => {
                this.showLogDetails(log);
            });
            
            row.style.cursor = 'pointer';
            logsBody.appendChild(row);
        });
    }

    // 过滤日志
    filterLogs() {
        const filterType = document.getElementById('logs-filter-type')?.value || 'all';
        const searchText = document.getElementById('logs-search')?.value.toLowerCase() || '';
        
        const logsBody = document.getElementById('logs-body');
        if (!logsBody || this.accountLogs.length === 0) return;
        
        const filteredLogs = this.accountLogs.filter(log => {
            if (filterType !== 'all' && log.type !== filterType) {
                return false;
            }
            
            if (searchText) {
                const messageMatch = log.message?.toLowerCase().includes(searchText) || false;
                const ipMatch = log.ip?.toLowerCase().includes(searchText) || false;
                const deviceMatch = log.device?.toLowerCase().includes(searchText) || false;
                
                if (!messageMatch && !ipMatch && !deviceMatch) {
                    return false;
                }
            }
            
            return true;
        });
        
        if (filteredLogs.length === 0) {
            logsBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-logs">
                        <i class="fas fa-search"></i>
                        没有找到匹配的日志
                    </td>
                </tr>
            `;
            document.getElementById('logs-total').textContent = '0';
        } else {
            logsBody.innerHTML = '';
            
            const sortedLogs = [...filteredLogs].sort((a, b) => {
                return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            });
            
            sortedLogs.forEach(log => {
                const row = document.createElement('tr');
                
                row.innerHTML = `
                    <td class="log-time">${this.formatLogTime(log.timestamp)}</td>
                    <td><span class="log-type log-type-${log.type || 'info'}">${this.getLogTypeText(log.type)}</span></td>
                    <td class="log-message">${log.message || '无内容'}</td>
                    <td class="log-ip">${log.ip || '--'}</td>
                    <td class="log-device">${log.device || '--'}</td>
                `;
                
                row.addEventListener('click', () => {
                    this.showLogDetails(log);
                });
                
                row.style.cursor = 'pointer';
                logsBody.appendChild(row);
            });
            
            document.getElementById('logs-total').textContent = filteredLogs.length;
        }
    }

    // 导出日志
    exportLogs() {
        if (this.accountLogs.length === 0) {
            alert('没有日志可以导出！');
            return;
        }
        
        try {
            let csvContent = '时间,类型,内容,IP地址,设备\n';
            
            const sortedLogs = [...this.accountLogs].sort((a, b) => {
                return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            });
            
            sortedLogs.forEach(log => {
                const row = [
                    this.formatLogTime(log.timestamp),
                    this.getLogTypeText(log.type),
                    `"${(log.message || '').replace(/"/g, '""')}"`,
                    log.ip || '',
                    log.device || ''
                ];
                
                csvContent += row.join(',') + '\n';
            });
            
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
            link.setAttribute('href', url);
            link.setAttribute('download', `cpm_account_logs_${timestamp}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            setTimeout(() => {
                alert(`日志导出完成！共 ${this.accountLogs.length} 条记录`);
                this.addLog(`已导出 ${this.accountLogs.length} 条日志到CSV文件`);
            }, 100);
            
        } catch (error) {
            console.error('导出日志失败:', error);
            alert('导出日志失败: ' + error.message);
            this.showStatus('error', '导出日志失败', 'logs-status');
        }
    }

    // 显示日志详情
    showLogDetails(log) {
        const detailText = `
            日志详情:
            
            时间: ${this.formatLogTime(log.timestamp)}
            类型: ${this.getLogTypeText(log.type)}
            内容: ${log.message || '无内容'}
            IP地址: ${log.ip || '--'}
            设备: ${log.device || '--'}
            
            原始数据:
            ${JSON.stringify(log, null, 2)}
        `;
        
        if (window.confirm('查看日志详情？\n\n点击确定查看完整详情')) {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                z-index: 10000;
                display: flex;
                justify-content: center;
                align-items: center;
            `;
            
            modal.innerHTML = `
                <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 10px; max-width: 800px; max-height: 80vh; overflow: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3 style="margin: 0;">日志详情</h3>
                        <button onclick="this.parentElement.parentElement.remove()" style="background: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">关闭</button>
                    </div>
                    <pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 12px;">${detailText}</pre>
                </div>
            `;
            
            document.body.appendChild(modal);
        }
    }

    // 显示日志加载状态
    showLogsLoading(isLoading) {
        const logsBody = document.getElementById('logs-body');
        if (!logsBody) return;
        
        if (isLoading) {
            logsBody.innerHTML = `
                <tr>
                    <td colspan="5" class="loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        正在加载日志...
                    </td>
                </tr>
            `;
        }
    }

    // 显示日志消息
    showLogsMessage(message) {
        const logsBody = document.getElementById('logs-body');
        if (!logsBody) return;
        
        logsBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-logs">
                    <i class="fas fa-info-circle"></i>
                    ${message}
                </td>
            </tr>
        `;
    }

    // 格式化日志时间
    formatLogTime(timestamp) {
        if (!timestamp) return '--';
        
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '无效时间';
            
            const now = new Date();
            
            if (date.toDateString() === now.toDateString()) {
                return date.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
            
            if (date.getFullYear() === now.getFullYear()) {
                return date.toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
            
            return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return '时间格式错误';
        }
    }

    // 获取日志类型文本
    getLogTypeText(type) {
        const typeMap = {
            'login': '登录',
            'logout': '登出',
            'game': '游戏',
            'purchase': '购买',
            'error': '错误',
            'system': '系统',
            'info': '信息',
            'warning': '警告',
            'trade': '交易',
            'chat': '聊天',
            'security': '安全'
        };
        
        return typeMap[type] || type || '信息';
    }

    // 生成演示日志数据
    generateDemoLogs() {
        const logTypes = ['login', 'game', 'purchase', 'system', 'info'];
        const logMessages = {
            'login': ['用户登录成功', '账号安全登录', '异地登录检测', '登录验证通过'],
            'game': ['完成比赛获得第一名', '打破个人记录', '加入多人游戏', '完成每日任务'],
            'purchase': ['购买车辆 Lamborghini', '充值100绿钞', '购买道具 Turbo Boost', '解锁新地图'],
            'system': ['账号数据备份', '系统更新完成', '安全检查通过', '数据同步成功'],
            'info': ['欢迎回到游戏', '收到好友请求', '系统公告', '新版本可用']
        };
        
        this.accountLogs = [];
        const now = new Date();
        
        for (let i = 0; i < 30; i++) {
            const type = logTypes[Math.floor(Math.random() * logTypes.length)];
            const messageIndex = Math.floor(Math.random() * logMessages[type].length);
            
            const timestamp = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
            
            this.accountLogs.push({
                timestamp: timestamp.toISOString(),
                type: type,
                message: logMessages[type][messageIndex],
                ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
                device: ['Windows PC', 'Android Phone', 'iOS Device', 'Mac'][Math.floor(Math.random() * 4)]
            });
        }
    }
}

// DOM加载事件
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成');
    
    try {
        const app = new cpmcylone();
        app.init();
        console.log('cpmcy Clone应用初始化成功');
        console.log('应用版本: 2.4 (完整日志功能)');
        console.log('环境:', window.location.origin.includes('localhost') ? '开发环境' : '生产环境');
        
        // 自动刷新日志（每5分钟）
        setInterval(() => {
            if (app.sourceAuth && document.visibilityState === 'visible') {
                console.log('自动刷新账号日志...');
                app.loadAccountLogs();
            }
        }, 5 * 60 * 1000);
        
    } catch (error) {
        console.error('应用初始化失败:', error);
        
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #e74c3c;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            max-width: 500px;
            text-align: center;
        `;
        errorDiv.innerHTML = `
            <strong>应用错误</strong><br>
            应用初始化失败，请刷新页面。<br>
            <small>错误: ${error.message}</small>
        `;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            document.body.removeChild(errorDiv);
        }, 10000);
    }
});
