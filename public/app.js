// 检查登录状态
const authToken = localStorage.getItem('authToken');
if (!authToken) {
  window.location.href = 'index.html';
}

// 页面加载时获取账号信息
window.onload = async () => {
  try {
    await fetchAccountInfo();
  } catch (err) {
    console.error('页面加载错误:', err);
    showMessage('页面加载时获取账号信息失败，请手动刷新', 'error');
  }
};

// 打开弹窗
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'flex';
  // 清空表单
  document.querySelectorAll('form').forEach(form => {
    if (form.id !== 'logoutForm') {
      form.reset();
    }
  });
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
  message.style.opacity = '1';
  
  setTimeout(() => {
    message.style.opacity = '0';
    setTimeout(() => {
      message.style.display = 'none';
    }, 300);
  }, 3000);
}

// 获取账号信息
async function fetchAccountInfo() {
  try {
    const response = await fetch('/api/account-info', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ authToken })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok) {
      // 更新页面信息
      document.getElementById('email').textContent = data.data.email || '未设置';
      document.getElementById('localId').textContent = data.data.localId || '未获取';
      document.getElementById('nickname').textContent = data.data.nickname || '未设置';
      document.getElementById('gold').textContent = data.data.gold || 0;
      document.getElementById('money').textContent = data.data.money || 0;
      document.getElementById('carCount').textContent = data.data.carCount || 0;
    } else {
      showMessage('获取账号信息失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('获取账号信息错误:', error);
    throw new Error('网络错误: ' + error.message);
  }
}

// 修改LocalID
async function modifyLocalId() {
  const customLocalId = document.getElementById('customLocalIdInput').value.trim();
  
  if (!customLocalId) {
    showMessage('请输入自定义LocalID', 'error');
    return;
  }
  
  // 显示加载状态
  const modalBtn = document.querySelector('#localIdModal button[onclick="modifyLocalId()"]');
  const originalText = modalBtn.textContent;
  modalBtn.textContent = '处理中...';
  modalBtn.disabled = true;
  
  try {
    const response = await fetch('/api/modify-localid', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ 
        authToken, 
        customLocalId 
      })
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok) {
      showMessage(`LocalID修改成功！新ID: ${data.newLocalId || customLocalId}`, 'success');
      closeAllModals();
      
      // 立即更新UI
      document.getElementById('localId').textContent = data.newLocalId || customLocalId;
      
      // 刷新完整信息
      await fetchAccountInfo().catch(err => {
        console.warn('刷新账号信息失败:', err);
      });
    } else {
      showMessage(`修改失败: ${data.message || '未知错误'}`, 'error');
      console.error('LocalID修改失败详情:', data);
    }
  } catch (error) {
    console.error('LocalID修改请求错误:', error);
    showMessage(`请求失败: ${error.message}`, 'error');
  } finally {
    // 恢复按钮状态
    modalBtn.textContent = originalText;
    modalBtn.disabled = false;
  }
}

