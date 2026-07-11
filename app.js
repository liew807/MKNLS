class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        console.log('✅ cpmcy Clone 初始化成功. 基础URL:', this.baseUrl);
    }

    init() {
        this.bindEvents();
        this.checkSession();
        this.testConnection();
        this.initStepIndicator();
        this.initOperationType();
        this.initMoneyOperation();
        console.log('✅ 所有功能初始化完成');
    }

    // ==================== 初始化方法 ====================
    
    initStepIndicator() {
        const cloneSection = document.getElementById('clone-section');
        if (cloneSection) {
            const stepHtml = `
                <div class="step-indicator" style="display:flex;justify-content:space-around;margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:10px;">
                    <div class="step active" id="step-1" style="text-align:center;">
                        <div class="step-number" style="width:40px;height:40px;background:#6a11cb;color:white;border-radius:50%;line-height:40px;margin:0 auto 5px;">1</div>
                        <div class="step-text" style="font-size:14px;">登录源账号</div>
                    </div>
                    <div class="step" id="step-2" style="text-align:center;">
                        <div class="step-number" style="width:40px;height:40px;background:#ccc;color:white;border-radius:50%;line-height:40px;margin:0 auto 5px;">2</div>
                        <div class="step-text" style="font-size:14px;">选择操作</div>
                    </div>
                    <div class="step" id="step-3" style="text-align:center;">
                        <div class="step-number" style="width:40px;height:40px;background:#ccc;color:white;border-radius:50%;line-height:40px;margin:0 auto 5px;">3</div>
                        <div class="step-text" style="font-size:14px;">开始执行</div>
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
            console.log('✅ 修改货币按钮绑定成功');
        }
        
        const refreshMoneyBtn = document.getElementById('refresh-money-btn');
        if (refreshMoneyBtn) {
            refreshMoneyBtn.addEventListener('click', () => this.refreshMoney());
        }
    }

    updateMoneyOperationUI(operationType) {
        const greenCashInput = document.getElementById('green-cash');
        const goldCoinsInput = document.getElementById('gold-coins');
        const greenCashLabel = greenCashInput?.parentElement?.querySelector('label');
        const goldCoinsLabel = goldCoinsInput?.parentElement?.querySelector('label');
        
        if (operationType === 'max') {
            if (greenCashInput) {
                greenCashInput.style.display = 'none';
                if (greenCashLabel) greenCashLabel.style.display = 'none';
            }
            if (goldCoinsInput) {
                goldCoinsInput.style.display = 'none';
                if (goldCoinsLabel) goldCoinsLabel.style.display = 'none';
            }
        } else {
            if (greenCashInput) {
                greenCashInput.style.display = 'block';
                if (greenCashLabel) greenCashLabel.style.display = 'block';
            }
            if (goldCoinsInput) {
                goldCoinsInput.style.display = 'block';
                if (goldCoinsLabel) goldCoinsLabel.style.display = 'block';
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
        const cloneBtn = document.getElementById('clone-btn');
        
        if (operationType === 'modify-id') {
            if (targetCredentials) targetCredentials.style.display = 'none';
            if (cloneBtn) cloneBtn.innerHTML = '<i class="fas fa-user-edit"></i> 修改当前账号ID';
        } else if (operationType === 'clone-to-new') {
            if (targetCredentials) targetCredentials.style.display = 'block';
            if (cloneBtn) cloneBtn.innerHTML = '<i class="fas fa-clone"></i> 开始克隆';
        }
    }

    // ==================== 事件绑定 ====================
    
    bindEvents() {
        console.log('🔗 开始绑定事件...');
        
        const loginBtn = document.getElementById('login-btn');
        const cloneBtn = document.getElementById('clone-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                console.log('🖱️ 登录按钮被点击');
                this.login();
            });
            console.log('✅ 登录按钮绑定成功');
        } else {
            console.error('❌ 未找到登录按钮 #login-btn');
        }
        
        if (cloneBtn) {
            cloneBtn.addEventListener('click', () => {
                console.log('🖱️ 克隆/修改按钮被点击');
                this.cloneAccount();
            });
            console.log('✅ 克隆按钮绑定成功');
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                console.log('🖱️ 退出按钮被点击');
                this.logout();
            });
            console.log('✅ 退出按钮绑定成功');
        }
        
        // Enter键快捷登录
        const sourceEmail = document.getElementById('source-email');
        const sourcePass = document.getElementById('source-password');
        
        if (sourcePass) {
            sourcePass.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    console.log('⌨️ 回车键触发登录');
                    this.login();
                }
            });
        }
        
        console.log('✅ 所有事件绑定完成');
    }

    // ==================== 连接测试 ====================
    
    async testConnection() {
        try {
            console.log('🔍 测试API连接...');
            const response = await fetch(`${this.baseUrl}/api/health`);
            const data = await response.json();
            console.log('✅ API连接正常:', data);
            this.addLog('✅ 服务器连接正常 - 版本: ' + (data.version || '未知'));
        } catch (error) {
            console.error('❌ API连接失败:', error);
            this.addLog('❌ 无法连接到服务器，请检查服务器是否启动');
        }
    }

    // ==================== 会话管理 ====================
    
    checkSession() {
        const savedAuth = localStorage.getItem('cpmcy_auth');
        if (savedAuth) {
            console.log('🔑 发现已保存的登录会话');
            this.sourceAuth = savedAuth;
            this.hideElement('login-section');
            this.showElement('clone-section');
            this.showElement('account-info-section');
            this.showElement('money-section');
            this.verifyAndLoadAccount(savedAuth);
        } else {
            console.log('👤 未找到登录会话，显示登录界面');
        }
    }

    async verifyAndLoadAccount(authToken) {
        try {
            console.log('🔄 验证登录会话...');
            this.updateStep(1);
            
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            console.log('📊 账号数据:', data);
            
            if (data.ok && data.data) {
                this.sourceAccountInfo = data.data;
                this.displayAccountInfo(data.data);
                this.showStatus('success', '会话验证成功！', 'login-status');
                this.updateStep(2);
                this.addLog('✅ 登录会话有效');
                await this.loadCarsCount(authToken);
            } else {
                console.log('⚠️ 会话已过期');
                this.logout();
                this.showStatus('error', '会话已过期，请重新登录', 'login-status');
            }
        } catch (error) {
            console.error('❌ 会话验证失败:', error);
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
            if (data.ok && data.data) {
                const carsData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                const carsCount = Array.isArray(carsData) ? carsData.length : 0;
                document.getElementById('account-cars').textContent = carsCount;
                console.log('🚗 车辆数量:', carsCount);
            }
        } catch (error) {
            console.error('获取车辆数量失败:', error);
            document.getElementById('account-cars').textContent = '获取失败';
        }
    }

    // ==================== 账号信息显示 ====================
    
    displayAccountInfo(accountData) {
        if (!accountData) return;
        
        console.log('📋 显示账号信息:', accountData);
        
        const name = accountData.Name || accountData.name || accountData.username || '未知';
        document.getElementById('account-name').textContent = name;
        
        // 获取绿钞（多种可能的字段名）
        const greenCash = accountData.cash || accountData.Cash || accountData.greenCash || accountData.green_cash || 0;
        document.getElementById('account-green-cash').textContent = this.formatNumber(greenCash);
        
        // 获取金币（多种可能的字段名）
        const goldCoins = accountData.coin || accountData.Coin || accountData.money || accountData.Money || accountData.goldCoins || 0;
        document.getElementById('account-money').textContent = this.formatNumber(goldCoins);
        
        const localID = accountData.localID || accountData.localId || '未知';
        document.getElementById('account-localid').textContent = localID;
        
        const statusBadge = document.getElementById('account-status');
        if (statusBadge) {
            statusBadge.textContent = '已登录 ✅';
            statusBadge.style.color = '#27ae60';
        }
    }

    formatNumber(num) {
        if (num === undefined || num === null) return '0';
        return Number(num).toLocaleString('zh-CN');
    }

    // ==================== 登录功能（修复版）====================
    
    async login() {
        console.log('🔑 开始登录流程...');
        
        if (this.isProcessing) {
            console.log('⚠️ 正在处理中');
            this.showStatus('error', '请等待，另一个操作正在进行中', 'login-status');
            return;
        }

        const emailInput = document.getElementById('source-email');
        const passwordInput = document.getElementById('source-password');
        
        if (!emailInput || !passwordInput) {
            console.error('❌ 未找到邮箱或密码输入框');
            this.showStatus('error', '页面加载异常，请刷新页面', 'login-status');
            return;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        console.log('📧 登录邮箱:', email);

        if (!email || !password) {
            this.showStatus('error', '请输入邮箱和密码', 'login-status');
            return;
        }

        if (!email.includes('@')) {
            this.showStatus('error', '请输入有效的邮箱地址', 'login-status');
            return;
        }

        this.isProcessing = true;
        this.updateButtonState('login-btn', true, '登录中...');
        this.showStatus('info', '正在连接服务器登录...', 'login-status');
        this.addLog('🔑 正在登录: ' + email);

        try {
            console.log('📡 发送登录请求到:', `${this.baseUrl}/api/login`);
            
            const response = await fetch(`${this.baseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            console.log('📥 登录响应状态:', response.status);
            const data = await response.json();
            console.log('📦 登录响应数据:', data);

            if (data.ok && data.auth) {
                console.log('✅ 登录成功！');
                this.sourceAuth = data.auth;
                localStorage.setItem('cpmcy_auth', data.auth);
                
                this.showStatus('success', '登录成功！正在加载账号信息...', 'login-status');
                this.addLog('✅ 登录成功');
                
                // 显示功能区域
                this.hideElement('login-section');
                this.showElement('clone-section');
                this.showElement('account-info-section');
                this.showElement('money-section');
                
                this.updateStep(1);
                
                // 加载账号数据
                await this.verifyAndLoadAccount(data.auth);
                
                // 自动填充目标邮箱
                const targetEmailInput = document.getElementById('target-email');
                if (targetEmailInput && !targetEmailInput.value) {
                    targetEmailInput.value = email;
                }
                
                this.addLog('✅ 所有数据加载完成');
                
            } else {
                console.log('❌ 登录失败:', data.message);
                const errorMsg = data.message || '登录失败，请检查账号密码';
                this.showStatus('error', errorMsg, 'login-status');
                this.addLog('❌ 登录失败: ' + errorMsg);
                
                if (data.message && data.message.includes('密码')) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        } catch (error) {
            console.error('❌ 登录网络错误:', error);
            this.showStatus('error', '网络错误，请检查服务器是否启动', 'login-status');
            this.addLog('❌ 网络错误: ' + error.message);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('login-btn', false, '登录并验证账号');
        }
    }

    logout() {
        console.log('🚪 退出登录');
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        localStorage.removeItem('cpmcy_auth');
        
        this.showElement('login-section');
        this.hideElement('clone-section');
        this.hideElement('account-info-section');
        this.hideElement('money-section');
        
        // 清空输入框
        const sourceEmail = document.getElementById('source-email');
        const sourcePass = document.getElementById('source-password');
        if (sourceEmail) sourceEmail.value = '';
        if (sourcePass) sourcePass.value = '';
        
        // 重置显示
        document.getElementById('account-name').textContent = '--';
        document.getElementById('account-money').textContent = '--';
        document.getElementById('account-green-cash').textContent = '--';
        document.getElementById('account-cars').textContent = '--';
        document.getElementById('account-localid').textContent = '--';
        
        const statusBadge = document.getElementById('account-status');
        if (statusBadge) {
            statusBadge.textContent = '未登录';
            statusBadge.style.color = '#e74c3c';
        }
        
        this.addLog('👋 已退出登录');
        this.updateStep(1);
    }

    // ==================== 货币修改（修复版 - 分别调用独立接口）====================
    
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
                this.displayAccountInfo(data.data);
                this.showStatus('success', '货币信息已刷新', 'money-status');
                this.addLog('🔄 货币信息已刷新');
            }
        } catch (error) {
            console.error('刷新货币失败:', error);
            this.showStatus('error', '刷新失败', 'money-status');
        }
    }

    async modifyMoney() {
        console.log('💰 开始修改货币...');
        
        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'money-status');
            return;
        }

        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录账号', 'money-status');
            return;
        }

        const operationType = document.querySelector('input[name="money-operation"]:checked')?.value;
        if (!operationType) {
            this.showStatus('error', '请选择操作类型', 'money-status');
            return;
        }

        console.log('操作类型:', operationType);

        this.isProcessing = true;
        this.updateButtonState('modify-money-btn', true, '修改中...');
        this.clearStatusLog();
        this.updateProgress('开始修改货币...', 10);
        this.addLog('💰 开始修改货币');
        this.addLog('操作类型: ' + (operationType === 'max' ? '设置为最大值' : operationType === 'set' ? '设置为指定值' : '增加数值'));

        try {
            if (operationType === 'max') {
                // 一键最大
                this.addLog('📡 调用一键最大接口...');
                this.updateProgress('正在设置最大值...', 30);
                
                const response = await fetch(`${this.baseUrl}/api/max-money`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authToken: this.sourceAuth })
                });
                
                const data = await response.json();
                console.log('最大货币响应:', data);
                
                if (data.ok) {
                    this.updateProgress('修改完成！', 100);
                    this.addLog('✅ 绿钞已设置为: 999,999,999');
                    this.addLog('✅ 金币已设置为: 999,999,999');
                    this.showStatus('success', '✅ 货币已设置为最大值！', 'money-status');
                    
                    document.getElementById('account-green-cash').textContent = '999,999,999';
                    document.getElementById('account-money').textContent = '999,999,999';
                } else {
                    throw new Error(data.message || '设置最大值失败');
                }
                
            } else {
                // 分别修改绿钞和金币
                const greenCashInput = document.getElementById('green-cash');
                const goldCoinsInput = document.getElementById('gold-coins');
                
                const greenCashVal = greenCashInput?.value?.trim();
                const goldCoinsVal = goldCoinsInput?.value?.trim();
                
                if (!greenCashVal && !goldCoinsVal) {
                    throw new Error('请至少输入一种货币的数值');
                }
                
                let greenSuccess = true;
                let goldSuccess = true;
                
                // 修改绿钞
                if (greenCashVal) {
                    const greenAmount = parseInt(greenCashVal);
                    if (isNaN(greenAmount) || greenAmount < 0) {
                        throw new Error('绿钞数值无效');
                    }
                    
                    this.addLog(`💚 修改绿钞: ${operationType === 'set' ? '设置为' : '增加'} ${this.formatNumber(greenAmount)}`);
                    this.updateProgress('正在修改绿钞...', 40);
                    
                    const response = await fetch(`${this.baseUrl}/api/modify-green-cash`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            authToken: this.sourceAuth,
                            amount: greenAmount,
                            operationType: operationType
                        })
                    });
                    
                    const data = await response.json();
                    console.log('绿钞修改响应:', data);
                    
                    if (data.ok) {
                        this.addLog('✅ 绿钞修改成功！');
                        if (data.details) {
                            document.getElementById('account-green-cash').textContent = this.formatNumber(data.details.newValue);
                        }
                    } else {
                        greenSuccess = false;
                        this.addLog('❌ 绿钞修改失败: ' + (data.message || '未知错误'));
                    }
                    
                    // 等待一下再修改金币
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                // 修改金币
                if (goldCoinsVal) {
                    const goldAmount = parseInt(goldCoinsVal);
                    if (isNaN(goldAmount) || goldAmount < 0) {
                        throw new Error('金币数值无效');
                    }
                    
                    this.addLog(`💛 修改金币: ${operationType === 'set' ? '设置为' : '增加'} ${this.formatNumber(goldAmount)}`);
                    this.updateProgress('正在修改金币...', 70);
                    
                    const response = await fetch(`${this.baseUrl}/api/modify-gold-coins`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            authToken: this.sourceAuth,
                            amount: goldAmount,
                            operationType: operationType
                        })
                    });
                    
                    const data = await response.json();
                    console.log('金币修改响应:', data);
                    
                    if (data.ok) {
                        this.addLog('✅ 金币修改成功！');
                        if (data.details) {
                            document.getElementById('account-money').textContent = this.formatNumber(data.details.newValue);
                        }
                    } else {
                        goldSuccess = false;
                        this.addLog('❌ 金币修改失败: ' + (data.message || '未知错误'));
                    }
                }
                
                this.updateProgress('修改完成！', 100);
                
                if (greenSuccess && goldSuccess) {
                    this.showStatus('success', '✅ 货币修改成功！', 'money-status');
                } else if (greenSuccess || goldSuccess) {
                    this.showStatus('info', '⚠️ 部分修改成功，请查看日志', 'money-status');
                } else {
                    throw new Error('货币修改失败');
                }
            }
            
            // 清空输入框
            const greenCashInput = document.getElementById('green-cash');
            const goldCoinsInput = document.getElementById('gold-coins');
            if (greenCashInput) greenCashInput.value = '';
            if (goldCoinsInput) goldCoinsInput.value = '';
            
        } catch (error) {
            console.error('❌ 修改货币错误:', error);
            this.addLog('❌ 错误: ' + error.message);
            this.showStatus('error', '修改失败: ' + error.message, 'money-status');
            this.updateProgress('修改失败', 0);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('modify-money-btn', false, '确认修改货币');
        }
    }

    // ==================== 克隆和修改ID ====================
    
    async cloneAccount() {
        console.log('🔄 开始执行操作...');
        
        if (this.isProcessing) {
            this.showStatus('error', '请等待，另一个操作正在进行中', 'clone-status');
            return;
        }

        if (!this.sourceAuth) {
            this.showStatus('error', '请先登录源账号', 'clone-status');
            return;
        }

        const operationType = document.querySelector('input[name="operation-type"]:checked')?.value;
        const customLocalId = document.getElementById('custom-localid')?.value?.trim();
        
        if (!customLocalId) {
            this.showStatus('error', '请输入自定义的Local ID', 'clone-status');
            return;
        }

        console.log('操作类型:', operationType, '新ID:', customLocalId);

        if (operationType === 'clone-to-new') {
            const targetEmail = document.getElementById('target-email')?.value?.trim();
            const targetPassword = document.getElementById('target-password')?.value;
            
            if (!targetEmail || !targetPassword) {
                this.showStatus('error', '请输入目标账号的邮箱和密码', 'clone-status');
                return;
            }
            
            if (!confirm(`⚠️ 确认克隆到新账号？\n\n目标账号: ${targetEmail}\n新Local ID: ${customLocalId}\n\n此操作将覆盖目标账号所有数据！`)) {
                this.addLog('❌ 用户取消操作');
                return;
            }
            
            await this.performClone(targetEmail, targetPassword, customLocalId);
            
        } else if (operationType === 'modify-id') {
            const currentLocalId = document.getElementById('account-localid')?.textContent;
            
            if (!confirm(`⚠️ 确认修改当前账号ID？\n\n当前ID: ${currentLocalId}\n新ID: ${customLocalId}`)) {
                this.addLog('❌ 用户取消操作');
                return;
            }
            
            await this.performModifyId(customLocalId);
        }
    }

    async performClone(targetEmail, targetPassword, customLocalId) {
        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('clone-btn', true, '克隆中...');
        this.clearStatusLog();
        this.updateProgress('开始克隆...', 5);
        this.addLog('🔄 开始克隆账号...');
        this.addLog('目标: ' + targetEmail);
        this.addLog('新ID: ' + customLocalId);

        try {
            const response = await fetch(`${this.baseUrl}/api/clone-account`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceAuth: this.sourceAuth,
                    targetEmail: targetEmail,
                    targetPassword: targetPassword,
                    customLocalId: customLocalId
                })
            });
            
            const data = await response.json();
            console.log('克隆响应:', data);
            
            if (data.ok) {
                this.updateProgress('克隆完成！', 100);
                this.addLog('✅ 克隆成功！');
                this.addLog('克隆车辆: ' + (data.details?.carsCloned || '0') + ' 辆');
                this.showStatus('success', '✅ 克隆成功！', 'clone-status');
                
                document.getElementById('target-email').value = '';
                document.getElementById('target-password').value = '';
                document.getElementById('custom-localid').value = '';
                
                setTimeout(() => location.reload(), 3000);
            } else {
                throw new Error(data.message || '克隆失败');
            }
        } catch (error) {
            console.error('克隆错误:', error);
            this.addLog('❌ 错误: ' + error.message);
            this.showStatus('error', '克隆失败: ' + error.message, 'clone-status');
            this.updateProgress('克隆失败', 0);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('clone-btn', false, '开始克隆');
        }
    }

    async performModifyId(customLocalId) {
        this.isProcessing = true;
        this.startTime = Date.now();
        this.updateButtonState('clone-btn', true, '修改中...');
        this.clearStatusLog();
        this.updateProgress('开始修改ID...', 5);
        this.addLog('🔄 开始修改Local ID...');
        this.addLog('新ID: ' + customLocalId);

        try {
            const response = await fetch(`${this.baseUrl}/api/change-localid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    authToken: this.sourceAuth,
                    newLocalId: customLocalId
                })
            });
            
            const data = await response.json();
            console.log('修改ID响应:', data);
            
            if (data.ok) {
                this.updateProgress('修改完成！', 100);
                this.addLog('✅ ID修改成功！');
                this.addLog('更新车辆: ' + (data.details?.carsUpdated || '0') + ' 辆');
                this.showStatus('success', '✅ ID修改成功！', 'clone-status');
                
                document.getElementById('account-localid').textContent = customLocalId;
                document.getElementById('custom-localid').value = '';
                
                setTimeout(() => location.reload(), 3000);
            } else {
                throw new Error(data.message || '修改失败');
            }
        } catch (error) {
            console.error('修改ID错误:', error);
            this.addLog('❌ 错误: ' + error.message);
            this.showStatus('error', '修改失败: ' + error.message, 'clone-status');
            this.updateProgress('修改失败', 0);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('clone-btn', false, '修改当前账号ID');
        }
    }

    // ==================== UI辅助方法 ====================
    
    updateStep(stepNumber) {
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                const numDiv = step.querySelector('.step-number');
                if (numDiv) {
                    if (i < stepNumber) {
                        numDiv.style.background = '#27ae60';
                        numDiv.textContent = '✓';
                    } else if (i === stepNumber) {
                        numDiv.style.background = '#6a11cb';
                        numDiv.textContent = i;
                    } else {
                        numDiv.style.background = '#ccc';
                        numDiv.textContent = i;
                    }
                }
            }
        }
    }

    updateProgress(message, percentage) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        
        if (progressBar) {
            progressBar.style.width = percentage + '%';
        }
        if (progressText) {
            progressText.textContent = message;
        }
    }

    showStatus(type, message, elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.log('状态:', type, message);
            return;
        }
        
        element.textContent = message;
        element.className = 'status';
        element.style.display = 'block';
        element.style.padding = '12px';
        element.style.borderRadius = '8px';
        element.style.marginTop = '10px';
        
        switch(type) {
            case 'success':
                element.style.background = '#d4edda';
                element.style.color = '#155724';
                element.style.border = '1px solid #c3e6cb';
                break;
            case 'error':
                element.style.background = '#f8d7da';
                element.style.color = '#721c24';
                element.style.border = '1px solid #f5c6cb';
                break;
            case 'info':
                element.style.background = '#d1ecf1';
                element.style.color = '#0c5460';
                element.style.border = '1px solid #bee5eb';
                break;
            case 'warning':
                element.style.background = '#fff3cd';
                element.style.color = '#856404';
                element.style.border = '1px solid #ffeaa7';
                break;
        }
    }

    addLog(message) {
        const logContainer = document.getElementById('status-log');
        if (!logContainer) {
            console.log('📝', message);
            return;
        }
        
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.style.cssText = 'padding:8px 12px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;';
        
        let icon = '📌';
        if (message.includes('✅')) icon = '✅';
        else if (message.includes('❌')) icon = '❌';
        else if (message.includes('⚠')) icon = '⚠️';
        else if (message.includes('🔑')) icon = '🔑';
        else if (message.includes('💰')) icon = '💰';
        else if (message.includes('💚')) icon = '💚';
        else if (message.includes('💛')) icon = '💛';
        else if (message.includes('🔄')) icon = '🔄';
        else if (message.includes('📡')) icon = '📡';
        else if (message.includes('🚗')) icon = '🚗';
        else if (message.includes('👋')) icon = '👋';
        
        logEntry.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        console.log('📝', message);
    }

    clearStatusLog() {
        const logContainer = document.getElementById('status-log');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    updateButtonState(buttonId, disabled, text) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        button.disabled = disabled;
        button.innerHTML = disabled ? 
            `<i class="fas fa-spinner fa-spin"></i> ${text}` : 
            text;
        button.style.opacity = disabled ? '0.7' : '1';
        button.style.cursor = disabled ? 'not-allowed' : 'pointer';
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
}

// ==================== 应用启动 ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM加载完成，初始化应用...');
    
    try {
        const app = new cpmcylone();
        app.init();
        console.log('✅ CPM工具箱初始化成功！');
        console.log('📋 版本: 3.0 - 全面修复版');
        console.log('🔧 修复内容: 登录功能、独立货币修改接口');
    } catch (error) {
        console.error('❌ 应用初始化失败:', error);
    }
});
