const authToken = localStorage.getItem('authToken');
if (!authToken) {
  window.location.href = 'index.html';
}

// 页面加载时获取账号信息
window.onload = async () => {
  await fetchAccountInfo().catch(err => {
    showMessage('页面加载时获取账号信息失败，可手动刷新', 'error');
  });
};

// 打开弹窗
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'flex';
}

// 关闭所有弹窗
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.style.display = 'none';
  });
}

// 显示消息提示
function showMessage(text, type) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = `message ${type}`;
  message.style.display = 'block';
  setTimeout(() => {
    message.style.display = 'none';
  }, 3000);
}

// 获取账号信息
async function fetchAccountInfo() {
  try {
    const response = await fetch('/api/account-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken })
    });
    
    // 添加响应状态检查
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.ok) {
      document.getElementById('email').textContent = data.data.email || '未设置';
      document.getElementById('localId').textContent = data.data.localId || '未获取';
      document.getElementById('nickname').textContent = data.data.nickname || '未设置';
      document.getElementById('gold').textContent = data.data.gold || 0;
      document.getElementById('money').textContent = data.data.money || 0;
      document.getElementById('carCount').textContent = data.data.carCount || 0;
    } else {
      showMessage('获取账号信息失败: ' + data.message, 'error');
    }
  } catch (error) {
    console.error('获取账号信息错误:', error);
    showMessage('网络错误: ' + error.message, 'error');
  }
}

// 修改LocalID - 修复版
async function modifyLocalId() {
  const customLocalId = document.getElementById('customLocalIdInput').value.trim();
  if (!customLocalId) {
    showMessage('请输入自定义LocalID', 'error');
    return;
  }
  
  try {
    // 修复1: 确保参数格式正确
    const payload = { 
      token: authToken,  // 可能后端需要的是token而不是authToken
      localId: customLocalId 
    };
    
    console.log('修改LocalID请求:', payload);
    
    const response = await fetch('/api/modify-localid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    // 修复2: 检查HTTP状态
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP错误响应:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('修改LocalID响应:', data);
    
    if (data.ok) {
      showMessage(`LocalID修改成功！新ID: ${data.newLocalId || customLocalId}`, 'success');
      closeAllModals();
      // 刷新信息
      await fetchAccountInfo();
    } else {
      showMessage('修改失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('修改LocalID错误详情:', error);
    showMessage('请求失败: ' + error.message, 'error');
  }
}

// 克隆账号表单提交 - 修复版
document.getElementById('cloneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 添加加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const targetEmail = document.getElementById('targetEmail').value.trim();
    const targetPassword = document.getElementById('targetPassword').value;
    
    if (!targetEmail || !targetPassword) {
      showMessage('请输入目标账号邮箱和密码', 'error');
      return;
    }
    
    if (!confirm('⚠️ 确认克隆到已注册账号？会覆盖目标账号所有数据！')) {
      return;
    }
    
    // 修复: 确保参数名称与后端一致
    const payload = {
      sourceToken: authToken,  // 可能后端需要sourceToken而不是sourceAuth
      targetEmail: targetEmail,
      targetPassword: targetPassword
    };
    
    console.log('克隆请求:', { ...payload, targetPassword: '***' }); // 密码脱敏
    
    const response = await fetch('/api/clone-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP错误响应:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('克隆响应:', data);
    
    if (data.ok) {
      showMessage(`克隆成功！目标账号: ${data.targetEmail}，克隆车辆数: ${data.carsCloned}`, 'success');
      closeAllModals();
      document.getElementById('cloneForm').reset();
    } else {
      showMessage('克隆失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('克隆错误详情:', error);
    showMessage('请求失败: ' + error.message, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 修改金币表单提交 - 修复版
document.getElementById('goldForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 添加加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const goldAmount = document.getElementById('goldAmount').value.trim();
    
    if (!goldAmount) {
      showMessage('请输入金币数量', 'error');
      return;
    }
    
    // 验证是否为有效数字
    const goldNum = parseInt(goldAmount);
    if (isNaN(goldNum) || goldNum < 0) {
      showMessage('请输入有效的正整数', 'error');
      return;
    }
    
    // 修复: 确保参数名称正确
    const payload = {
      token: authToken,
      amount: goldNum  // 可能后端需要amount而不是goldAmount
    };
    
    console.log('修改金币请求:', payload);
    
    const response = await fetch('/api/modify-gold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP错误响应:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('修改金币响应:', data);
    
    if (data.ok) {
      showMessage(`金币修改成功！当前金币: ${data.newGold || data.goldAmount || goldNum}`, 'success');
      closeAllModals();
      // 直接更新UI，避免重新请求
      document.getElementById('gold').textContent = data.newGold || data.goldAmount || goldNum;
      document.getElementById('goldForm').reset();
    } else {
      showMessage('修改失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('修改金币错误详情:', error);
    showMessage('请求失败: ' + error.message, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 修改绿钞表单提交 - 修复版
document.getElementById('moneyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 添加加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const moneyAmount = document.getElementById('moneyAmount').value.trim();
    
    if (!moneyAmount) {
      showMessage('请输入绿钞数量', 'error');
      return;
    }
    
    // 验证是否为有效数字
    const moneyNum = parseInt(moneyAmount);
    if (isNaN(moneyNum) || moneyNum < 0) {
      showMessage('请输入有效的正整数', 'error');
      return;
    }
    
    // 修复: 尝试不同的参数名称
    const payload = {
      token: authToken,
      money: moneyNum  // 可能后端需要money而不是moneyAmount
    };
    
    console.log('修改绿钞请求:', payload);
    
    const response = await fetch('/api/modify-money', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP错误响应:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('修改绿钞响应:', data);
    
    if (data.ok) {
      showMessage(`绿钞修改成功！当前绿钞: ${data.newMoney || data.moneyAmount || moneyNum}`, 'success');
      closeAllModals();
      // 直接更新UI
      document.getElementById('money').textContent = data.newMoney || data.moneyAmount || moneyNum;
      document.getElementById('moneyForm').reset();
    } else {
      showMessage('修改失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('修改绿钞错误详情:', error);
    showMessage('请求失败: ' + error.message, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 点击空白处关闭弹窗
window.onclick = (e) => {
  if (e.target.classList.contains('modal')) {
    closeAllModals();
  }
};

// 按ESC键关闭弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

// 调试信息：在控制台输出当前token（开发时使用）
console.log('当前认证Token:', authToken ? '已设置' : '未设置');

// 如果还有问题，请提供：
// 1. 浏览器控制台(F12)的错误信息
// 2. 网络面板(Network)中的请求详情
// 3. 后端API期望的参数格式
