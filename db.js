const Database = require('better-sqlite3');
const db = new Database('ig.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT DEFAULT '',
  image TEXT DEFAULT '',
  views INTEGER DEFAULT 0,
  is_ad INTEGER DEFAULT 0,
  ad_budget REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL,
  following_id INTEGER NOT NULL,
  PRIMARY KEY(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_ad ON posts(is_ad, ad_budget);
`);

module.exports = db;
