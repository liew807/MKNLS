const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

[DATA_DIR, UPLOAD_DIR, PUBLIC_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ==================== 数据读写 ====================
function readData(filename) {
    const p = path.join(DATA_DIR, filename);
    try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; }
    catch (e) { return []; }
}
function writeData(filename, data) {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

function initData() {
    const files = {
        'users.json': [],
        'admins.json': [{ id: 1, username: 'admin', password: 'admin123', role: 'super' }],
        'categories.json': [],
        'goods.json': [],
        'orders.json': [],
        'messages.json': [],
        'chats.json': [],
        'invites.json': [],
        'finances.json': [],
        'complaints.json': [],
        'lottery.json': { price: 10, items: [] },
        'counters.json': { lastReset: new Date().toDateString() }
    };
    for (const [f, d] of Object.entries(files)) {
        if (!fs.existsSync(path.join(DATA_DIR, f))) writeData(f, d);
    }
}

function genUID() {
    let users = readData('users.json'), uid;
    do { uid = Math.floor(10000 + Math.random() * 90000); } while (users.find(u => u.id === uid));
    return uid;
}
function genInvite(type) {
    return (type === 'player' ? 'P' : 'S') + Math.random().toString(36).substring(2, 7).toUpperCase();
}

// 每日重置
function checkDaily() {
    const counters = readData('counters.json');
    const today = new Date().toDateString();
    if (counters.lastReset !== today) {
        const users = readData('users.json');
        users.forEach(u => u.todayOrders = 0);
        writeData('users.json', users);
        counters.lastReset = today;
        writeData('counters.json', counters);
    }
}
setInterval(checkDaily, 300000);

// ==================== Socket.IO 实时聊天 ====================
const onlineUsers = {};
io.on('connection', (socket) => {
    console.log('连接:', socket.id);

    socket.on('join', (userId) => {
        onlineUsers[userId] = socket.id;
        socket.join('user_' + userId);
    });

    socket.on('chat_message', (data) => {
        const chats = readData('chats.json');
        const msg = {
            id: chats.length + 1,
            fromId: data.fromId,
            fromName: data.fromName,
            fromRole: data.fromRole,
            toId: data.toId || null,
            content: data.content,
            time: new Date().toLocaleString()
        };
        chats.push(msg);
        writeData('chats.json', chats);

        // 发送给发送者
        io.to('user_' + data.fromId).emit('new_message', msg);
        // 发送给接收者
        if (data.toId) io.to('user_' + data.toId).emit('new_message', msg);
        // 所有客服也能收到
        const users = readData('users.json');
        users.filter(u => u.role === 'service').forEach(s => {
            io.to('user_' + s.id).emit('new_message', msg);
        });
    });

    socket.on('disconnect', () => {
        for (let uid in onlineUsers) {
            if (onlineUsers[uid] === socket.id) delete onlineUsers[uid];
        }
    });
});

// ==================== API 路由 ====================

// 注册
app.post('/api/register', (req, res) => {
    const { username, password, role, inviteCode } = req.body;
    if (!username || !password) return res.json({ code: 400, msg: '请填写完整' });
    if (password.length < 4) return res.json({ code: 400, msg: '密码至少4位' });
    const users = readData('users.json');
    if (users.find(u => u.username === username)) return res.json({ code: 400, msg: '用户名已存在' });
    if (role === 'player' || role === 'service') {
        if (!inviteCode) return res.json({ code: 400, msg: '需要邀请码' });
        const invites = readData('invites.json');
        const code = invites.find(c => c.code === inviteCode && c.type === role && !c.used);
        if (!code) return res.json({ code: 400, msg: '邀请码无效' });
        code.used = true; code.usedBy = username; code.usedAt = new Date().toLocaleString();
        writeData('invites.json', invites);
    }
    const newUser = {
        id: genUID(), username, password, balance: 0, avatar: '', role, penalty: 0,
        totalOrders: 0, todayOrders: 0,
        playerInfo: role === 'player' ? { game: '', price: 0, desc: '', joined: false } : null,
        vip: null, createdAt: new Date().toLocaleString()
    };
    users.push(newUser);
    writeData('users.json', users);
    res.json({ code: 200, msg: '注册成功', userId: newUser.id });
});

// 登录
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ code: 400, msg: '请输入' });
    const users = readData('users.json');
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.json({ code: 400, msg: '账号或密码错误' });
    res.json({ code: 200, msg: '登录成功', user });
});

