const API = '/api';
let token = null;
let isTestCardUser = false; 
const logs = [];
const pendingChanges = {};

// ================= 🌍 多语言系统 (修复且补全) =================
const translations = {
    zh: {
        main_title: "季伯常工作室",
        auth_title: "🔒 安全访问验证",
        btn_verify: "验证秘钥",
        ad_text: "还不知道秘钥在哪里领取？<br>以下为老季的联系方式👇",
        key_status_title: "⚠️ 秘钥状态提醒",
        key_expire: "到期时间",
        key_remains: "剩余次数",
        login_tip: "老季温馨提醒：<br>使用工具前请先保存数据并退出账号！<br>没退出账号导致修改失效，不退不补秘钥！",
        tab_login: "登录游戏账号",
        tab_reg: "注册新号",
        btn_login_bind: "登录并绑定",
        reg_tip: "注册将消耗 1 次修复次数",
        btn_reg: "注册",
        btn_back: "返回首页",
        key_detail: "🔑 秘钥权益详情",
        lbl_email: "当前账号",
        lbl_nick_id: "昵称 / ID / 当前车ID",
        lbl_coin: "金币",
        lbl_cash: "绿钞",
        lbl_level: "等级",
        lbl_cars: "车辆数",
        lbl_win: "胜",
        lbl_lose: "负",
        btn_refresh: "🔄 刷新",
        btn_fix: "一键修复",
        btn_logout: "退出",
        res_mod: "✏️ 资源修改",
        tech_mod: "🚀 黑科技",
        clone_mod: "🧬 克隆",
        car_custom: "🛠️ 车辆深度定制",
        btn_mod_coin: "改金币",
        btn_mod_cash: "改绿钞",
        btn_mod_win: "改胜场",
        btn_mod_lose: "改败场",
        btn_mod_name: "改名",
        btn_mod_id: "改ID",
        btn_mod_car_attr: "进入改装",
        btn_fuel: "⛽ 油",
        btn_dmg: "🛡️ 无伤",
        btn_smoke: "💨 烟",
        btn_house: "🏠 房",
        btn_police: "🚨 警灯",
        auto_reg: "自动注册",
        btn_start_clone: "开始克隆",
        logs: "📜 操作日志",
        clear: "清空",
        processing: "处理中...",
        warning_title: "⚠️ 严重警告",
        warning_text: "此操作将<b>强制覆盖</b>当前账号所有进度！",
        warning_agree: "我已阅读并承担所有风险",
        cancel: "取消",
        confirm_fix: "同意修复",
        global_unlock: "🔓 全局解锁",
        btn_unlock_horns: "🎺 解锁喇叭",
        btn_unlock_cars: "🏎️ 解锁所有车",
        btn_unlock_levels: "🏆 解锁成就",
        acc_manage: "👤 账号管理",
        btn_del_acc: "❌ 删除当前账号",
        del_title: "⛔ 永久删除账号",
        del_warn: "确定要删除当前登录的账号吗？此操作<b>无法撤销</b>！数据将永久丢失！",
        del_cost: "* 消耗 1 次高级操作次数",
        confirm_del: "确认删除",
        target_car_id: "目标车辆ID",
        tab_perf: "动力",
        tab_visual: "外观",
        tab_susp: "悬挂",
        btn_apply: "应用修改",
        bumpers: "🎨 保险杠与尾翼",
        rm_front: " 拆前杠",
        rm_rear: " 拆后杠",
        spoiler_id: "安装尾翼ID:",
        paint_job: "🌈 车漆定制 (支持电镀)",
        paint_tip: "亮度 1.0 正常，>5.0 发光",
        col_body: "车身:",
        col_ref: "反光:",
        col_win: "车窗:",
        col_rim: "轮毂:",
        col_head: "车灯:",
        wheels: "🛞 轮毂改装",
        close: "关闭",
        car_custom_tip: "修改特定车辆的动力、外观、悬挂等",
        camber: "外倾角:",
        debug_tab: "🔧 调试",
        debug_raw_response: "原始 API 响应"
    },
    en: {
        main_title: "JBC Studio",
        auth_title: "🔒 Verification",
        btn_verify: "Verify Key",
        ad_text: "Need a key? Contact us below👇",
        key_status_title: "⚠️ Key Status",
        key_expire: "Expires At",
        key_remains: "Remaining",
        login_tip: "Warning: Please save data and logout before using tools!",
        tab_login: "Login",
        tab_reg: "Register",
        btn_login_bind: "Login & Bind",
        reg_tip: "Registration costs 1 repair count",
        btn_reg: "Register",
        btn_back: "Back",
        key_detail: "🔑 Key Details",
        lbl_email: "Account",
        lbl_nick_id: "Name / ID / CarID",
        lbl_coin: "Coins",
        lbl_cash: "Cash",
        lbl_level: "Level",
        lbl_cars: "Cars",
        lbl_win: "Wins",
        lbl_lose: "Loses",
        btn_refresh: "🔄 Refresh",
        btn_fix: "Fix Account",
        btn_logout: "Logout",
        res_mod: "✏️ Resources",
        tech_mod: "🚀 Hacks",
        clone_mod: "🧬 Clone",
        car_custom: "🛠️ Car Mod",
        btn_mod_coin: "Set Coins",
        btn_mod_cash: "Set Cash",
        btn_mod_win: "Set Wins",
        btn_mod_lose: "Set Loses",
        btn_mod_name: "Set Name",
        btn_mod_id: "Set ID",
        btn_mod_car_attr: "Enter Mod",
        btn_fuel: "⛽ Fuel",
        btn_dmg: "🛡️ No Dmg",
        btn_smoke: "💨 Smoke",
        btn_house: "🏠 Houses",
        btn_police: "🚨 Police",
        auto_reg: "Auto Reg",
        btn_start_clone: "Start Clone",
        logs: "📜 Logs",
        clear: "Clear",
        processing: "Processing...",
        warning_title: "⚠️ Warning",
        warning_text: "This will <b>overwrite</b> your account data!",
        warning_agree: "I agree to the risks",
        cancel: "Cancel",
        confirm_fix: "Confirm",
        global_unlock: "🔓 Global Unlock",
        btn_unlock_horns: "🎺 Horns",
        btn_unlock_cars: "🏎️ All Cars",
        btn_unlock_levels: "🏆 Achieve",
        acc_manage: "👤 Account",
        btn_del_acc: "❌ Delete Acc",
        del_title: "⛔ Delete Account",
        del_warn: "Permanently delete this account? Irreversible!",
        del_cost: "* Costs 1 unlock count",
        confirm_del: "Delete",
        target_car_id: "Target Car ID",
        tab_perf: "Perf",
        tab_visual: "Visual",
        tab_susp: "Susp",
        btn_apply: "Apply",
        bumpers: "🎨 Bumpers & Spoiler",
        rm_front: " No Front",
        rm_rear: " No Rear",
        spoiler_id: "Spoiler ID:",
        paint_job: "🌈 Paint Job",
        paint_tip: "Bright > 5.0 for Glow",
        col_body: "Body:",
        col_ref: "Reflect:",
        col_win: "Window:",
        col_rim: "Rim:",
        col_head: "Head:",
        wheels: "🛞 Wheels",
        close: "Close",
        car_custom_tip: "Modify engine, paint, suspension etc.",
        camber: "Camber:",
        debug_tab: "🔧 Debug",
        debug_raw_response: "Raw API Response"
    }
};

