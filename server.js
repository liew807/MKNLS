const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = 3000;
const SECRET = 'ig_clone_secret_change_me';

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

/* ---------- 鉴权 ---------- */
function auth(req, res, next) {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(t, SECRET);
    next();
  } catch {
    res.status(401).json({ error: '登录已过期' });
  }
}

/* ---------- 注册 ---------- */
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写完整' });
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.status(400).json({ error: '用户名已存在' });
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (username,password) VALUES (?,?)').run(username, hash);
  res.json({ ok: true, id: info.lastInsertRowid });
});

/* ---------- 登录 ---------- */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(400).json({ error: '账号或密码错误' });
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

/* ---------- 获取当前用户信息 ---------- */
app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,avatar FROM users WHERE id=?').get(req.user.id);
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(req.user.id).c;
  const following = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id=?').get(req.user.id).c;
  res.json({ ...u, followers, following });
});

/* ---------- 发帖 ---------- */
app.post('/api/posts', auth, (req, res) => {
  const { content, image } = req.body;
  if (!content && !image) return res.status(400).json({ error: '内容不能为空' });
  const info = db.prepare(
    'INSERT INTO posts (user_id,content,image) VALUES (?,?,?)'
  ).run(req.user.id, content || '', image || '');
  res.json({ id: info.lastInsertRowid });
});

/* ---------- Feed（广告优先 + 时间倒序） ---------- */
app.get('/api/posts', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes_count,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
      (SELECT COUNT(*) FROM follows WHERE following_id=p.user_id) AS followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id=? AND following_id=p.user_id) AS following
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.is_ad DESC, p.ad_budget DESC, p.created_at DESC
    LIMIT 100
  `).all(req.user.id, req.user.id);
  res.json(rows.map(r => ({ ...r, liked: !!r.liked, following: !!r.following })));
});

/* ---------- 用户主页帖子 ---------- */
app.get('/api/users/:id/posts', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes_count,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
      (SELECT COUNT(*) FROM follows WHERE follower_id=? AND following_id=p.user_id) AS following
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id=?
    ORDER BY p.created_at DESC
  `).all(req.user.id, req.user.id, req.params.id);
  res.json(rows.map(r => ({ ...r, liked: !!r.liked, following: !!r.following })));
});

/* ---------- 浏览量 +1 ---------- */
app.post('/api/posts/:id/view', auth, (req, res) => {
  const r = db.prepare('UPDATE posts SET views = views + 1 WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: '帖子不存在' });
  const v = db.prepare('SELECT views FROM posts WHERE id=?').get(req.params.id).views;
  res.json({ views: v });
});

/* ---------- 点赞 / 取消 ---------- */
app.post('/api/posts/:id/like', auth, (req, res) => {
  const pid = req.params.id;
  const exists = db.prepare('SELECT 1 FROM likes WHERE user_id=? AND post_id=?').get(req.user.id, pid);
  if (exists) {
    db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.user.id, pid);
  } else {
    db.prepare('INSERT INTO likes (user_id,post_id) VALUES (?,?)').run(req.user.id, pid);
  }
  const count = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(pid).c;
  res.json({ liked: !exists, likes_count: count });
});

/* ---------- 关注 / 取关 ---------- */
app.post('/api/follow/:userId', auth, (req, res) => {
  const target = Number(req.params.userId);
  if (target === req.user.id) return res.status(400).json({ error: '不能关注自己' });
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(target);
  if (!u) return res.status(404).json({ error: '用户不存在' });

  const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, target);
  if (exists) {
    db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.user.id, target);
  } else {
    db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run(req.user.id, target);
  }
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(target).c;
  res.json({ following: !exists, followers_count: followers });
});

/* ---------- 投放广告 ---------- */
app.post('/api/posts/:id/promote', auth, (req, res) => {
  const budget = Number(req.body.budget) || 5;
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '帖子不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '无权限' });
  db.prepare('UPDATE posts SET is_ad=1, ad_budget=? WHERE id=?').run(budget, req.params.id);
  res.json({ ok: true, budget });
});

/* ---------- 取消广告 ---------- */
app.post('/api/posts/:id/unpromote', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '帖子不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '无权限' });
  db.prepare('UPDATE posts SET is_ad=0, ad_budget=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- 广告数据统计 ---------- */
app.get('/api/ads/stats', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.content, p.views, p.ad_budget,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes_count
    FROM posts p
    WHERE p.user_id=? AND p.is_ad=1
    ORDER BY p.ad_budget DESC
  `).all(req.user.id);
  const totalBudget = rows.reduce((s, r) => s + (r.ad_budget || 0), 0);
  const totalViews = rows.reduce((s, r) => s + (r.views || 0), 0);
  const totalLikes = rows.reduce((s, r) => s + (r.likes_count || 0), 0);
  res.json({
    ads: rows,
    summary: {
      count: rows.length,
      totalBudget,
      totalViews,
      totalLikes,
      cpm: totalViews ? ((totalBudget / totalViews) * 1000).toFixed(2) : 0,
      cpl: totalLikes ? (totalBudget / totalLikes).toFixed(2) : 0
    }
  });
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