// 管理员登录
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const admins = readData('admins.json');
    const admin = admins.find(a => a.username === username && a.password === password);
    if (!admin) return res.json({ code: 400, msg: '管理员错误' });
    res.json({ code: 200, msg: '成功', admin });
});

// 获取用户
app.get('/api/user/:id', (req, res) => {
    const users = readData('users.json');
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) return res.json({ code: 400, msg: '用户不存在' });
    res.json({ code: 200, user });
});

// 更新用户
app.put('/api/user/:id', (req, res) => {
    const users = readData('users.json');
    const idx = users.findIndex(u => u.id === parseInt(req.params.id));
    if (idx === -1) return res.json({ code: 400, msg: '用户不存在' });
    const { username, avatar } = req.body;
    if (username && users.find(u => u.username === username && u.id !== parseInt(req.params.id))) {
        return res.json({ code: 400, msg: '用户名已被使用' });
    }
    if (username) users[idx].username = username;
    if (avatar) users[idx].avatar = avatar;
    writeData('users.json', users);
    res.json({ code: 200, msg: '修改成功', user: users[idx] });
});

// 上传头像
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.json({ code: 400, msg: '请选择文件' });
    res.json({ code: 200, url: '/uploads/' + req.file.filename });
});

// 充值
app.post('/api/recharge', (req, res) => {
    const { userId, amount, payMethod } = req.body;
    const users = readData('users.json');
    const user = users.find(u => u.id === userId);
    if (!user) return res.json({ code: 400, msg: '用户不存在' });
    user.balance += parseFloat(amount);
    writeData('users.json', users);
    const finances = readData('finances.json');
    finances.push({ type: '充值', userId, username: user.username, amount: parseFloat(amount), payMethod: payMethod || '未知', time: new Date().toLocaleString() });
    writeData('finances.json', finances);
    res.json({ code: 200, msg: '充值成功', balance: user.balance });
});

// 分类
app.get('/api/categories', (req, res) => res.json({ code: 200, data: readData('categories.json') }));
app.post('/api/categories', (req, res) => {
    const { name, icon } = req.body;
    if (!name) return res.json({ code: 400, msg: '请输入名称' });
    const cats = readData('categories.json');
    const newCat = { id: cats.length ? Math.max(...cats.map(c => c.id)) + 1 : 1, name, icon: icon || '' };
    cats.push(newCat);
    writeData('categories.json', cats);
    res.json({ code: 200, msg: '添加成功' });
});
app.delete('/api/categories/:id', (req, res) => {
    let cats = readData('categories.json');
    cats = cats.filter(c => c.id !== parseInt(req.params.id));
    writeData('categories.json', cats);
    res.json({ code: 200, msg: '删除成功' });
});

// 商品
app.get('/api/goods', (req, res) => res.json({ code: 200, data: readData('goods.json') }));
app.post('/api/goods', (req, res) => {
    const { name, price, categoryId, image, stock } = req.body;
    if (!name || !price) return res.json({ code: 400, msg: '请填写完整' });
    const goods = readData('goods.json');
    const newGoods = { id: goods.length ? Math.max(...goods.map(g => g.id)) + 1 : 1, name, price: parseFloat(price), categoryId: parseInt(categoryId) || 0, image: image || '', stock: parseInt(stock) || 999 };
    goods.push(newGoods);
    writeData('goods.json', goods);
    res.json({ code: 200, msg: '添加成功' });
});
app.delete('/api/goods/:id', (req, res) => {
    let goods = readData('goods.json');
    goods = goods.filter(g => g.id !== parseInt(req.params.id));
    writeData('goods.json', goods);
    res.json({ code: 200, msg: '删除成功' });
});