let currentLang = 'zh';

function changeLanguage(lang) {
    currentLang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (translations[lang] && translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });
}

function getBrowserFingerprint() {
    const attrs = [
        navigator.userAgent,              
        navigator.language,               
        screen.colorDepth,                
        screen.width + 'x' + screen.height, 
        new Date().getTimezoneOffset(),   
        navigator.hardwareConcurrency || 1, 
        navigator.deviceMemory || 1         
    ];
    const str = attrs.join('###');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; 
    }
    return 'DEV_' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

const limitLabels = {
    coins: "金币", cash: "绿钞", wins: "胜场", loses: "败场", 
    name: "改名", id: "改ID", w16: "W16引擎", fuel: "无限油", 
    damage: "无伤", smoke: "彩烟", houses: "解锁房", police: "警车", 
    clone: "克隆", init: "修复/注册", car_mod: "车辆改装", unlock: "成就/删号"
};

document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('jbc_token'); 
    let devId = localStorage.getItem('device_id');
    const fingerprint = getBrowserFingerprint();
    if (!devId || devId !== fingerprint) {
        console.log("检测到新设备或ID需修正，更新为硬件指纹ID");
        devId = fingerprint;
        localStorage.setItem('device_id', devId);
    } else {
        console.log("设备ID验证通过:", devId);
    }
    showView('verify');
    changeLanguage('zh'); 
});

