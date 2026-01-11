class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        this.accountLogs = []; // 新增：存储账号日志
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
        
        // 绑定货币相关事件
        this.bindMoneyEvents();
        
        // 绑定日志相关事件
        this.bindLogsEvents();
        
        // 绑定键盘事件
        this.bindKeyboardEvents();
    }

    // 新增：绑定日志相关事件
    bindLogsEvents() {
        const refreshLogsBtn = document.getElementById('refresh-logs-btn');
        const exportLogsBtn = document.getElementById('export-logs-btn');
        const logsFilterType = document.getElementById('logs-filter-type');
        const logsSearch = document.getElementById('logs-search');
        
        if (refreshLogsBtn) {
            refreshLogsBtn.addEventListener('click', () => this.loadAccountLogs());
            console.log('刷新日志按钮绑定成功');
        }
        
        if (exportLogsBtn) {
            exportLogsBtn.addEventListener('click', () => this.exportLogs());
            console.log('导出日志按钮绑定成功');
        }
        
        if (logsFilterType) {
            logsFilterType.addEventListener('change', () => this.filterLogs());
            console.log('日志过滤绑定成功');
        }
        
        if (logsSearch) {
            logsSearch.addEventListener('input', () => this.filterLogs());
            console.log('日志搜索绑定成功');
        }
    }

    // 新增：绑定货币相关事件
    bindMoneyEvents() {
        const modifyMoneyBtn = document.getElementById('modify-money-btn');
        const refreshMoneyBtn = document.getElementById('refresh-money-btn');
        const greenCashInput = document.getElementById('green-cash');
        const goldCoinsInput = document.getElementById('gold-coins');
        const moneyOperationRadios = document.querySelectorAll('input[name="money-operation"]');
        
        if (modifyMoneyBtn) {
            modifyMoneyBtn.addEventListener('click', () => this.modifyMoney());
        }
        
        if (refreshMoneyBtn) {
            refreshMoneyBtn.addEventListener('click', () => this.refreshMoney());
        }
        
        // 货币操作类型切换
        moneyOperationRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateMoneyOperationUI(e.target.value);
            });
        });
        
        // Enter键支持
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

    // 新增：绑定键盘事件
    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            // Ctrl + L 快速登录/登出
            if (e.ctrlKey && e.key === 'l' && !e.target.matches('input, textarea, select')) {
                e.preventDefault();
                const loginSection = document.getElementById('login-section');
                if (loginSection && !loginSection.classList.contains('hidden')) {
                    this.login();
                } else if (this.sourceAuth) {
                    this.logout();
                }
            }
            
            // Ctrl + R 刷新日志
            if (e.ctrlKey && e.key === 'r' && this.sourceAuth && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.loadAccountLogs();
            }
            
            // Esc 键退出
            if (e.key === 'Escape' && this.sourceAuth) {
                this.logout();
            }
        });
    }

    // 新增：加载账号日志
    async loadAccountLogs() {
        if (!this.sourceAuth) {
            this.showLogsMessage('请先登录账号查看日志');
            this.showStatus('error', '请先登录账号', 'logs-status');
            return;
        }

        try {
            this.showLogsLoading(true);
            this.showStatus('info', '正在获取账号日志...', 'logs-status');
            
            // 修复点1：API路径从 /api/get-account-logs 改为 /api/get-account-log（单数）
            const response = await fetch(`${this.baseUrl}/api/get-account-log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    authToken: this.sourceAuth
                    // 注意：后端可能不需要limit参数，或者使用默认值
                })
            });
            
            const data = await response.json();
            console.log('账号日志响应:', data);
            
            // 修复点2：后端返回的数据结构是 data.data，不是 data.logs
            if (data.ok && data.data) {
                // data.data 可能是一个数组，也可能是一个对象
                if (Array.isArray(data.data)) {
                    this.accountLogs = data.data;
                } else if (typeof data.data === 'object') {
                    // 如果是对象，转换为数组
                    this.accountLogs = [data.data];
                } else {
                    // 其他格式，创建一个包含原始数据的数组
                    this.accountLogs = [{ rawData: data.data }];
                }
                
                this.updateLogsDisplay();
                this.showStatus('success', `已加载 ${this.accountLogs.length} 条日志`, 'logs-status');
                this.addLog(`已加载账号日志: ${this.accountLogs.length} 条`);
                
                // 保存到本地存储（可选）
                localStorage.setItem('cpmcy_last_logs', JSON.stringify({
                    timestamp: Date.now(),
                    count: this.accountLogs.length
                }));
                
            } else if (data.error === 404) {
                // API不存在，使用模拟数据
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

    // 新增：更新日志显示
    updateLogsDisplay() {
        const logsBody = document.getElementById('logs-body');
        const logsTotal = document.getElementById('logs-total');
        const logsLastLogin = document.getElementById('logs-last-login');
        const logsLoginCount = document.getElementById('logs-login-count');
        
        if (!logsBody) return;
        
        // 更新统计
        logsTotal.textContent = this.accountLogs.length;
        
        // 从日志中提取信息（后端返回的日志格式可能不同）
        let loginCount = 0;
        let lastLoginTime = null;
        
        this.accountLogs.forEach(log => {
            // 尝试从不同的字段中提取登录信息
            const logData = log.data || log;
            const message = logData.message || logData.event || '';
            const type = log.type || logData.type || '';
            const timestamp = log.timestamp || logData.timestamp;
            
            // 检查是否是登录日志
            if (type === 'login' || 
                message.toLowerCase().includes('login') || 
                message.toLowerCase().includes('登录')) {
                loginCount++;
                
                // 更新最近登录时间
                if (timestamp) {
                    const logTime = new Date(timestamp);
                    if (!lastLoginTime || logTime > lastLoginTime) {
                        lastLoginTime = logTime;
                    }
                }
            }
        });
        
        logsLoginCount.textContent = loginCount;
        logsLastLogin.textContent = lastLoginTime ? this.formatLogTime(lastLoginTime) : '--';
        
        // 显示日志
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
        
        // 清空表格
        logsBody.innerHTML = '';
        
        // 显示日志（按时间倒序）
        const sortedLogs = [...this.accountLogs].sort((a, b) => {
            const timeA = a.timestamp || (a.data && a.data.timestamp) || 0;
            const timeB = b.timestamp || (b.data && b.data.timestamp) || 0;
            return new Date(timeB) - new Date(timeA);
        });
        
        sortedLogs.forEach(log => {
            const row = document.createElement('tr');
            
            // 提取日志信息
            const logData = log.data || log;
            const timestamp = log.timestamp || logData.timestamp || new Date().toISOString();
            const type = log.type || logData.type || 'info';
            const message = logData.message || logData.event || logData.data || '无内容';
            const ip = logData.ip || log.ip || '--';
            const device = logData.device || log.device || '--';
            
            row.innerHTML = `
                <td class="log-time">${this.formatLogTime(timestamp)}</td>
                <td><span class="log-type log-type-${type}">${this.getLogTypeText(type)}</span></td>
                <td class="log-message">${this.truncateMessage(message)}</td>
                <td class="log-ip">${ip}</td>
                <td class="log-device">${device}</td>
            `;
            
            // 添加点击查看详情
            row.addEventListener('click', () => {
                this.showLogDetails(log);
            });
            
            row.style.cursor = 'pointer';
            logsBody.appendChild(row);
        });
    }

    // 新增：截断过长的消息
    truncateMessage(message, maxLength = 50) {
        if (typeof message !== 'string') {
            return '无内容';
        }
        
        if (message.length <= maxLength) {
            return message;
        }
        
        return message.substring(0, maxLength) + '...';
    }

    // 新增：过滤日志
    filterLogs() {
        const filterType = document.getElementById('logs-filter-type')?.value || 'all';
        const searchText = document.getElementById('logs-search')?.value.toLowerCase() || '';
        
        const logsBody = document.getElementById('logs-body');
        if (!logsBody || this.accountLogs.length === 0) return;
        
        const filteredLogs = this.accountLogs.filter(log => {
            // 提取日志信息
            const logData = log.data || log;
            const type = log.type || logData.type || 'info';
            const message = (logData.message || logData.event || logData.data || '').toString().toLowerCase();
            const ip = (logData.ip || log.ip || '').toString().toLowerCase();
            const device = (logData.device || log.device || '').toString().toLowerCase();
            
            // 类型过滤
            if (filterType !== 'all' && type !== filterType) {
                return false;
            }
            
            // 搜索过滤
            if (searchText) {
                const messageMatch = message.includes(searchText);
                const ipMatch = ip.includes(searchText);
                const deviceMatch = device.includes(searchText);
                
                if (!messageMatch && !ipMatch && !deviceMatch) {
                    return false;
                }
            }
            
            return true;
        });
        
        // 更新显示
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
                const timeA = a.timestamp || (a.data && a.data.timestamp) || 0;
                const timeB = b.timestamp || (b.data && b.data.timestamp) || 0;
                return new Date(timeB) - new Date(timeA);
            });
            
            sortedLogs.forEach(log => {
                const row = document.createElement('tr');
                
                // 提取日志信息
                const logData = log.data || log;
                const timestamp = log.timestamp || logData.timestamp || new Date().toISOString();
                const type = log.type || logData.type || 'info';
                const message = logData.message || logData.event || logData.data || '无内容';
                const ip = logData.ip || log.ip || '--';
                const device = logData.device || log.device || '--';
                
                row.innerHTML = `
                    <td class="log-time">${this.formatLogTime(timestamp)}</td>
                    <td><span class="log-type log-type-${type}">${this.getLogTypeText(type)}</span></td>
                    <td class="log-message">${this.truncateMessage(message)}</td>
                    <td class="log-ip">${ip}</td>
                    <td class="log-device">${device}</td>
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

    // 新增：导出日志
    exportLogs() {
        if (this.accountLogs.length === 0) {
            alert('没有日志可以导出！');
            return;
        }
        
        try {
            // 创建CSV内容
            let csvContent = '时间,类型,内容,IP地址,设备\n';
            
            const sortedLogs = [...this.accountLogs].sort((a, b) => {
                const timeA = a.timestamp || (a.data && a.data.timestamp) || 0;
                const timeB = b.timestamp || (b.data && b.data.timestamp) || 0;
                return new Date(timeB) - new Date(timeA);
            });
            
            sortedLogs.forEach(log => {
                const logData = log.data || log;
                const timestamp = log.timestamp || logData.timestamp || new Date().toISOString();
                const type = this.getLogTypeText(log.type || logData.type || 'info');
                const message = (logData.message || logData.event || logData.data || '无内容').toString().replace(/"/g, '""');
                const ip = logData.ip || log.ip || '';
                const device = logData.device || log.device || '';
                
                const row = [
                    this.formatLogTime(timestamp),
                    type,
                    `"${message}"`,
                    ip,
                    device
                ];
                
                csvContent += row.join(',') + '\n';
            });
            
            // 创建下载链接
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

    // 新增：显示日志详情
    showLogDetails(log) {
        // 提取日志信息
        const logData = log.data || log;
        const timestamp = log.timestamp || logData.timestamp || new Date().toISOString();
        const type = this.getLogTypeText(log.type || logData.type || 'info');
        const message = logData.message || logData.event || logData.data || '无内容';
        const ip = logData.ip || log.ip || '--';
        const device = logData.device || log.device || '--';
        
        const detailText = `
            日志详情:
            
            时间: ${this.formatLogTime(timestamp)}
            类型: ${type}
            内容: ${message}
            IP地址: ${ip}
            设备: ${device}
            
            原始数据:
            ${JSON.stringify(log, null, 2)}
        `;
        
        // 使用自定义弹窗
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

    // 新增：显示日志加载状态
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

    // 新增：显示日志消息
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

    // 新增：格式化日志时间
    formatLogTime(timestamp) {
        if (!timestamp) return '--';
        
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '无效时间';
            
            const now = new Date();
            
            // 如果是今天，显示时间
            if (date.toDateString() === now.toDateString()) {
                return date.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
            
            // 如果是今年，显示月日和时间
            if (date.getFullYear() === now.getFullYear()) {
                return date.toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
            
            // 否则显示完整日期
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

    // 新增：获取日志类型文本
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
            'security': '安全',
            'cpm_getaccountlog': 'CPM日志',
            'player_records': '玩家数据',
            'car_data': '车辆数据',
            'simulated': '模拟'
        };
        
        return typeMap[type] || type || '信息';
    }

    // 新增：生成演示日志数据（当API不可用时）
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
        
        // 生成30条演示日志
        for (let i = 0; i < 30; i++) {
            const type = logTypes[Math.floor(Math.random() * logTypes.length)];
            const messageIndex = Math.floor(Math.random() * logMessages[type].length);
            
            // 时间从最近30天内随机
            const timestamp = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
            
            this.accountLogs.push({
                type: type,
                timestamp: timestamp.toISOString(),
                data: {
                    type: type,
                    message: logMessages[type][messageIndex],
                    ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
                    device: ['Windows PC', 'Android Phone', 'iOS Device', 'Mac'][Math.floor(Math.random() * 4)],
                    timestamp: timestamp.toISOString()
                }
            });
        }
    }

    // 修改：在登录成功时加载日志
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
                this.hideElement('login-section');
                this.showElement('clone-section');
                this.showElement('account-info-section');
                this.showElement('money-section');
                this.updateProgress('登录成功', 25);
                this.addLog('✓ 登录成功');
                this.updateStep(1);
                
                await this.verifyAndLoadAccount(data.auth);
                
                // 新增：登录成功后加载日志
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

    // 修改：在验证账号时加载日志
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
                
                // 新增：验证成功后加载日志
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

    // 修改：退出时清空日志
    logout() {
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.accountLogs = []; // 清空日志
        localStorage.removeItem('jbcacc_auth');
        
        this.showElement('login-section');
        this.hideElement('clone-section');
        this.hideElement('account-info-section');
        this.hideElement('money-section');
        
        // 清空输入框
        const sourceEmail = document.getElementById('source-email');
        const sourcePassword = document.getElementById('source-password');
        if (sourceEmail) sourceEmail.value = '';
        if (sourcePassword) sourcePassword.value = '';
        
        // 重置账号信息显示
        document.getElementById('account-name').textContent = '--';
        document.getElementById('account-money').textContent = '--';
        document.getElementById('account-green-cash').textContent = '--';
        document.getElementById('account-cars').textContent = '--';
        document.getElementById('account-localid').textContent = '--';
        
        const statusBadge = document.getElementById('account-status');
        statusBadge.textContent = '未登录';
        statusBadge.setAttribute('data-status', 'offline');
        
        // 清空日志显示
        this.showLogsMessage('请先登录账号查看日志');
        document.getElementById('logs-total').textContent = '0';
        document.getElementById('logs-last-login').textContent = '--';
        document.getElementById('logs-login-count').textContent = '0';
        
        this.showStatus('info', '已退出登录', 'login-status');
        this.addLog('已退出登录');
        this.updateStep(1);
    }

    // 原有方法保持不变
    displayAccountInfo(accountData) {
        // ... 你的原有代码 ...
    }

    formatNumber(num) {
        // ... 你的原有代码 ...
    }

    updateMoneyOperationUI(operationType) {
        // ... 你的原有代码 ...
    }

    async modifyMoney() {
        // ... 你的原有代码 ...
    }

    async refreshMoney() {
        // ... 你的原有代码 ...
    }

    async cloneAccount() {
        // ... 你的原有代码 ...
    }

    async loadCarsCount(authToken) {
        // ... 你的原有代码 ...
    }

    // 原有的辅助方法
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

    // 其他原有方法保持不变
    checkSession() {
        // ... 你的原有代码 ...
    }

    testConnection() {
        // ... 你的原有代码 ...
    }

    initStepIndicator() {
        // ... 你的原有代码 ...
    }

    initOperationType() {
        // ... 你的原有代码 ...
    }

    initMoneyOperation() {
        // ... 你的原有代码 ...
    }

    updateTimeEstimate() {
        // ... 你的原有代码 ...
    }

    updateProgress(message, percent) {
        // ... 你的原有代码 ...
    }
}

// DOM加载事件保持不变
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成');
    
    try {
        const app = new cpmcylone();
        app.init();
        console.log('cpmcy Clone应用初始化成功');
        
        console.log('应用版本: 2.4 (修复日志获取功能)');
        console.log('环境:', window.location.origin.includes('localhost') ? '开发环境' : '生产环境');
        
        // 添加自动刷新日志的定时器（每5分钟）
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