// 订单
app.get('/api/orders/:userId', (req, res) => {
    const orders = readData('orders.json');
    res.json({ code: 200, data: orders.filter(o => o.userId === parseInt(req.params.userId)).reverse() });
});
app.post('/api/orders', (req, res) => {
    const { userId, goodsId, goodsName, price, server, gameId, playerId, subPlayers, orderType, remark, payMethod } = req.body;
    if (!userId || !goodsId || !price) return res.json({ code: 400, msg: '参数错误' });
    const users = readData('users.json');
    const user = users.find(u => u.id === userId);
    if (!user || user.balance < price) return res.json({ code: 400, msg: '余额不足' });
    user.balance -= price;
    user.totalOrders = (user.totalOrders || 0) + 1;
    user.todayOrders = (user.todayOrders || 0) + 1;
    writeData('users.json', users);

    // 构建服务成员
    const members = [{ userId: playerId, username: users.find(u => u.id === playerId)?.username || '', role: 'main' }];
    if (subPlayers && subPlayers.length) {
        subPlayers.forEach(sp => {
            members.push({ userId: sp, username: users.find(u => u.id === sp)?.username || '', role: 'sub' });
        });
    }

    const orders = readData('orders.json');
    const newOrder = {
        id: orders.length ? Math.max(...orders.map(o => o.id)) + 1 : 1,
        userId, goodsId, goodsName, price, server, gameId, playerId, subPlayers: subPlayers || [],
        orderType: orderType || 'double', remark, payMethod: payMethod || '未知',
        members, status: 'waiting',
        createTime: new Date().toLocaleString(), acceptTime: null, completeTime: null
    };
    orders.push(newOrder);
    writeData('orders.json', orders);
    res.json({ code: 200, msg: '下单成功' });
});

// 打手相关
app.get('/api/players', (req, res) => {
    const users = readData('users.json');
    res.json({ code: 200, data: users.filter(u => u.role === 'player' && u.playerInfo?.joined) });
});
app.get('/api/available-orders', (req, res) => {
    res.json({ code: 200, data: readData('orders.json').filter(o => o.status === 'waiting') });
});
app.put('/api/orders/:id/accept', (req, res) => {
    const orders = readData('orders.json');
    const order = orders.find(o => o.id === parseInt(req.params.id));
    if (!order || order.status !== 'waiting') return res.json({ code: 400, msg: '已被抢' });
    order.status = 'accepted';
    order.playerId = req.body.playerId;
    order.acceptTime = new Date().toLocaleString();
    writeData('orders.json', orders);
    res.json({ code: 200, msg: '抢单成功' });
});
app.put('/api/orders/:id/complete', (req, res) => {
    const orders = readData('orders.json');
    const order = orders.find(o => o.id === parseInt(req.params.id));
    if (!order || order.status !== 'accepted') return res.json({ code: 400, msg: '状态异常' });
    order.status = 'completed';
    order.completeTime = new Date().toLocaleString();
    writeData('orders.json', orders);
    const users = readData('users.json');
    const player = users.find(u => u.id === order.playerId);
    if (player) {
        player.balance += order.price;
        player.todayOrders = (player.todayOrders || 0) + 1;
        player.totalOrders = (player.totalOrders || 0) + 1;
        writeData('users.json', users);
    }
    res.json({ code: 200, msg: '完成' });
});

// 入驻
app.post('/api/join', (req, res) => {
    const { userId, inviteCode, game, price, desc, payMethod } = req.body;
    const invites = readData('invites.json');
    const code = invites.find(c => c.code === inviteCode && c.type === 'player' && !c.used);
    if (!code) return res.json({ code: 400, msg: '邀请码无效' });
    const users = readData('users.json');
    const user = users.find(u => u.id === userId);
    if (!user || user.balance < 50) return res.json({ code: 400, msg: '余额不足 ¥50' });
    user.balance -= 50;
    user.role = 'player';
    user.playerInfo = { game, price: parseFloat(price), desc, joined: true };
    writeData('users.json', users);
    code.used = true; code.usedBy = user.username; code.usedAt = new Date().toLocaleString();
    writeData('invites.json', invites);
    const finances = readData('finances.json');
    finances.push({ type: '入驻费', userId, username: user.username, amount: 50, payMethod: payMethod || '未知', time: new Date().toLocaleString() });
    writeData('finances.json', finances);
    res.json({ code: 200, msg: '入驻成功' });
});