// 克隆账号表单提交
document.getElementById('cloneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 显示加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const targetEmail = document.getElementById('targetEmail').value.trim();
    const targetPassword = document.getElementById('targetPassword').value;
    
    // 验证输入
    if (!targetEmail || !targetPassword) {
      showMessage('请输入目标账号邮箱和密码', 'error');
      return;
    }
    
    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      showMessage('请输入有效的邮箱地址', 'error');
      return;
    }
    
    // 二次确认
    if (!confirm('⚠️ 警告：确认克隆到已注册账号？\n这将完全覆盖目标账号的所有数据！\n此操作不可撤销！')) {
      return;
    }
    
    // 发送请求
    const response = await fetch('/api/clone-account', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        sourceAuth: authToken,
        targetEmail,
        targetPassword
      })
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok) {
      showMessage(`克隆成功！目标账号: ${data.targetEmail}，克隆车辆数: ${data.carsCloned || '未知'}`, 'success');
      closeAllModals();
      document.getElementById('cloneForm').reset();
    } else {
      showMessage(`克隆失败: ${data.message || '未知错误'}`, 'error');
      console.error('克隆失败详情:', data);
    }
  } catch (error) {
    console.error('克隆请求错误:', error);
    showMessage(`请求失败: ${error.message}`, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 修改金币表单提交
document.getElementById('goldForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 显示加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const goldAmount = document.getElementById('goldAmount').value.trim();
    
    // 验证输入
    if (!goldAmount) {
      showMessage('请输入金币数量', 'error');
      return;
    }
    
    // 验证是否为有效数字
    const goldNum = parseInt(goldAmount, 10);
    if (isNaN(goldNum) || goldNum < 0 || goldNum > 999999999) {
      showMessage('请输入有效的金币数量（0-999,999,999）', 'error');
      return;
    }
    
    // 发送请求
    const response = await fetch('/api/modify-gold', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ 
        authToken, 
        goldAmount: goldNum 
      })
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok) {
      showMessage(`金币修改成功！当前金币: ${data.goldAmount || goldNum}`, 'success');
      closeAllModals();
      
      // 立即更新UI
      document.getElementById('gold').textContent = data.goldAmount || goldNum;
      
      // 清空表单
      document.getElementById('goldForm').reset();
    } else {
      showMessage(`修改失败: ${data.message || '未知错误'}`, 'error');
      console.error('金币修改失败详情:', data);
    }
  } catch (error) {
    console.error('金币修改请求错误:', error);
    showMessage(`请求失败: ${error.message}`, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 修改绿钞表单提交
document.getElementById('moneyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 显示加载状态
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '处理中...';
  submitBtn.disabled = true;
  
  try {
    const moneyAmount = document.getElementById('moneyAmount').value.trim();
    
    // 验证输入
    if (!moneyAmount) {
      showMessage('请输入绿钞数量', 'error');
      return;
    }
    
    // 验证是否为有效数字
    const moneyNum = parseInt(moneyAmount, 10);
    if (isNaN(moneyNum) || moneyNum < 0 || moneyNum > 999999999) {
      showMessage('请输入有效的绿钞数量（0-999,999,999）', 'error');
      return;
    }
    
    // 发送请求
    const response = await fetch('/api/modify-money', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ 
        authToken, 
        moneyAmount: moneyNum 
      })
    });
    
    // 检查HTTP状态
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok) {
      showMessage(`绿钞修改成功！当前绿钞: ${data.moneyAmount || moneyNum}`, 'success');
      closeAllModals();
      
      // 立即更新UI
      document.getElementById('money').textContent = data.moneyAmount || moneyNum;
      
      // 清空表单
      document.getElementById('moneyForm').reset();
    } else {
      showMessage(`修改失败: ${data.message || '未知错误'}`, 'error');
      console.error('绿钞修改失败详情:', data);
    }
  } catch (error) {
    console.error('绿钞修改请求错误:', error);
    showMessage(`请求失败: ${error.message}`, 'error');
  } finally {
    // 恢复按钮状态
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
});

// 添加其他功能表单提交（如果需要）
// 例如修改昵称等

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

// 刷新按钮功能
document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  const originalText = btn.textContent;
  btn.textContent = '刷新中...';
  btn.disabled = true;
  
  try {
    await fetchAccountInfo();
    showMessage('账号信息已刷新', 'success');
  } catch (error) {
    showMessage('刷新失败: ' + error.message, 'error');
  } finally {
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1000);
  }
});

// 退出登录
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  if (confirm('确定要退出登录吗？')) {
    localStorage.removeItem('authToken');
    window.location.href = 'index.html';
  }
});

// 防止表单意外提交
document.addEventListener('DOMContentLoaded', () => {
  // 为所有表单添加提交阻止
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', (e) => {
      // 已经由特定事件处理程序处理
    });
  });
  
  // 初始化时获取一次账号信息
  fetchAccountInfo().catch(err => {
    console.error('初始化获取账号信息失败:', err);
  });
});