function showLoading(msg = "处理中...") {
    document.getElementById('loading-text').innerText = msg;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showView(name) {
    ['verify', 'admin-choice', 'admin', 'auth', 'main'].forEach(v => {
        const el = document.getElementById(`${v}-view`);
        if(el) el.style.display = 'none';
    });
    document.querySelectorAll('.modal-overlay').forEach(e => e.style.display = 'none');
    const target = document.getElementById(`${name}-view`);
    if (target) target.style.display = 'block';
    changeLanguage(currentLang);
}

function addLog(msg, type='info') { 
    console.log(`[${type}] ${msg}`);
    const container = document.getElementById('logs-container');
    if (container) {
        const time = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
        container.insertBefore(div, container.firstChild);
    }
}

// ✅ 新增：显示调试原始响应
function updateDebugPanel(rawResponse) {
    const debugEl = document.getElementById('debug-raw-response');
    if (debugEl) {
        if (rawResponse) {
            try {
                const formatted = JSON.stringify(JSON.parse(rawResponse), null, 2);
                debugEl.textContent = formatted;
            } catch {
                debugEl.textContent = rawResponse;
            }
        } else {
            debugEl.textContent = '暂无响应数据';
        }
    }
}

async function req(path, body) {
    const isBackground = path.includes('refresh'); 
    if(!isBackground) showLoading();
    try {
        const headers = { 'Content-Type': 'application/json' };
        if(token) headers['Authorization'] = token;
        const res = await fetch(API+path, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if(!isBackground) hideLoading();
        if(res.status === 401) { alert("会话失效，请重新验证"); location.reload(); return { success: false }; }
        // 如果返回包含 debugRaw，更新调试面板
        if (data.debugRaw !== undefined) {
            updateDebugPanel(data.debugRaw);
        }
        return data;
    } catch(e) {
        if(!isBackground) hideLoading();
        addLog("网络请求失败: " + e.message, 'error');
        return { success: false };
    }
}

async function doVerify() {
    const key = document.getElementById('v-key').value.trim();
    if(!key) return alert("请输入秘钥");
    const currentDevId = localStorage.getItem('device_id') || getBrowserFingerprint();
    const res = await req('/auth/verify', { key, deviceId: currentDevId });
    if(res.success) {
        token = res.token;
        if(res.isAdmin) {
            showView('admin-choice');
        } else {
            isTestCardUser = !!res.isTestCard;
            if (isTestCardUser) alert("提示：您正在使用测试卡，仅允许修改绿钞，且会强制改名。");
            if(res.keyInfo) {
                window.currentKeyInfo = res.keyInfo;
                const alertBox = document.getElementById('key-alert-box');
                const expiryEl = document.getElementById('alert-expire');
                const limitsEl = document.getElementById('alert-limits');
                if (alertBox && expiryEl && limitsEl) {
                    alertBox.style.display = 'block';
                    expiryEl.innerText = res.keyInfo.expireAt;
                    const l = res.keyInfo.limits;
                    const importantLimits = [];
                    if(l.cash > 0) importantLimits.push(`绿钞:${l.cash}`);
                    if(l.police > 0) importantLimits.push(`警灯:${l.police}`);
                    if(l.clone > 0) importantLimits.push(`克隆:${l.clone}`);
                    if(l.car_mod > 0) importantLimits.push(`改装:${l.car_mod}`);
                    if(l.unlock > 0) importantLimits.push(`高级:${l.unlock}`);
                    if(importantLimits.length === 0) limitsEl.innerText = "无限 / 充足";
                    else limitsEl.innerText = importantLimits.join(' | ');
                }
            }
            showView('auth');
        }
    } else {
        alert("验证失败: " + res.message);
    }
}

function enterAdminCenter() { showView('admin'); loadKeys(); }
function enterUserCenterAsAdmin() { isTestCardUser=false; showView('auth'); }

const renderLimit = (v) => v === -1 ? '∞' : v;

function groupKeys(keys) {
    const groups = {};
    keys.forEach(k => {
        const date = k.createdAt ? k.createdAt.split('T')[0] : '未知日期';
        if (!groups[date]) groups[date] = {};
        const note = k.note || '无备注';
        if (!groups[date][note]) groups[date][note] = [];
        groups[date][note].push(k);
    });
    return groups;
}

async function loadKeys() {
    const res = await req('/admin/keys', {});
    if(!res.success) return;
    for (let k in pendingChanges) delete pendingChanges[k];
    const groups = groupKeys(res.keys);
    const container = document.getElementById('keys-list');
    container.innerHTML = ''; 
    Object.keys(groups).sort().reverse().forEach(date => {
        const dateGroup = document.createElement('details');
        dateGroup.className = 'group-date';
        dateGroup.open = true;
        dateGroup.innerHTML = `<summary>📅 ${date}</summary>`;
        const noteContainer = document.createElement('div');
        noteContainer.className = 'group-content';
        const notes = groups[date];
        Object.keys(notes).forEach(note => {
            const noteGroup = document.createElement('details');
            noteGroup.className = 'group-note';
            noteGroup.innerHTML = `<summary>👤 ${note} <span class="badge">${notes[note].length}</span></summary>`;
            const keyListDiv = document.createElement('div');
            keyListDiv.className = 'group-content';
            notes[note].forEach(k => { keyListDiv.innerHTML += renderKeyItem(k); });
            noteGroup.appendChild(keyListDiv);
            noteContainer.appendChild(noteGroup);
        });
        dateGroup.appendChild(noteContainer);
        container.appendChild(dateGroup);
    });
}

function renderKeyItem(k) {
    let isExpired = false;
    let expireText = '';
    if (k.durationHours !== -1 && k.activatedAt) {
        const expireTime = new Date(k.activatedAt).getTime() + (k.durationHours * 3600 * 1000);
        if (Date.now() > expireTime) {
            isExpired = true;
            expireText = '<span style="color:red; font-weight:bold;"> [已过期]</span>';
        }
    }
    let accTable = '<div style="color:#666; font-size:12px; padding:5px;">暂无绑定</div>';
    if (k.boundAccounts && k.boundAccounts.length > 0) {
        accTable = `
        <table class="acc-table">
            <thead><tr><th>邮箱</th><th>密码(B64)</th><th>时间</th></tr></thead>
            <tbody>
                ${k.boundAccounts.map(a => `<tr><td>${a.email||a}</td><td>${a.pass||'-'}</td><td>${a.time ? a.time.split('T')[0] : '-'}</td></tr>`).join('')}
            </tbody>
        </table>`;
    }
    const genEditRow = (label, field, val) => `
        <div class="limit-edit-row">
            <span>${label}: <b id="val-${k.id}-${field}" style="color:var(--accent-green)">${renderLimit(val)}</b></span>
            <div>
                <button class="btn-xs" onclick="localEdit('${k.id}', '${field}', -1)">-1</button>
                <button class="btn-xs" onclick="localEdit('${k.id}', '${field}', 1)">+1</button>
                <button class="btn-xs" onclick="localEdit('${k.id}', '${field}', 'N')">∞</button>
            </div>
        </div>`;
    return `
    <div class="key-item ${isExpired ? 'expired-key' : ''}" id="key-${k.id}">
        <div class="key-header">
            <div>
                <div class="key-code">${k.id} ${k.isTestCard?'<span style="color:red;border:1px solid red;">测试</span>':''}${expireText}</div>
                <div class="key-note">${k.note}</div>
            </div>
            <div>
                <button class="btn btn-sm btn-blue" onclick="copyKey('${k.id}')">复制</button>
                <button class="btn btn-sm btn-dark" onclick="toggleDetails(this)">详情</button>
                <button class="btn btn-sm btn-red" onclick="deleteKey('${k.id}')">删</button>
            </div>
        </div>
        <div class="key-details" style="display:none;">
            <div id="action-${k.id}" style="display:none; margin-bottom:10px; padding:5px; background:#331100; text-align:center; border:1px solid #ff4400;">
                <span style="color:#ffaa00; font-size:12px;">有未保存的修改</span>
                <button class="btn-xs btn-green" onclick="saveKeyConfig('${k.id}')">💾 保存配置</button>
            </div>
            <p>激活时间: ${k.activatedAt ? new Date(k.activatedAt).toLocaleString() : '未激活'}</p>
            <p>设备数: ${k.boundDevices ? k.boundDevices.length : 0}</p>
            <div class="section-title">核心限制</div>
            <div class="limits-box">
                ${genEditRow('时长(时)', 'durationHours', k.durationHours)}
                ${genEditRow('设备上限', 'maxDevices', k.maxDevices)}
                ${genEditRow('账号上限', 'maxAccounts', k.maxAccounts)}
            </div>
            <div class="section-title">功能次数</div>
            <div class="limits-box">
                ${Object.keys(k.usageLimits).map(f => genEditRow(limitLabels[f] || f, 'usageLimits.'+f, k.usageLimits[f])).join('')}
            </div>
            <div class="section-title">绑定列表</div>
            <div class="acc-list-box">${accTable}</div>
        </div>
    </div>`;
}

window.localEdit = function(keyId, field, change) {
    if (!pendingChanges[keyId]) pendingChanges[keyId] = {};
    const el = document.getElementById(`val-${keyId}-${field}`);
    let currentText = el.innerText;
    let currentVal = currentText === '∞' ? -1 : parseInt(currentText);
    let newVal;
    if (change === 'N') {
        newVal = -1;
    } else {
        if (currentVal === -1) newVal = 1; 
        else {
            newVal = currentVal + change;
            if (newVal < -1) newVal = 0; 
        }
    }
    el.innerText = renderLimit(newVal);
    el.style.color = '#ff9900'; 
    if (field.includes('.')) {
        if (!pendingChanges[keyId].usageLimits) pendingChanges[keyId].usageLimits = {};
        const subField = field.split('.')[1];
        pendingChanges[keyId].usageLimits[subField] = newVal;
    } else {
        pendingChanges[keyId][field] = newVal;
    }
    document.getElementById(`action-${keyId}`).style.display = 'block';
};

window.saveKeyConfig = async function(keyId) {
    if (!pendingChanges[keyId]) return;
    const res = await req('/admin/save_key_config', { targetKey: keyId, updates: pendingChanges[keyId] });
    if (res.success) { alert("保存成功！"); delete pendingChanges[keyId]; loadKeys(); } 
    else { alert("保存失败: " + res.message); }
};

function toggleDetails(btn) {
    const details = btn.closest('.key-item').querySelector('.key-details');
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
}

function copyKey(key) { navigator.clipboard.writeText(key).then(() => alert("已复制")); }

function filterKeys() {
    const text = document.getElementById('key-search').value.toLowerCase();
    document.querySelectorAll('.key-item').forEach(item => {
        const visible = item.innerText.toLowerCase().includes(text);
        item.style.display = visible ? 'block' : 'none';
        if (visible && text.length > 0) {
            let parent = item.parentElement.parentElement; 
            if(parent.tagName === 'DETAILS') parent.open = true;
            let grandParent = parent.parentElement.parentElement;
            if(grandParent.tagName === 'DETAILS') grandParent.open = true;
        }
    });
}

function openGenModal() { document.getElementById('modal-gen-key').style.display = 'flex'; toggleTestCard(); }

function toggleTestCard() {
    const isTest = document.getElementById('k-is-test').checked;
    const inputs = document.querySelectorAll('.limit-grid input');
    inputs.forEach(inp => {
        if(inp.id !== 'k-is-test' && inp.id !== 'k-note' && inp.id !== 'k-count') {
            inp.disabled = isTest;
            if (isTest) { inp.dataset.oldVal = inp.value; inp.value = "自动"; } 
            else { inp.value = inp.dataset.oldVal || "1"; }
        }
    });
}

async function confirmGenKey() {
    const isTest = document.getElementById('k-is-test').checked;
    const countVal = document.getElementById('k-count').value;
    const note = document.getElementById('k-note').value;
    const config = {
        duration: document.getElementById('k-duration').value,
        maxDevices: document.getElementById('k-max-dev').value,
        maxAccounts: document.getElementById('k-max-acc').value,
        limits: {
            coins: document.getElementById('kl-coins').value,
            cash: document.getElementById('kl-cash').value,
            wins: document.getElementById('kl-wins').value,
            loses: document.getElementById('kl-loses').value,
            name: document.getElementById('kl-name').value,
            id: document.getElementById('kl-id').value,
            w16: document.getElementById('kl-w16').value,
            fuel: document.getElementById('kl-fuel').value,
            damage: document.getElementById('kl-damage').value,
            smoke: document.getElementById('kl-smoke').value,
            houses: document.getElementById('kl-houses').value,
            police: document.getElementById('kl-police').value,
            clone: document.getElementById('kl-clone').value,
            init: document.getElementById('kl-init').value,
            car_mod: document.getElementById('kl-car-mod').value,
            unlock: document.getElementById('kl-unlock').value
        }
    };
    const res = await req('/admin/generate', { config, note, isTestCard: isTest, count: countVal });
    if(res.success) {
        document.getElementById('modal-gen-key').style.display='none';
        loadKeys();
        const container = document.createElement('div');
        container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;";
        container.innerHTML = `<h3 style="color:white; margin-bottom:10px;">成功生成 ${res.keys.length} 张</h3><textarea style="width:80%; height:50%; background:#111; color:#0f0; border:1px solid #333; padding:10px;">${res.keys.join('\n')}</textarea><button onclick="this.parentElement.remove()" style="margin-top:20px; padding:10px 30px; cursor:pointer;">关闭</button>`;
        document.body.appendChild(container);
    } else {
        alert("生成失败: " + res.message);
    }
}

async function deleteKey(k) { if(confirm("确定删除？")) { await req('/admin/delete', { targetKey: k }); loadKeys(); } }

async function deleteExpiredKeys() {
    if(confirm("⚠️ 确定要一键删除所有已过期的秘钥吗？此操作无法撤销！")) {
        const res = await req('/admin/delete_expired', {});
        if(res.success) { alert(`成功删除了 ${res.count} 个过期秘钥`); loadKeys(); }
        else alert(res.message);
    }
}

// --- 用户界面 ---
function initUI(data, keyInfo, needsInit) {
    showView('main');
    document.getElementById('d-email').innerText = data.email || "未绑定邮箱";
    document.getElementById('d-name').innerText = data.name;
    document.getElementById('d-id').innerText = data.localID;
    document.getElementById('d-coin').innerText = kFmt(data.coins);
    document.getElementById('d-cash').innerText = kFmt(data.cash);
    document.getElementById('d-level').innerText = data.level || 0;
    document.getElementById('d-wins').innerText = data.wins;
    document.getElementById('d-loses').innerText = data.loses;
    document.getElementById('d-cars').innerText = data.carCount || 0;
    if(document.getElementById('d-cur-car')) {
        document.getElementById('d-cur-car').innerText = data.curCar || "未知";
    }
    document.getElementById('btn-manual-fix').style.display = needsInit ? 'block' : 'none';

    if (keyInfo && (keyInfo.type === 'user' || keyInfo.type === 'admin')) {
        const detailBox = document.getElementById('key-detail-box');
        if(detailBox) {
            detailBox.style.display = 'block';
            document.getElementById('k-expiry').innerText = keyInfo.expireAt;
            document.getElementById('k-devs').innerText = `${keyInfo.devCount}/${renderLimit(keyInfo.devMax)}`;
            document.getElementById('k-accs').innerText = `${keyInfo.accCount}/${renderLimit(keyInfo.accMax)}`;
        }
        const limits = keyInfo.limits || {};
        const updateBtn = (btnId, limitKey) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            if (keyInfo.type === 'admin') { btn.disabled=false; return; }
            const limit = limits[limitKey];
            btn.disabled = (limit === 0);
        };
        updateBtn('btn-mod-coins', 'coins');
        updateBtn('btn-mod-cash', 'cash');
        updateBtn('btn-open-car-mod', 'car_mod');
        updateBtn('btn-unlock-all-cars', 'unlock'); 
        updateBtn('btn-unlock-horns', 'unlock');
        updateBtn('btn-unlock-levels', 'unlock'); 
        updateBtn('btn-delete-acc', 'unlock');
    }
}

function kFmt(num) {
    if(!num) return '0';
    if(num>=1e9) return (num/1e9).toFixed(2)+'B';
    if(num>=1e6) return (num/1e6).toFixed(2)+'M';
    if(num>=1e4) return (num/1e4).toFixed(1)+'w';
    return num;
}

async function doLogin() {
    const email = document.getElementById('l-email').value;
    const password = document.getElementById('l-pass').value;
    if(!email||!password) return alert("输入不完整");
    const res = await req('/login', { email, password });
    if(res.success) { 
        userEmail = email; 
        addLog(`登录成功: ${email}`, 'success');
        initUI(res.data, res.keyInfo || window.currentKeyInfo, res.needsInit); 
    } else {
        alert(res.message);
        addLog(`登录失败: ${res.message}`, 'error');
    }
}

async function modBase(field) {
    const inputs = { 'coins': 'm-coin', 'cash': 'm-cash', 'wins': 'm-wins', 'loses': 'm-loses', 'name': 'm-name', 'id': 'm-id' };
    const val = document.getElementById(inputs[field]).value;
    if(!val) return alert("请输入值");
    const res = await req('/mod', { type: field, value: val });
    if(res.success) { 
        addLog(`修改 ${field} 为 ${val} 成功`, 'success');
        doRefresh(); 
    } else {
        alert(res.message);
    }
}

async function modTech(type) {
    const res = await req('/mod', { type });
    if(res.success) addLog(`开启科技 ${type} 成功`, 'success');
    else alert(res.message);
}

function openCarModModal() {
    const carId = document.getElementById('target-car-id').value;
    if(!carId) return alert("请先输入车辆ID");
    document.getElementById('car-mod-id').value = carId;
    document.getElementById('modal-car-mod').style.display = 'flex';
    showCarTab('perf');
}

function showCarTab(tab) {
    document.querySelectorAll('.car-tab-content').forEach(e=>e.style.display='none');
    document.querySelectorAll('.tabs .tab').forEach(e=>e.classList.remove('active'));
    document.getElementById('ctab-'+tab).style.display='block';
}

async function doModCarPerf() {
    const carId = document.getElementById('car-mod-id').value;
    const body = {
        carId,
        hp: document.getElementById('cm-hp').value,
        inner_hp: document.getElementById('cm-inner').value,
        nm: document.getElementById('cm-nm').value,
        torque: document.getElementById('cm-tq').value,
        camber: document.getElementById('cm-camber').value
    };
    const res = await req('/mod_car', body);
    if(res.success) { alert("动力修改成功"); doRefresh(); }
    else alert(res.message);
}

async function doModCarVisual() {
    const carId = document.getElementById('car-mod-id').value;
    const body = {
        carId,
        removeBumperFront: document.getElementById('cm-rm-f').checked,
        removeBumperRear: document.getElementById('cm-rm-r').checked,
        spoilerId: document.getElementById('cm-spoiler-id').value,
        wheelId: document.getElementById('cm-rim-id').value,
        wheelSize: document.getElementById('cm-rim-size').value,
        bodyColor: document.getElementById('cm-col-body').value,
        bodyBrightness: document.getElementById('cm-br-body').value,
        reflectionColor: document.getElementById('cm-col-ref').value,
        reflectionBrightness: document.getElementById('cm-br-ref').value,
        windowColor: document.getElementById('cm-col-win').value,
        windowBrightness: document.getElementById('cm-br-win').value,
        wheelColor: document.getElementById('cm-col-rim').value,
        wheelBrightness: document.getElementById('cm-br-rim').value,
        headlightColor: document.getElementById('cm-col-head').value
    };
    const res = await req('/mod_car_visual', body);
    if(res.success) { alert("外观修改成功"); doRefresh(); }
    else alert(res.message);
}

async function doModCarSuspension() {
    const carId = document.getElementById('car-mod-id').value;
    const body = {
        carId,
        distance: document.getElementById('cm-s-dist').value,
        stiffness: document.getElementById('cm-s-stiff').value,
        steer: document.getElementById('cm-s-steer').value,
        offset: document.getElementById('cm-s-offset').value
    };
    const res = await req('/mod_car_suspension', body);
    if(res.success) { alert("悬挂修改成功"); doRefresh(); }
    else alert(res.message);
}

async function doGlobalUnlock(type) {
    if(!confirm("⚠️ 确定要执行此全解锁操作吗？可能需要较长时间。")) return;
    const res = await req('/unlock_global', { type });
    if(res.success) { alert("解锁成功！"); doRefresh(); }
    else alert(res.message);
}

function openDeleteModal() { document.getElementById('modal-delete-acc').style.display='flex'; }
async function doDeleteAccount() {
    document.getElementById('modal-delete-acc').style.display='none';
    const res = await req('/account_manage', { action: 'delete' });
    if(res.success) { alert("账号已删除，系统即将刷新"); location.reload(); }
    else alert(res.message);
}

async function doClone() {
    if(!confirm("⚠️ 确定覆盖？")) return;
    const res = await req('/clone', { 
        targetEmail: document.getElementById('c-email').value,
        targetPassword: document.getElementById('c-pass').value,
        autoRegister: document.getElementById('c-auto').checked 
    });
    if(res.success) addLog(res.message, 'success');
    else alert(res.message);
}

function showTab(t) {
    document.querySelectorAll('.tab-content').forEach(e=>e.style.display='none');
    document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));
    document.getElementById('tab-'+t).style.display='block';
    if(t==='login') document.querySelectorAll('.tab')[0].classList.add('active'); else document.querySelectorAll('.tab')[1].classList.add('active');
}

