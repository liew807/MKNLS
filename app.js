// MKNLS 商城前端邏輯
class MKNLSStore {
  constructor() {
    this.apiBase = 'https://MKNLS.onrender.com/api';
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadProducts();
    this.setupCurrencyConverter();
  }

  // 設置事件監聽器
  setupEventListeners() {
    // 購物車功能
    document.addEventListener('click', (e) => {
      if (e.target.closest('.add_to_cart_button')) {
        e.preventDefault();
        this.handleAddToCart(e.target.closest('.add_to_cart_button'));
      }
    });

    // 貨幣切換
    const currencySelectors = document.querySelectorAll('[data-currency]');
    currencySelectors.forEach(selector => {
      selector.addEventListener('change', (e) => {
        this.switchCurrency(e.target.value);
      });
    });
  }

  // 加載產品數據
  async loadProducts() {
    try {
      const response = await fetch(`${this.apiBase}/products`);
      const data = await response.json();
      
      if (data.status === 'success') {
        this.renderProducts(data.data.hot_sales);
      }
    } catch (error) {
      console.error('加載產品失敗:', error);
    }
  }

  // 渲染產品列表
  renderProducts(products) {
    const container = document.querySelector('[data-products]');
    if (!container) return;

    // 可以在此處動態更新產品顯示
    console.log('產品數據加載完成:', products);
  }

  // 處理添加到購物車
  async handleAddToCart(button) {
    const productId = button.dataset.product_id;
    
    if (!productId) {
      console.error('未找到產品ID');
      return;
    }

    // 顯示加載狀態
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 添加中...';
    button.disabled = true;

    try {
      const response = await fetch(`${this.apiBase}/cart/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId: productId,
          quantity: 1
        })
      });

      const result = await response.json();

      if (result.status === 'success') {
        this.showSuccessMessage('產品已成功添加到購物車！');
        this.updateCartCount(result.data.cartTotal);
      } else {
        this.showErrorMessage('添加到購物車失敗，請重試');
      }
    } catch (error) {
      console.error('添加到購物車錯誤:', error);
      this.showErrorMessage('網絡錯誤，請檢查連接');
    } finally {
      // 恢復按鈕狀態
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }

  // 貨幣轉換功能
  async switchCurrency(currency) {
    const priceElements = document.querySelectorAll('.woocs_price_code');
    
    priceElements.forEach(async (element) => {
      const originalPrice = element.dataset.originalPrice || element.textContent;
      const amount = originalPrice.replace(/[^\d.]/g, '');
      
      if (amount) {
        try {
          const response = await fetch(
            `${this.apiBase}/currency/convert?amount=${amount}&from=TWD&to=${currency}`
          );
          const result = await response.json();
          
          if (result.status === 'success') {
            const symbol = this.getCurrencySymbol(currency);
            element.innerHTML = `<span class="woocommerce-Price-amount amount">
              <bdi>${symbol}${result.data.converted.amount}</bdi>
            </span>`;
          }
        } catch (error) {
          console.error('貨幣轉換失敗:', error);
        }
      }
    });
  }

  // 獲取貨幣符號
  getCurrencySymbol(currency) {
    const symbols = {
      'TWD': 'NT$',
      'MYR': 'RM',
      'USD': '$',
      'CNY': '¥',
      'EUR': '€'
    };
    return symbols[currency] || currency;
  }

  // 顯示成功消息
  showSuccessMessage(message) {
    this.showMessage(message, 'success');
  }

  // 顯示錯誤消息
  showErrorMessage(message) {
    this.showMessage(message, 'error');
  }

  // 顯示消息
  showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `mknls-message mknls-message-${type}`;
    messageDiv.innerHTML = `
      <div class="mknls-message-content">
        <span class="mknls-message-text">${message}</span>
        <button class="mknls-message-close">&times;</button>
      </div>
    `;

    // 樣式
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
      color: white;
      padding: 15px 20px;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 400px;
      animation: slideInRight 0.3s ease;
    `;

    document.body.appendChild(messageDiv);

    // 自動消失
    setTimeout(() => {
      messageDiv.remove();
    }, 5000);

    // 關閉按鈕
    messageDiv.querySelector('.mknls-message-close').addEventListener('click', () => {
      messageDiv.remove();
    });
  }

  // 更新購物車數量
  updateCartCount(count) {
    const cartCounts = document.querySelectorAll('.ct-dynamic-count-cart');
    cartCounts.forEach(element => {
      element.textContent = count;
      element.style.display = count > 0 ? 'flex' : 'none';
    });
  }
}

// CSS 動畫
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .mknls-message-close {
    background: none;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    margin-left: 10px;
  }

  .mknls-message-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
`;
document.head.appendChild(style);

// 初始化應用
document.addEventListener('DOMContentLoaded', () => {
  window.mknlsApp = new MKNLSStore();
});

// 導出供其他腳本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MKNLSStore;
}