// 罚款
app.post('/api/penalty/pay', (req, res) => {
    const { userId, payMethod } = req.body;
    const users = readData('users.json');
    const user = users.find(u => u.id === userId);
    if (!user || !user.penalty || user.balance < user.penalty) return res.json({ code: 400, msg: '无法缴纳' });
    const amount = user.penalty;
    user.balance -= amount;
    user.penalty = 0;
    writeData('users.json', users);
    const finances = readData('finances.json');
    finances.push({ type: '罚款缴纳', userId, username: user.username, amount, payMethod: payMethod || '未知', time: new Date().toLocaleString() });
    writeData('finances.json', finances);
    res.json({ code: 200, msg: '已缴纳' });
});

// 邀请码
app.post('/api/invites', (req, res) => {
    const invites = readData('invites.json');
    const code = genInvite(req.body.type);
    invites.push({ code, type: req.body.type, used: false, createdAt: new Date().toLocaleString() });
    writeData('invites.json', invites);
    res.json({ code: 200, code });
});
app.get('/api/invites', (req, res) => res.json({ code: 200, data: readData('invites.json') }));

// 消息
app.get('/api/messages/:type', (req, res) => {
    const msgs = readData('messages.json');
    res.json({ code: 200, data: msgs.filter(m => m.type === req.params.type).reverse() });
});
app.post('/api/messages', (req, res) => {
    const msgs = readData('messages.json');
    msgs.push({
        id: msgs.length ? Math.max(...msgs.map(m => m.id)) + 1 : 1,
        from: '官方公告', content: req.body.content, type: 'official', read: false,
        time: new Date().toLocaleString()
    });
    writeData('messages.json', msgs);
    res.json({ code: 200, msg: '已发送' });
});
app.put('/api/messages/:id/read', (req, res) => {
    const msgs = readData('messages.json');
    const m = msgs.find(x => x.id === parseInt(req.params.id));
    if (m) { m.read = true; writeData('messages.json', msgs); }
    res.json({ code: 200 });
});

// 聊天
app.get('/api/chats/:userId', (req, res) => {
    const chats = readData('chats.json');
    res.json({ code: 200, data: chats.filter(c => c.fromId === parseInt(req.params.userId) || c.toId === parseInt(req.params.userId) || c.toId === null) });
});
app.post('/api/chats', (req, res) => {
    const chats = readData('chats.json');
    chats.push({
        id: chats.length + 1,
        fromId: req.body.fromId,
        fromName: req.body.fromName,
        fromRole: req.body.fromRole,
        toId: req.body.toId || null,
        content: req.body.content,
        time: new Date().toLocaleString()
    });
    writeData('chats.json', chats);
    res.json({ code: 200, msg: '已发送' });
});

// 排行榜
app.get('/api/ranking', (req, res) => {
    const users = readData('users.json');
    const type = req.query.type || 'boss';
    let filtered = type === 'boss' ? users.filter(u => u.role === 'user') : users.filter(u => u.role === 'player' && u.playerInfo?.joined);
    filtered.sort((a, b) => (b.todayOrders || 0) - (a.todayOrders || 0));
    res.json({ code: 200, data: filtered.map(u => ({ id: u.id, username: u.username, avatar: u.avatar, todayOrders: u.todayOrders || 0, totalOrders: u.totalOrders || 0, balance: u.balance })) });
});

