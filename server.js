const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dungeon-chat-secret-2024';

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'chat.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#00a884',
    theme_accent TEXT DEFAULT '#00a884',
    theme_mode TEXT DEFAULT 'dark',
    bio TEXT DEFAULT '',
    last_seen INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    avatar_color TEXT DEFAULT '#00a884',
    description TEXT DEFAULT '',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    last_read_message_id TEXT DEFAULT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    status TEXT DEFAULT 'sent',
    reply_to TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL,
    edited_at INTEGER DEFAULT NULL,
    deleted INTEGER DEFAULT 0
  );
`);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── HELPER ───────────────────────────────────────────────────────────────────
function now() { return Date.now(); }

function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Usuário deve ter 3-20 caracteres alfanuméricos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Usuário já existe' });

  const password_hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  const colors = ['#00a884','#25d366','#128c7e','#ef5350','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#ff9800'];
  const avatar_color = colors[Math.floor(Math.random() * colors.length)];

  db.prepare(`INSERT INTO users (id, username, password_hash, display_name, avatar_color, theme_accent, theme_mode, bio, last_seen, created_at)
    VALUES (?, ?, ?, ?, ?, '#00a884', 'dark', '', ?, ?)`)
    .run(id, username, password_hash, display_name.trim(), now(), now());

  const user = safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Campos obrigatórios' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }

  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(safeUser(user));
});

app.put('/api/me', authMiddleware, (req, res) => {
  const { display_name, bio, avatar_color, theme_accent, theme_mode } = req.body;
  db.prepare(`UPDATE users SET
    display_name = COALESCE(?, display_name),
    bio = COALESCE(?, bio),
    avatar_color = COALESCE(?, avatar_color),
    theme_accent = COALESCE(?, theme_accent),
    theme_mode = COALESCE(?, theme_mode)
    WHERE id = ?`)
    .run(display_name || null, bio !== undefined ? bio : null, avatar_color || null, theme_accent || null, theme_mode || null, req.user.id);

  const user = safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
  res.json(user);
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const users = db.prepare(`SELECT id, username, display_name, avatar_color, last_seen FROM users
    WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20`)
    .all(like, like, req.user.id);
  res.json(users);
});

// ─── CONVERSATION ROUTES ──────────────────────────────────────────────────────
app.get('/api/conversations', authMiddleware, (req, res) => {
  const userId = req.user.id;

  const convs = db.prepare(`
    SELECT c.*, cm.role, cm.last_read_message_id,
      (SELECT COUNT(*) FROM messages m2
       WHERE m2.conversation_id = c.id AND m2.deleted = 0
         AND m2.id > COALESCE(cm.last_read_message_id, '')
         AND m2.sender_id != ?) as unread_count,
      (SELECT m.id FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0 ORDER BY m.created_at DESC LIMIT 1) as last_msg_id
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY (SELECT COALESCE(MAX(m.created_at),0) FROM messages m WHERE m.conversation_id = c.id) DESC
  `).all(userId, userId);

  const result = convs.map(conv => {
    let last_message = null;
    if (conv.last_msg_id) {
      const msg = db.prepare('SELECT m.*, u.display_name as sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(conv.last_msg_id);
      if (msg) last_message = msg;
    }

    let other_user = null;
    if (conv.type === 'direct') {
      const mem = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar_color, u.last_seen FROM users u
        JOIN conversation_members cm ON cm.user_id = u.id
        WHERE cm.conversation_id = ? AND u.id != ?`).get(conv.id, userId);
      other_user = mem || null;
    }

    let members = [];
    if (conv.type === 'group') {
      members = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar_color, cm.role FROM users u
        JOIN conversation_members cm ON cm.user_id = u.id WHERE cm.conversation_id = ?`).all(conv.id);
    }

    const { last_msg_id, ...convData } = conv;
    return { ...convData, last_message, other_user, members };
  });

  res.json(result);
});

app.post('/api/conversations/direct', authMiddleware, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });

  const targetUser = db.prepare('SELECT id, display_name, avatar_color FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado' });

  // Check existing direct conversation
  const existing = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct'
    LIMIT 1
  `).get(req.user.id, user_id);

  if (existing) return res.json(existing);

  const id = uuidv4();
  const ts = now();
  db.prepare('INSERT INTO conversations (id, type, name, created_by, created_at) VALUES (?, ?, NULL, ?, ?)').run(id, 'direct', req.user.id, ts);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, 'member', ts);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, user_id, 'member', ts);

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.json({ ...conv, other_user: targetUser, members: [], last_message: null, unread_count: 0 });
});