function openFixModal() { document.getElementById('modal-warning').style.display='flex'; }
function closeModal() { document.getElementById('modal-warning').style.display='none'; }
document.getElementById('chk-agree')?.addEventListener('change', e=> document.getElementById('btn-confirm-fix').disabled=!e.target.checked);

async function confirmInit() { 
    closeModal(); 
    const res = await req('/init_account', {}); 
    if(res.success) { 
        alert("修复成功"); 
        addLog("一键修复成功", 'success');
        doRefresh(); 
    } else {
        alert(res.message);
        addLog("修复失败: " + res.message, 'error');
    }
}

async function doRegister() { 
    const res = await req('/register', { email: document.getElementById('r-email').value, password: document.getElementById('r-pass').value }); 
    if(res.success) { 
        alert("注册成功"); 
        addLog("注册新号成功", 'success');
        showTab('login'); 
    } else {
        alert(res.message);
        addLog("注册失败: " + res.message, 'error');
    }
}

async function doRefresh() { 
    const res = await req('/refresh', {}); 
    if(res.success) {
        initUI(res.data, res.keyInfo, false); 
    } else {
        alert(res.message);
    }
}

function clearLogs() { 
    logs.length=0; 
    document.getElementById('logs-container').innerHTML='';
}

function logout() { location.reload(); }
