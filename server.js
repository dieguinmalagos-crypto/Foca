const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_NICK = 'Enzo_labubu';
const ADMIN_PASSWORD = '20121710';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      users: parsed.users || [],
      posts: parsed.posts || [],
      sessions: parsed.sessions || {},
      presence: parsed.presence || {}
    };
  } catch {
    return { users: [], posts: [], sessions: {}, presence: {} };
  }
}

let db = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

function sessionFrom(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

function userFromToken(req) {
  const t = sessionFrom(req);
  if (!t) return null;
  const userId = db.sessions[t];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

function adminAllowed(req) {
  const user = userFromToken(req);
  return Boolean(user?.isAdmin);
}

function cleanupPresence() {
  const now = Date.now();
  Object.entries(db.presence).forEach(([sid, p]) => {
    if (now - p.lastSeen > 30000) delete db.presence[sid];
  });
}

function publicPosts() {
  return db.posts.map((post) => ({
    id: post.id,
    text: post.text,
    image: post.image || null,
    createdAt: post.createdAt,
    authorLabel: 'Anônimo'
  }));
}

function adminPosts() {
  return db.posts.map((post) => {
    const u = db.users.find((x) => x.id === post.authorId);
    return {
      ...post,
      authorNick: u?.nick || 'Removido',
      authorLabel: u?.nick || 'Anônimo'
    };
  });
}

function adminUsers() {
  return db.users.map((u) => ({
    id: u.id,
    nick: u.nick,
    isAdmin: Boolean(u.isAdmin)
  }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/register' && req.method === 'POST') {
    try {
      const { nick, password } = await parseBody(req);
      const normalizedNick = String(nick || '').trim();
      const normalizedPassword = String(password || '');

      if (!normalizedNick || !normalizedPassword) return json(res, 400, { error: 'Nick e senha obrigatórios.' });

      if (db.users.length === 0 && (normalizedNick !== ADMIN_NICK || normalizedPassword !== ADMIN_PASSWORD)) {
        return json(res, 403, { error: 'Cadastro indisponível no momento.' });
      }

      const exists = db.users.some((u) => u.nick.toLowerCase() === normalizedNick.toLowerCase());
      if (exists) return json(res, 409, { error: 'Nick já existe.' });

      const user = {
        id: crypto.randomUUID(),
        nick: normalizedNick,
        password: normalizedPassword,
        isAdmin: db.users.length === 0
      };

      db.users.push(user);
      const t = token();
      db.sessions[t] = user.id;
      saveData();

      return json(res, 201, { token: t, user: { id: user.id, nick: user.nick, isAdmin: user.isAdmin } });
    } catch {
      return json(res, 400, { error: 'JSON inválido.' });
    }
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const { nick, password } = await parseBody(req);
      const user = db.users.find(
        (u) => u.nick.toLowerCase() === String(nick).toLowerCase() && u.password === String(password)
      );
      if (!user) return json(res, 401, { error: 'Credenciais inválidas.' });

      const t = token();
      db.sessions[t] = user.id;
      saveData();
      return json(res, 200, { token: t, user: { id: user.id, nick: user.nick, isAdmin: Boolean(user.isAdmin) } });
    } catch {
      return json(res, 400, { error: 'JSON inválido.' });
    }
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const t = sessionFrom(req);
    if (t) delete db.sessions[t];
    saveData();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/posts' && req.method === 'GET') {
    const user = userFromToken(req);
    if (!user) return json(res, 401, { error: 'Faça login para ver as fofocas.' });
    return json(res, 200, { posts: publicPosts() });
  }

  if (url.pathname === '/api/posts' && req.method === 'POST') {
    const user = userFromToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado.' });

    try {
      const { text, image } = await parseBody(req);
      if (!text || !String(text).trim()) return json(res, 400, { error: 'Texto obrigatório.' });
      const post = {
        id: crypto.randomUUID(),
        text: String(text).trim().slice(0, 500),
        image: image || null,
        authorId: user.id,
        createdAt: new Date().toISOString()
      };
      db.posts.unshift(post);
      saveData();
      return json(res, 201, { post });
    } catch {
      return json(res, 400, { error: 'JSON inválido.' });
    }
  }

  if (url.pathname === '/api/admin/posts' && req.method === 'GET') {
    if (!adminAllowed(req)) return json(res, 401, { error: 'Apenas admin pode acessar.' });
    return json(res, 200, { posts: adminPosts() });
  }

  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    if (!adminAllowed(req)) return json(res, 401, { error: 'Apenas admin pode acessar.' });
    return json(res, 200, { users: adminUsers() });
  }

  if (url.pathname.startsWith('/api/admin/users/') && req.method === 'DELETE') {
    if (!adminAllowed(req)) return json(res, 401, { error: 'Apenas admin pode banir.' });
    const userId = url.pathname.split('/').pop();
    const requester = userFromToken(req);
    if (requester?.id === userId) return json(res, 400, { error: 'Admin não pode banir a própria conta.' });

    db.users = db.users.filter((u) => u.id !== userId);
    db.posts = db.posts.filter((p) => p.authorId !== userId);
    Object.entries(db.sessions).forEach(([k, v]) => {
      if (v === userId) delete db.sessions[k];
    });

    saveData();
    return json(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/admin/posts/') && req.method === 'DELETE') {
    if (!adminAllowed(req)) return json(res, 401, { error: 'Apenas admin pode apagar.' });
    const id = url.pathname.split('/').pop();
    db.posts = db.posts.filter((p) => p.id !== id);
    saveData();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/reset' && req.method === 'POST') {
    if (!adminAllowed(req)) return json(res, 401, { error: 'Apenas admin pode resetar.' });
    db = { users: [], posts: [], sessions: {}, presence: {} };
    saveData();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/presence' && req.method === 'POST') {
    try {
      const { sessionId, typingUntil = 0 } = await parseBody(req);
      if (!sessionId) return json(res, 400, { error: 'sessionId obrigatório.' });
      db.presence[sessionId] = { lastSeen: Date.now(), typingUntil: Number(typingUntil) || 0 };
      cleanupPresence();
      saveData();
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: 'JSON inválido.' });
    }
  }

  if (url.pathname === '/api/presence' && req.method === 'GET') {
    cleanupPresence();
    const now = Date.now();
    const entries = Object.values(db.presence);
    const online = entries.filter((e) => now - e.lastSeen < 15000).length;
    const typing = entries.filter((e) => e.typingUntil > now).length;
    return json(res, 200, { online, typing });
  }

  if (url.pathname === '/api/presence' && req.method === 'DELETE') {
    const sid = url.searchParams.get('sessionId');
    if (sid) delete db.presence[sid];
    saveData();
    return json(res, 200, { ok: true });
  }

  const filePath = url.pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor em http://0.0.0.0:${PORT}`);
});
