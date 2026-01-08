class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        console.log('cpmcy Clone 初始化成功. 基础URL:', this.baseUrl);
    }

    init() {
        this.bindEvents();
        this.checkSession();
        this.testConnection();
        this.initStepIndicator();
        this.initOperationType();
        this.initMoneyOperation();
        this.bindNewFunctionButtons();
    }

    // 新增：绑定所有新功能按钮
    bindNewFunctionButtons() {
        // W16引擎解锁
        const unlockW16Btn = document.getElementById('unlock-w16-btn');
        if (unlockW16Btn) {
            unlockW16Btn.addEventListener('click', () => this.unlockW16Engine());
        }

        // 解锁付费房屋
        const unlockHousesBtn = document.getElementById('unlock-houses-btn');
        if (unlockHousesBtn) {
            unlockHousesBtn.addEventListener('click', () => this.unlockPremiumHouses());
        }

        // 解锁烟雾效果
        const unlockSmokesBtn = document.getElementById('unlock-smokes-btn');
        if (unlockSmokesBtn) {
            unlockSmokesBtn.addEventListener('click', () => this.unlockSmokes());
        }

        // 解锁无限油
        const unlockFuelBtn = document.getElementById('unlock-fuel-btn');
        if (unlockFuelBtn) {
            unlockFuelBtn.addEventListener('click', () => this.unlockUnlimitedFuel());
        }

        // 解锁无伤模式
        const unlockGodmodeBtn = document.getElementById('unlock-godmode-btn');
        if (unlockGodmodeBtn) {
            unlockGodmodeBtn.addEventListener('click', () => this.unlockGodMode());
        }

        // 修改胜场数
        const modifyWinsBtn = document.getElementById('modify-wins-btn');
        if (modifyWinsBtn) {
            modifyWinsBtn.addEventListener('click', () => this.modifyWins());
        }

        // 修改名字
        const changeNameBtn = document.getElementById('change-name-btn');
        if (changeNameBtn) {
            changeNameBtn.addEventListener('click', () => this.changeName());
        }

        // 一键全解锁
        const unlockAllBtn = document.getElementById('unlock-all-btn');
        if (unlockAllBtn) {
            unlockAllBtn.addEventListener('click', () => this.unlockAll());
        }

        console.log('新功能按钮绑定完成');
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

    async modifyMoney() {
        if (this.isProcessing) {
            console.log('正在处理中，请稍候...');
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
            console.log('货币修改响应:', data);

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

    initOperationType() {
        const operationRadios = document.querySelectorAll('input[name="operation-type"]');
        operationRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateOperationUI(e.target.value);
            });
        });
        
        this.updateOperationUI('modify-id');
    }

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

    bindEvents() {
        const loginBtn = document.getElementById('login-btn');
        const cloneBtn = document.getElementById('clone-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.login());
            console.log('登录按钮绑定成功');
        }
        
        if (cloneBtn) {
            cloneBtn.addEventListener('click', () => this.cloneAccount());
            console.log('克隆按钮绑定成功');
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
            console.log('退出按钮绑定成功');
        }
        
        const greenCashInput = document.getElementById('green-cash');
        const goldCoinsInput = document.getElementById('gold-coins');
        const modifyMoneyBtn = document.getElementById('modify-money-btn');
        
        if (greenCashInput && modifyMoneyBtn) {
            greenCashInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    goldCoinsInput?.focus();
                }
            });
        }
        
        if (goldCoinsInput && modifyMoneyBtn) {
            goldCoinsInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.modifyMoney();
                }
            });
        }
        
        const sourceEmail = document.getElementById('source-email');
        const sourcePass = document.getElementById('source-password');
        const targetEmail = document.getElementById('target-email');
        const targetPass = document.getElementById('target-password');
        const customLocalId = document.getElementById('custom-localid');
        
        const addEnterHandler = (input, nextInput, callback) => {
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (nextInput) {
                            nextInput.focus();
                        }
                        if (callback) {
                            callback();
                        }
                    }
                });
            }
        };
        
        addEnterHandler(sourceEmail, sourcePass);
        addEnterHandler(sourcePass, null, () => this.login());
        addEnterHandler(targetEmail, targetPass);
        addEnterHandler(targetPass, customLocalId);
        addEnterHandler(customLocalId, null, () => this.cloneAccount());
    }

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

    // === 修复的关键方法 ===
    checkSession() {
        const savedAuth = localStorage.getItem('jbcacc_auth');
        if (savedAuth) {
            this.sourceAuth = savedAuth;
            
            // 隐藏登录部分
            this.hideElement('login-section');
            
            // 显示所有功能部分
            this.showElement('account-info-section');
            this.showElement('money-section');
            this.showElement('clone-section');
            
            // 显示所有新功能页面
            this.showAllFunctionPages();
            
            this.showStatus('info', '检测到上次登录会话，正在验证...', 'login-status');
            console.log('从localStorage恢复会话');
            
            this.verifyAndLoadAccount(savedAuth);
        } else {
            // 如果没有登录，确保只显示登录部分
            this.showElement('login-section');
            this.hideElement('account-info-section');
            this.hideElement('money-section');
            this.hideElement('clone-section');
            this.hideAllFunctionPages();
        }
    }

    // 新增：显示所有功能页面
    showAllFunctionPages() {
        // 显示所有功能导航和页面
        const functionPageIds = [
            'w16-section',
            'houses-section',
            'smokes-section',
            'fuel-section',
            'godmode-section',
            'wins-section',
            'name-section',
            'all-section',
            'money-section',  // 货币修改页面
            'clone-section'   // 克隆页面
        ];
        
        functionPageIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.classList.remove('hidden');
                element.style.display = 'block';
            }
        });
    }

    // 新增：隐藏所有功能页面
    hideAllFunctionPages() {
        const functionPageIds = [
            'w16-section',
            'houses-section',
            'smokes-section',
            'fuel-section',
            'godmode-section',
            'wins-section',
            'name-section',
            'all-section',
            'money-section',
            'clone-section'
        ];
        
        functionPageIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.classList.add('hidden');
                element.style.display = 'none';
            }
        });
    }

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
            } else {
                this.logout();
                this.showStatus('error', '会话已过期，请重新登录', 'login-status');
            }
        } catch (error) {
            console.log('会话验证失败:', error);
            this.logout();
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
            if (data.ok && Array.isArray(data.data)) {
                const carsCount = data.data.length;
                document.getElementById('account-cars').textContent = carsCount;
            }
        } catch (error) {
            console.log('获取车辆数量失败:', error);
        }
    }

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

    formatNumber(num) {
        return Number(num).toLocaleString('zh-CN');
    }

    async login() {
        if (this.isProcessing) {
            console.log('正在处理中，请稍候...');
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
            console.log('正在登录:', email);
            const response = await fetch(`${this.baseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            console.log('登录响应状态:', response.status);
            const data = await response.json();
            console.log('登录响应数据:', data);

            if (data.ok) {
                this.sourceAuth = data.auth;
                this.sourceAccountInfo = null;
                localStorage.setItem('jbcacc_auth', data.auth);
                this.showStatus('success', '登录成功！正在获取账号信息...', 'login-status');
                
                // 登录成功后，隐藏登录页面，显示所有功能
                this.hideElement('login-section');
                this.showElement('account-info-section');
                this.showElement('money-section');
                this.showElement('clone-section');
                this.showAllFunctionPages();
                
                this.updateProgress('登录成功', 25);
                this.addLog('✓ 登录成功');
                this.updateStep(1);
                
                await this.verifyAndLoadAccount(data.auth);
                
                const targetEmailInput = document.getElementById('target-email');
                if (targetEmailInput && !targetEmailInput.value) {
                    targetEmailInput.value = email;
                    targetEmailInput.focus();
                }
                
            } else {
                let errorMsg = data.message || '登录失败';
                if (data.error === 100) errorMsg = '邮箱未找到 - 请检查邮箱地址';
                if (data.error === 101) errorMsg = '密码错误 - 请检查密码';
                if (data.error === 107) errorMsg = '邮箱格式无效';
                if (data.error === 108) errorMsg = '请输入邮箱';
                if (data.error === 106) errorMsg = '请输入密码';
                
                this.showStatus('error', `登录失败: ${errorMsg}`, 'login-status');
                this.addLog(`✗ 登录失败: ${errorMsg}`);
                
                if (data.error === 101) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        } catch (error) {
            console.error('登录错误:', error);
            this.showStatus('error', `网络错误: ${error.message}。请检查网络连接。`, 'login-status');
            this.addLog(`✗ 网络错误: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('login-btn', false, '登录并验证账号');
        }
    }

    logout() {
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        localStorage.removeItem('jbcacc_auth');
        
        // 只显示登录部分，隐藏所有功能
        this.showElement('login-section');
        this.hideElement('account-info-section');
        this.hideElement('money-section');
        this.hideElement('clone-section');
        this.hideAllFunctionPages();
        
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
        
        this.showStatus('info', '已退出登录', 'login-status');
        this.addLog('已退出登录');
        this.updateStep(1);
    }

    async cloneAccount() {
        if (this.isProcessing) {
            console.log('正在处理中，请稍候...');
            this.showStatus('error', '请等待，另一个操作正在进行中', 'clone-status');
            return;
        }

        if (!this.sourceAuth) {
            console.log('没有可用的认证令牌');
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
                console.log('克隆响应:', data);

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('克隆完成！', 100);
                    this.addLog('✓ 克隆成功！');
                    this.addLog(`目标账号: ${targetEmail}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`已克隆车辆: ${data.details?.carsCloned || '未知'} 辆`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `账号克隆成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    targetEmailInput.value = '';
                    targetPasswordInput.value = '';
                    document.getElementById('custom-localid').value = '';
                    
                    this.addLog('5秒后刷新页面...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    let errorMsg = data.message || '克隆失败，未知错误';
                    if (data.error === 100) errorMsg = '目标账号邮箱未找到';
                    if (data.error === 101) errorMsg = '目标账号密码错误';
                    if (data.error === 400) errorMsg = '缺少必要参数';
                    if (data.error === 401) errorMsg = '认证失败';
                    if (data.error === 500) errorMsg = '克隆过程中服务器错误';
                    
                    throw new Error(errorMsg);
                }

            } catch (error) {
                clearTimeout(this.cloneTimeout);
                console.error('克隆错误:', error);
                
                if (error.name === 'AbortError') {
                    this.addLog('⚠ 请求超时，但克隆可能仍在后台进行中');
                    this.addLog('⚠ 请等待几分钟后检查目标账号');
                    this.showStatus('warning', '请求超时，但克隆可能仍在后台进行中。请稍后检查目标账号。', 'clone-status');
                } else {
                    this.addLog(`✗ 错误: ${error.message}`);
                    this.showStatus('error', `克隆失败: ${error.message}`, 'clone-status');
                }
                
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
                console.log('修改响应:', data);

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('修改完成！', 100);
                    this.addLog('✓ ID修改成功！');
                    this.addLog(`旧Local ID: ${currentLocalId}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`更新车辆: ${data.details?.carsUpdated || '未知'} 辆`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `ID修改成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    document.getElementById('account-localid').textContent = customLocalId;
                    
                    document.getElementById('custom-localid').value = '';
                    
                    this.addLog('5秒后刷新页面...');
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
            }, 8000);
        }
        
        console.log(`${type.toUpperCase()}: ${message}`);
    }

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

    clearStatusLog() {
        const logContainer = document.getElementById('status-log');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

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
            } else if (buttonId === 'unlock-w16-btn') {
                icon = 'fa-cogs';
            } else if (buttonId === 'unlock-houses-btn') {
                icon = 'fa-home';
            } else if (buttonId === 'unlock-smokes-btn') {
                icon = 'fa-smog';
            } else if (buttonId === 'unlock-fuel-btn') {
                icon = 'fa-gas-pump';
            } else if (buttonId === 'unlock-godmode-btn') {
                icon = 'fa-shield-alt';
            } else if (buttonId === 'modify-wins-btn') {
                icon = 'fa-trophy';
            } else if (buttonId === 'change-name-btn') {
                icon = 'fa-signature';
            } else if (buttonId === 'unlock-all-btn') {
                icon = 'fa-star';
            }
            
            button.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    }

    hideElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.add('hidden');
            element.style.display = 'none';
        }
    }

    showElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('hidden');
            element.style.display = 'block';
        }
    }

    // === 新增功能方法 ===

    async unlockW16Engine() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'w16-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'w16-status');
            return;
        }

        const confirmMessage = '⚠️ 确认解锁W16引擎？\n\n这将解锁顶级W16发动机，提升车辆性能。';
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消解锁W16引擎');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-w16-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始解锁W16引擎...', 5);
        this.updateTimeEstimate();
        this.addLog('正在解锁W16引擎...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-w16-engine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ W16引擎解锁成功！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `W16引擎解锁成功！耗时 ${elapsedTime} 秒`, 'w16-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('解锁W16引擎失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'w16-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-w16-btn', false, '立即解锁W16引擎');
        }
    }

    async unlockPremiumHouses() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'houses-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'houses-status');
            return;
        }

        const confirmMessage = '⚠️ 确认解锁所有付费房屋？\n\n这将解锁所有高级别墅和豪宅。';
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消解锁付费房屋');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-houses-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始解锁付费房屋...', 5);
        this.updateTimeEstimate();
        this.addLog('正在解锁付费房屋...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-premium-houses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ 付费房屋解锁成功！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `付费房屋解锁成功！耗时 ${elapsedTime} 秒`, 'houses-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('解锁付费房屋失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'houses-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-houses-btn', false, '立即解锁所有房屋');
        }
    }

    async unlockSmokes() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'smokes-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'smokes-status');
            return;
        }

        const confirmMessage = '⚠️ 确认解锁所有烟雾效果？\n\n这将解锁所有颜色的烟雾特效。';
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消解锁烟雾效果');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-smokes-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始解锁烟雾效果...', 5);
        this.updateTimeEstimate();
        this.addLog('正在解锁烟雾效果...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-smokes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ 烟雾效果解锁成功！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `烟雾效果解锁成功！耗时 ${elapsedTime} 秒`, 'smokes-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('解锁烟雾效果失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'smokes-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-smokes-btn', false, '立即解锁所有烟雾');
        }
    }

    async unlockUnlimitedFuel() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'fuel-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'fuel-status');
            return;
        }

        const confirmMessage = '⚠️ 确认解锁无限油？\n\n这将设置燃料为999,999，永不减少。';
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消解锁无限油');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-fuel-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始解锁无限油...', 5);
        this.updateTimeEstimate();
        this.addLog('正在解锁无限油...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-unlimited-fuel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ 无限油解锁成功！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `无限油解锁成功！耗时 ${elapsedTime} 秒`, 'fuel-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('解锁无限油失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'fuel-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-fuel-btn', false, '立即解锁无限油');
        }
    }

    async unlockGodMode() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'godmode-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'godmode-status');
            return;
        }

        const confirmMessage = '⚠️ 确认解锁无伤模式？\n\n这将使车辆永不损坏，碰撞无影响。';
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消解锁无伤模式');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-godmode-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始解锁无伤模式...', 5);
        this.updateTimeEstimate();
        this.addLog('正在解锁无伤模式...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-god-mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ 无伤模式解锁成功！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `无伤模式解锁成功！耗时 ${elapsedTime} 秒`, 'godmode-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('解锁无伤模式失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'godmode-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-godmode-btn', false, '立即解锁无伤模式');
        }
    }

    async modifyWins() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'wins-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'wins-status');
            return;
        }

        const operationType = document.querySelector('input[name="wins-operation"]:checked')?.value;
        if (!operationType) {
            this.showStatus('error', '请选择操作类型', 'wins-status');
            return;
        }

        let winsValue;
        
        if (operationType === 'max') {
            winsValue = 999999;
        } else {
            const winsInput = document.getElementById('wins-count');
            winsValue = winsInput?.value.trim();
            
            if (!winsValue || winsValue === '') {
                this.showStatus('error', '请输入胜场数', 'wins-status');
                return;
            }
            
            if (isNaN(winsValue) || winsValue < 0) {
                this.showStatus('error', '胜场数必须是非负数字', 'wins-status');
                return;
            }
            
            winsValue = parseInt(winsValue);
        }

        const confirmMessage = operationType === 'max' ? 
            '⚠️ 确认将胜场数设置为最大值 999,999？' :
            `⚠️ 确认修改胜场数？\n\n操作类型: ${operationType === 'set' ? '设置为' : '增加'}\n` +
            `胜场数: ${this.formatNumber(winsValue)}`;
        
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消修改胜场数');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('modify-wins-btn', true, '修改中...');
        this.clearStatusLog();
        this.updateProgress('开始修改胜场数...', 5);
        this.updateTimeEstimate();
        this.addLog('正在修改胜场数...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/modify-wins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    authToken: this.sourceAuth,
                    wins: winsValue,
                    operationType: operationType
                })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('修改成功！', 100);
                this.addLog('✓ 胜场数修改成功！');
                if (operationType === 'max') {
                    this.addLog('胜场数已设置为最大值: 999,999');
                } else {
                    this.addLog(`胜场数: ${operationType === 'set' ? '设置为' : '增加'} ${this.formatNumber(winsValue)}`);
                }
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `胜场数修改成功！耗时 ${elapsedTime} 秒`, 'wins-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
                
                if (operationType !== 'max') {
                    const winsInput = document.getElementById('wins-count');
                    if (winsInput) winsInput.value = '';
                }
            } else {
                throw new Error(data.message || '修改失败');
            }
        } catch (error) {
            console.error('修改胜场数失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `修改失败: ${error.message}`, 'wins-status');
            this.updateProgress('修改中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('modify-wins-btn', false, '确认修改胜场数');
        }
    }

    async changeName() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'name-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'name-status');
            return;
        }

        const nameInput = document.getElementById('new-name');
        const newName = nameInput?.value.trim();
        
        if (!newName) {
            this.showStatus('error', '请输入新的游戏名字', 'name-status');
            return;
        }

        if (newName.length < 2 || newName.length > 20) {
            this.showStatus('error', '名字长度应为2-20个字符', 'name-status');
            return;
        }

        const confirmMessage = `⚠️ 确认修改游戏名字？\n\n新的名字: ${newName}\n\n注意：此操作无次数限制。`;
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消修改名字');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('change-name-btn', true, '修改中...');
        this.clearStatusLog();
        this.updateProgress('开始修改游戏名字...', 5);
        this.updateTimeEstimate();
        this.addLog('正在修改游戏名字...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在处理请求...', 30);

            const response = await fetch(`${this.baseUrl}/api/change-name-unlimited`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    authToken: this.sourceAuth,
                    newName: newName
                })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('修改成功！', 100);
                this.addLog(`✓ 名字修改成功: "${newName}"`);
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `名字修改成功！耗时 ${elapsedTime} 秒`, 'name-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
                
                if (this.sourceAccountInfo) {
                    this.sourceAccountInfo.Name = newName;
                    document.getElementById('account-name').textContent = newName;
                }
                
                if (nameInput) nameInput.value = '';
            } else {
                throw new Error(data.message || '修改失败');
            }
        } catch (error) {
            console.error('修改名字失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `修改失败: ${error.message}`, 'name-status');
            this.updateProgress('修改中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('change-name-btn', false, '确认修改名字');
        }
    }

    async unlockAll() {
        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'all-status');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'all-status');
            return;
        }

        const confirmMessage = '⚠️ 警告：一键全解锁将修改账号的多个数据！\n\n' +
                             '包括：\n' +
                             '- 无限绿钞和金币\n' +
                             '- 解锁W16引擎\n' +
                             '- 所有付费房屋\n' +
                             '- 所有烟雾效果\n' +
                             '- 无限燃料\n' +
                             '- 无伤模式\n' +
                             '- 最大胜场数\n' +
                             '- 所有车辆解锁\n' +
                             '- 所有轮毂解锁\n' +
                             '- 所有霓虹灯解锁\n\n' +
                             '你确定要继续吗？';
        
        if (!confirm(confirmMessage)) {
            this.addLog('✗ 用户取消一键全解锁');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('unlock-all-btn', true, '解锁中...');
        this.clearStatusLog();
        this.updateProgress('开始一键解锁所有功能...', 5);
        this.updateTimeEstimate();
        this.addLog('正在一键解锁所有功能...');

        try {
            this.addLog('正在发送请求...');
            this.updateProgress('正在解锁所有功能...', 30);

            const response = await fetch(`${this.baseUrl}/api/unlock-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken: this.sourceAuth })
            });

            const data = await response.json();
            
            if (data.ok || data.error === 0) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                this.updateProgress('解锁成功！', 100);
                this.addLog('✓ 所有功能已解锁！');
                this.addLog(`总耗时: ${elapsedTime} 秒`);
                this.showStatus('success', `所有功能已解锁！耗时 ${elapsedTime} 秒`, 'all-status');
                this.updateTimeEstimate('已完成');
                this.showSuccessAnimation();
            } else {
                throw new Error(data.message || '解锁失败');
            }
        } catch (error) {
            console.error('一键全解锁失败:', error);
            this.addLog(`✗ 错误: ${error.message}`);
            this.showStatus('error', `解锁失败: ${error.message}`, 'all-status');
            this.updateProgress('解锁中断', 0);
            this.updateTimeEstimate('已中断');
            this.showErrorAnimation();
        } finally {
            this.isProcessing = false;
            this.updateButtonState('unlock-all-btn', false, '一键解锁所有功能');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成');
    
    try {
        const app = new cpmcylone();
        app.init();
        console.log('cpmcy Clone应用初始化成功');
        console.log('应用版本: 3.0 (完整修复版)');
        console.log('环境:', window.location.origin.includes('localhost') ? '开发环境' : '生产环境');
        
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