// 抽奖
app.get('/api/lottery', (req, res) => res.json({ code: 200, data: readData('lottery.json') }));
app.put('/api/lottery/price', (req, res) => {
    const l = readData('lottery.json');
    l.price = parseFloat(req.body.price) || 10;
    writeData('lottery.json', l);
    res.json({ code: 200 });
});
app.post('/api/lottery/items', (req, res) => {
    const l = readData('lottery.json');
    l.items.push({ name: req.body.name, color: req.body.color || '#ff8c00', prob: parseInt(req.body.prob) || 10 });
    writeData('lottery.json', l);
    res.json({ code: 200 });
});
app.delete('/api/lottery/items/:index', (req, res) => {
    const l = readData('lottery.json');
    l.items.splice(parseInt(req.params.index), 1);
    writeData('lottery.json', l);
    res.json({ code: 200 });
});
app.post('/api/lottery/spin', (req, res) => {
    const users = readData('users.json');
    const user = users.find(u => u.id === req.body.userId);
    if (!user) return res.json({ code: 400, msg: '用户不存在' });
    const lottery = readData('lottery.json');
    if (!lottery.items.length) return res.json({ code: 400, msg: '没有奖品' });
    if (user.balance < lottery.price) return res.json({ code: 400, msg: '余额不足' });
    user.balance -= lottery.price;
    writeData('users.json', users);
    const items = lottery.items, total = items.reduce((s, i) => s + i.prob, 0);
    let rand = Math.random() * total, cum = 0, wi = 0;
    for (let i = 0; i < items.length; i++) { cum += items[i].prob; if (rand <= cum) { wi = i; break; } }
    const prize = items[wi];
    if (prize.name.includes('红包')) { user.balance += parseInt(prize.name) || 0; writeData('users.json', users); }
    res.json({ code: 200, prize, balance: user.balance });
});

// 会员
app.post('/api/vip/buy', (req, res) => {
    const { userId, type, payMethod } = req.body;
    const prices = { month: 30, season: 80, year: 280 }, days = { month: 30, season: 90, year: 365 };
    const users = readData('users.json');
    const user = users.find(u => u.id === userId);
    if (!user || user.balance < prices[type]) return res.json({ code: 400, msg: '余额不足' });
    user.balance -= prices[type];
    const expire = new Date(); expire.setDate(expire.getDate() + days[type]);
    user.vip = { type, expire: expire.toISOString(), buyTime: new Date().toLocaleString() };
    writeData('users.json', users);
    const finances = readData('finances.json');
    finances.push({ type: 'VIP购买', userId, username: user.username, amount: prices[type], payMethod: payMethod || '未知', time: new Date().toLocaleString() });
    writeData('finances.json', finances);
    res.json({ code: 200, msg: '购买成功' });
});

// 投诉建议
app.post('/api/complaints', (req, res) => {
    const complaints = readData('complaints.json');
    complaints.push({
        id: complaints.length + 1,
        userId: req.body.userId,
        username: req.body.username,
        type: req.body.type,
        content: req.body.content,
        time: new Date().toLocaleString(),
        status: 'pending'
    });
    writeData('complaints.json', complaints);
    res.json({ code: 200, msg: '提交成功' });
});

// 财务
app.get('/api/finances', (req, res) => res.json({ code: 200, data: readData('finances.json').reverse() }));

// 管理员
app.get('/api/admin/users', (req, res) => res.json({ code: 200, data: readData('users.json') }));
app.post('/api/admin/penalty', (req, res) => {
    const users = readData('users.json');
    const user = users.find(u => u.id === req.body.userId);
    if (!user) return res.json({ code: 400, msg: '用户不存在' });
    user.penalty = (user.penalty || 0) + parseFloat(req.body.amount);
    writeData('users.json', users);
    const finances = readData('finances.json');
    finances.push({ type: '罚款', userId: req.body.userId, username: user.username, amount: parseFloat(req.body.amount), time: new Date().toLocaleString() });
    writeData('finances.json', finances);
    res.json({ code: 200, msg: '已罚款' });
});
app.get('/api/admin/orders', (req, res) => res.json({ code: 200, data: readData('orders.json').reverse() }));

// ==================== 启动 ====================
const PORT = process.env.PORT || 3000;
initData();
checkDaily();
server.listen(PORT, () => {
    console.log('========================================');
    console.log('  小怪兽陪玩俱乐部 - 后端已启动');
    console.log('  地址: http://localhost:' + PORT);
    console.log('  管理员: admin / admin123');
    console.log('  所有设备同步数据 - Socket.io 已启用');
    console.log('========================================');
});