app.post('/api/conversations/group', authMiddleware, (req, res) => {
  const { name, member_ids, description, avatar_color } = req.body;
  if (!name || !member_ids || !Array.isArray(member_ids)) {
    return res.status(400).json({ error: 'name e member_ids obrigatórios' });
  }

  const id = uuidv4();
  const ts = now();
  const color = avatar_color || '#00a884';

  db.prepare('INSERT INTO conversations (id, type, name, avatar_color, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'group', name.trim(), color, description || '', req.user.id, ts);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, 'admin', ts);

  for (const uid of member_ids) {
    if (uid !== req.user.id) {
      const u = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
      if (u) db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, uid, 'member', ts);
    }
  }

  // System message
  const msgId = uuidv4();
  const creator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(msgId, id, req.user.id, `${creator?.display_name || 'Alguém'} criou o grupo "${name.trim()}"`, 'system', ts);

  const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar_color, cm.role FROM users u
    JOIN conversation_members cm ON cm.user_id = u.id WHERE cm.conversation_id = ?`).all(id);

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.json({ ...conv, members, last_message: null, unread_count: 0 });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { before, limit = 50 } = req.query;
  const userId = req.user.id;

  const member = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, userId);
  if (!member) return res.status(403).json({ error: 'Sem acesso' });

  let query = `SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_avatar_color
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.deleted = 0`;
  const params = [id];

  if (before) {
    const refMsg = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(before);
    if (refMsg) { query += ' AND m.created_at < ?'; params.push(refMsg.created_at); }
  }

  query += ` ORDER BY m.created_at DESC LIMIT ?`;
  params.push(parseInt(limit));

  const messages = db.prepare(query).all(...params).reverse();

  // Get reply_to messages
  const withReplies = messages.map(msg => {
    let reply_message = null;
    if (msg.reply_to) {
      reply_message = db.prepare(`SELECT m.*, u.display_name as sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`).get(msg.reply_to) || null;
    }
    return { ...msg, reply_message };
  });

  // Update last_read
  if (messages.length > 0) {
    const lastId = messages[messages.length - 1].id;
    db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?')
      .run(lastId, id, userId);
  }

  res.json(withReplies);
});

app.put('/api/conversations/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, userId);
  if (!member || member.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv || conv.type !== 'group') return res.status(400).json({ error: 'Apenas grupos' });

  const { name, description, avatar_color } = req.body;
  db.prepare('UPDATE conversations SET name = COALESCE(?, name), description = COALESCE(?, description), avatar_color = COALESCE(?, avatar_color) WHERE id = ?')
    .run(name || null, description !== undefined ? description : null, avatar_color || null, id);

  const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  io.to(id).emit('conversation:updated', updated);
  res.json(updated);
});

app.post('/api/conversations/:id/members', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  const userId = req.user.id;

  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, userId);
  if (!member || member.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

  const targetUser = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado' });

  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, user_id, 'member', now());

  const msgId = uuidv4();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(msgId, id, userId, `${targetUser.display_name} entrou no grupo`, 'system', now());

  res.json({ ok: true });
});

app.delete('/api/conversations/:id/members/:userId', authMiddleware, (req, res) => {
  const { id, userId: targetId } = req.params;
  const requesterId = req.user.id;

  const requester = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, requesterId);
  if (!requester) return res.status(403).json({ error: 'Sem acesso' });

  // Can remove self or admin can remove others
  if (targetId !== requesterId && requester.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem remover membros' });
  }

  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(id, targetId);

  const targetUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(targetId);
  if (targetUser) {
    const msgId = uuidv4();
    const content = targetId === requesterId ? `${targetUser.display_name} saiu do grupo` : `${targetUser.display_name} foi removido do grupo`;
    db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(msgId, id, requesterId, content, 'system', now());
  }

  res.json({ ok: true });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const onlineUsers = new Map(); // userId -> Set of socketIds

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;

  // Mark online
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), userId);

  // Join conversation rooms
  const userConvs = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(userId);
  userConvs.forEach(({ conversation_id }) => socket.join(conversation_id));

  // Broadcast online to contacts
  const contactIds = new Set();
  userConvs.forEach(({ conversation_id }) => {
    const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversation_id);
    members.forEach(m => { if (m.user_id !== userId) contactIds.add(m.user_id); });
  });
  contactIds.forEach(cid => {
    if (onlineUsers.has(cid)) {
      onlineUsers.get(cid).forEach(sid => {
        io.to(sid).emit('user:online', { userId });
      });
    }
  });

  // Send current online list to this socket
  socket.on('user:get_online', () => {
    const onlineIds = Array.from(onlineUsers.keys());
    socket.emit('user:online_list', { userIds: onlineIds });
  });

  // Message send
  socket.on('message:send', (data) => {
    const { conversation_id, content, reply_to } = data;
    if (!content || !conversation_id) return;

    const member = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation_id, userId);
    if (!member) return;

    const msgId = uuidv4();
    const ts = now();
    db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, type, status, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(msgId, conversation_id, userId, content.trim(), 'text', 'sent', reply_to || null, ts);

    const sender = db.prepare('SELECT display_name, avatar_color FROM users WHERE id = ?').get(userId);
    let reply_message = null;
    if (reply_to) {
      reply_message = db.prepare('SELECT m.*, u.display_name as sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(reply_to) || null;
    }

    const msg = {
      id: msgId, conversation_id, sender_id: userId,
      content: content.trim(), type: 'text', status: 'sent',
      reply_to: reply_to || null, reply_message,
      created_at: ts, edited_at: null, deleted: 0,
      sender_name: sender?.display_name || '', sender_avatar_color: sender?.avatar_color || '#00a884'
    };

    io.to(conversation_id).emit('message:new', msg);

    // Mark delivered for online members
    const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').all(conversation_id, userId);
    members.forEach(m => {
      if (onlineUsers.has(m.user_id)) {
        db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('delivered', msgId);
        io.to(conversation_id).emit('message:delivered', { message_id: msgId, conversation_id });
      }
    });
  });

  // Message delivered
  socket.on('message:delivered', ({ message_id }) => {
    db.prepare('UPDATE messages SET status = ? WHERE id = ? AND status = ?').run('delivered', message_id, 'sent');
    const msg = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(message_id);
    if (msg) io.to(msg.conversation_id).emit('message:delivered', { message_id, conversation_id: msg.conversation_id });
  });

  // Message read
  socket.on('message:read', ({ conversation_id }) => {
    const lastMsg = db.prepare('SELECT id FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 1').get(conversation_id);
    if (lastMsg) {
      db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?')
        .run(lastMsg.id, conversation_id, userId);
      // Mark messages as read
      db.prepare('UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_id != ? AND status != ?').run('read', conversation_id, userId, 'read');
      io.to(conversation_id).emit('message:read', { conversation_id, reader_id: userId });
    }
  });

  // Typing
  socket.on('typing:start', ({ conversation_id }) => {
    socket.to(conversation_id).emit('typing:start', { conversation_id, user_id: userId, username: socket.user.username });
  });
  socket.on('typing:stop', ({ conversation_id }) => {
    socket.to(conversation_id).emit('typing:stop', { conversation_id, user_id: userId });
  });

  // Join conversation room
  socket.on('conversation:join', ({ conversation_id }) => {
    const member = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation_id, userId);
    if (member) socket.join(conversation_id);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        const ts = now();
        db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(ts, userId);
        // Broadcast offline
        contactIds.forEach(cid => {
          if (onlineUsers.has(cid)) {
            onlineUsers.get(cid).forEach(sid => {
              io.to(sid).emit('user:offline', { userId, last_seen: ts });
            });
          }
        });
      }
    }
  });
});

// ─── 404 / ERROR HANDLERS ─────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
  }
  // Para rotas não-API serve o index.html (SPA fallback)
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Chat App rodando em http://localhost:${PORT}`);
});
