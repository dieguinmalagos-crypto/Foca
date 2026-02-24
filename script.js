const SESSION_ID = sessionStorage.getItem('foca_session_id') || crypto.randomUUID();
sessionStorage.setItem('foca_session_id', SESSION_ID);

const STORAGE_KEYS = {
  token: 'foca_token',
  user: 'foca_user',
  fallbackDb: 'foca_fallback_db',
  fallbackPresence: 'foca_fallback_presence'
};

const ADMIN_NICK = 'Enzo_labubu';
const ADMIN_PASSWORD = '20121710';
const PRESENCE_TTL_MS = 15000;

const state = {
  token: localStorage.getItem(STORAGE_KEYS.token),
  user: load(STORAGE_KEYS.user, null),
  posts: [],
  users: [],
  imageBase64: null,
  ownerMode: false,
  apiMode: 'remote'
};

const authSection = document.getElementById('authSection');
const composerSection = document.getElementById('composerSection');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');
const gossipForm = document.getElementById('gossipForm');
const feed = document.getElementById('feed');
const postTemplate = document.getElementById('postTemplate');
const sessionInfo = document.getElementById('sessionInfo');
const searchInput = document.getElementById('searchInput');
const ownerPanel = document.getElementById('ownerPanel');
const ownerPosts = document.getElementById('ownerPosts');
const ownerUsers = document.getElementById('ownerUsers');
const onlineCount = document.getElementById('onlineCount');
const typingCount = document.getElementById('typingCount');

function readFallbackDb() {
  return load(STORAGE_KEYS.fallbackDb, {
    users: [],
    posts: [],
    tokens: {},
    nextUserId: 1,
    nextPostId: 1
  });
}

function writeFallbackDb(db) {
  try {
    localStorage.setItem(STORAGE_KEYS.fallbackDb, JSON.stringify(db));
  } catch (error) {
    if (isQuotaExceeded(error)) {
      fallbackError('Armazenamento lotado no navegador. Tente enviar uma imagem menor ou publique sem foto.');
    }
    throw error;
  }
}

function readPresence() {
  return load(STORAGE_KEYS.fallbackPresence, {});
}

function writePresence(presence) {
  localStorage.setItem(STORAGE_KEYS.fallbackPresence, JSON.stringify(presence));
}

function normalizeNick(nick) {
  return String(nick || '').trim().toLowerCase();
}

function parseBody(options) {
  if (!options.body) return {};
  if (typeof options.body === 'string') {
    try {
      return JSON.parse(options.body);
    } catch {
      return {};
    }
  }
  return options.body;
}

function fallbackAuthUser(db, token) {
  if (!token) return null;
  const userId = db.tokens[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

function publicPost(post, ownerMode = false) {
  return {
    id: post.id,
    text: post.text,
    image: post.image || null,
    createdAt: post.createdAt,
    authorLabel: ownerMode ? post.authorNick : 'Anônimo',
    authorNick: ownerMode ? post.authorNick : undefined
  };
}

function fallbackError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function fallbackApi(path, options = {}, token = state.token) {
  const method = (options.method || 'GET').toUpperCase();
  const body = parseBody(options);
  const db = readFallbackDb();

  if (path === '/api/register' && method === 'POST') {
    const nick = String(body.nick || '').trim();
    const password = String(body.password || '');
    if (!nick || !password) fallbackError('Preencha nick e senha.');

    const firstUser = db.users.length === 0;
    if (firstUser && (nick !== ADMIN_NICK || password !== ADMIN_PASSWORD)) {
      fallbackError('A primeira conta deve ser a do admin.', 403);
    }

    const repeated = db.users.some((u) => normalizeNick(u.nick) === normalizeNick(nick));
    if (repeated) fallbackError('Esse nick já existe. Escolha outro.', 409);

    const user = {
      id: String(db.nextUserId++),
      nick,
      password,
      isAdmin: firstUser
    };
    db.users.push(user);

    const userToken = crypto.randomUUID();
    db.tokens[userToken] = user.id;
    writeFallbackDb(db);

    return { token: userToken, user: { id: user.id, nick: user.nick, isAdmin: user.isAdmin } };
  }

  if (path === '/api/login' && method === 'POST') {
    const nick = String(body.nick || '').trim();
    const password = String(body.password || '');
    const user = db.users.find((u) => normalizeNick(u.nick) === normalizeNick(nick) && u.password === password);
    if (!user) fallbackError('Nick ou senha inválidos.', 401);

    const userToken = crypto.randomUUID();
    db.tokens[userToken] = user.id;
    writeFallbackDb(db);
    return { token: userToken, user: { id: user.id, nick: user.nick, isAdmin: user.isAdmin } };
  }

  if (path === '/api/logout' && method === 'POST') {
    if (token) {
      delete db.tokens[token];
      writeFallbackDb(db);
    }
    return { ok: true };
  }

  if (path === '/api/posts' && method === 'GET') {
    const user = fallbackAuthUser(db, token);
    if (!user) fallbackError('Faça login para ver as fofocas.', 401);

    const posts = db.posts
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((post) => publicPost(post, false));

    return { posts };
  }

  if (path === '/api/posts' && method === 'POST') {
    const user = fallbackAuthUser(db, token);
    if (!user) fallbackError('Faça login para publicar.', 401);

    const text = String(body.text || '').trim();
    if (!text) fallbackError('Digite uma fofoca antes de publicar.');

    const post = {
      id: String(db.nextPostId++),
      text,
      image: body.image || null,
      createdAt: new Date().toISOString(),
      authorId: user.id,
      authorNick: user.nick
    };

    db.posts.push(post);
    writeFallbackDb(db);
    return { ok: true, post: publicPost(post, false) };
  }

  if (path === '/api/admin/posts' && method === 'GET') {
    const user = fallbackAuthUser(db, token);
    if (!user?.isAdmin) fallbackError('Não autorizado.', 401);

    const posts = db.posts
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((post) => publicPost(post, true));

    return { posts };
  }

  if (path.startsWith('/api/admin/posts/') && method === 'DELETE') {
    const user = fallbackAuthUser(db, token);
    if (!user?.isAdmin) fallbackError('Não autorizado.', 401);

    const postId = path.split('/').pop();
    db.posts = db.posts.filter((p) => p.id !== postId);
    writeFallbackDb(db);
    return { ok: true };
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const user = fallbackAuthUser(db, token);
    if (!user?.isAdmin) fallbackError('Não autorizado.', 401);

    return {
      users: db.users.map((u) => ({ id: u.id, nick: u.nick, isAdmin: u.isAdmin }))
    };
  }

  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    const user = fallbackAuthUser(db, token);
    if (!user?.isAdmin) fallbackError('Não autorizado.', 401);

    const userId = path.split('/').pop();
    const target = db.users.find((u) => u.id === userId);
    if (!target || target.isAdmin) fallbackError('Conta inválida para banimento.', 400);

    db.users = db.users.filter((u) => u.id !== userId);
    db.posts = db.posts.filter((p) => p.authorId !== userId);

    Object.keys(db.tokens).forEach((existingToken) => {
      if (db.tokens[existingToken] === userId) {
        delete db.tokens[existingToken];
      }
    });

    writeFallbackDb(db);
    return { ok: true };
  }

  if (path === '/api/admin/reset' && method === 'POST') {
    const user = fallbackAuthUser(db, token);
    if (!user?.isAdmin) fallbackError('Não autorizado.', 401);

    writeFallbackDb({ users: [], posts: [], tokens: {}, nextUserId: 1, nextPostId: 1 });
    writePresence({});
    return { ok: true };
  }

  if (path === '/api/presence' && method === 'GET') {
    const now = Date.now();
    const presence = readPresence();
    const clean = {};

    Object.entries(presence).forEach(([id, value]) => {
      if (value.seenAt && now - value.seenAt < PRESENCE_TTL_MS) clean[id] = value;
    });

    writePresence(clean);
    const online = Object.keys(clean).length;
    const typing = Object.values(clean).filter((entry) => (entry.typingUntil || 0) > now).length;
    return { online, typing };
  }

  if (path === '/api/presence' && method === 'POST') {
    const payload = body || {};
    const sessionId = payload.sessionId || SESSION_ID;
    const presence = readPresence();

    presence[sessionId] = {
      seenAt: Date.now(),
      typingUntil: payload.typingUntil || 0
    };

    writePresence(presence);
    return { ok: true };
  }

  fallbackError('Recurso não encontrado.', 404);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  if (state.apiMode === 'fallback') {
    return fallbackApi(path, { ...options, headers }, state.token);
  }

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    state.apiMode = 'fallback';
    setAuthMessage('Servidor API não encontrado. Ativando modo local neste navegador.');
    return fallbackApi(path, { ...options, headers }, state.token);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const shouldFallback = response.status === 404 && path.startsWith('/api/');
    if (shouldFallback) {
      state.apiMode = 'fallback';
      setAuthMessage('Servidor API não encontrado. Ativando modo local neste navegador.');
      return fallbackApi(path, { ...options, headers }, state.token);
    }

    if (response.status === 401 && state.token && !['/api/login', '/api/register'].includes(path)) {
      clearSession();
      renderAll();
    }
    throw new Error(body.error || 'Erro de requisição');
  }
  return body;
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.ownerMode = false;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
}

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.style.color = isError ? '#ffb3ce' : '#c3caef';
}

document.getElementById('showLogin').addEventListener('click', () => {
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  setAuthMessage('');
});

document.getElementById('showRegister').addEventListener('click', () => {
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  setAuthMessage('');
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nick = document.getElementById('registerNick').value.trim();
  const password = document.getElementById('registerPassword').value;
  try {
    const result = await api('/api/register', { method: 'POST', body: JSON.stringify({ nick, password }) });
    state.token = result.token;
    state.user = result.user;
    persistSession();
    registerForm.reset();
    setAuthMessage('Conta criada com sucesso!');
    renderAll();
    await refreshAllData();
  } catch (err) {
    setAuthMessage(err.message, true);
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nick = document.getElementById('loginNick').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ nick, password }) });
    state.token = result.token;
    state.user = result.user;
    persistSession();
    loginForm.reset();
    setAuthMessage('');
    renderAll();
    await refreshAllData();
  } catch (err) {
    setAuthMessage(err.message, true);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {}
  clearSession();
  state.posts = [];
  state.users = [];
  renderAll();
});

searchInput.addEventListener('input', () => renderFeed());

document.getElementById('gossipImage').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    state.imageBase64 = null;
    return;
  }

  try {
    state.imageBase64 = await fileToBase64(file);
  } catch (err) {
    state.imageBase64 = null;
    event.target.value = '';
    alert(err.message || 'Não foi possível carregar a imagem.');
  }
});

gossipForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) return;

  const textEl = document.getElementById('gossipText');
  const text = textEl.value.trim();
  if (!text) return;

  try {
    await api('/api/posts', { method: 'POST', body: JSON.stringify({ text, image: state.imageBase64 }) });
    textEl.value = '';
    document.getElementById('gossipImage').value = '';
    state.imageBase64 = null;
    await markPresence(0);
    await refreshAllData();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('ownerAccess').addEventListener('click', async () => {
  if (!state.user?.isAdmin) {
    alert('Somente o admin pode abrir esse painel.');
    return;
  }
  state.ownerMode = !state.ownerMode;
  ownerPanel.classList.toggle('hidden', !state.ownerMode);
  await refreshAllData();
});

document.getElementById('closeOwner').addEventListener('click', () => {
  state.ownerMode = false;
  ownerPanel.classList.add('hidden');
  renderOwnerPanel();
});

ownerPosts.addEventListener('click', async (event) => {
  const del = event.target.closest('[data-delete-id]');
  const reset = event.target.closest('#resetSiteBtn');

  if (del) {
    try {
      await api(`/api/admin/posts/${del.dataset.deleteId}`, { method: 'DELETE' });
      await refreshAllData();
    } catch (err) {
      alert(err.message);
    }
  }

  if (reset) {
    if (!confirm('Tem certeza? Isso apaga tudo do site.')) return;
    try {
      await api('/api/admin/reset', { method: 'POST' });
      clearSession();
      state.posts = [];
      state.users = [];
      ownerPanel.classList.add('hidden');
      renderAll();
      alert('Site resetado com sucesso.');
    } catch (err) {
      alert(err.message);
    }
  }
});

ownerUsers.addEventListener('click', async (event) => {
  const banBtn = event.target.closest('[data-ban-id]');
  if (!banBtn) return;
  if (!confirm('Banir essa conta e apagar suas fofocas?')) return;

  try {
    await api(`/api/admin/users/${banBtn.dataset.banId}`, { method: 'DELETE' });
    await refreshAllData();
  } catch (err) {
    alert(err.message);
  }
});

const textArea = document.getElementById('gossipText');
textArea.addEventListener('input', () => {
  if (state.token) markPresence(Date.now() + 3000);
});

window.addEventListener('beforeunload', () => {
  navigator.sendBeacon(`/api/presence?sessionId=${encodeURIComponent(SESSION_ID)}`, '');
});

setInterval(() => refreshAllData(), 4000);
setInterval(refreshPresence, 2000);
setInterval(() => markPresence(), 5000);

async function refreshAllData() {
  if (!state.token) {
    state.posts = [];
    state.users = [];
    renderFeed();
    renderOwnerPanel();
    return;
  }

  try {
    const posts = state.ownerMode ? await api('/api/admin/posts') : await api('/api/posts');
    state.posts = posts.posts;

    if (state.ownerMode) {
      const users = await api('/api/admin/users');
      state.users = users.users;
    } else {
      state.users = [];
    }

    renderFeed();
    renderOwnerPanel();
  } catch (err) {
    if (err.message.includes('login') || err.message.includes('Não autorizado')) {
      clearSession();
      renderAll();
    }
  }
}

function renderAll() {
  const loggedIn = Boolean(state.user && state.token);
  authSection.classList.toggle('hidden', loggedIn);
  composerSection.classList.toggle('hidden', !loggedIn);

  if (loggedIn) {
    const role = state.user.isAdmin ? 'ADMIN' : 'aluno';
    const mode = state.apiMode === 'fallback' ? ' • modo local' : '';
    sessionInfo.textContent = `Conectado como: ${state.user.nick} (${role})${mode}`;
  }

  renderFeed();
  renderOwnerPanel();
}

function renderFeed() {
  if (!state.token) {
    feed.innerHTML = '<div class="card">Faça login para ver as fofocas.</div>';
    return;
  }

  const query = searchInput.value.trim().toLowerCase();
  const filtered = state.posts.filter((post) => {
    if (!query) return true;
    return post.text.toLowerCase().includes(query);
  });

  feed.innerHTML = '';
  if (!filtered.length) {
    feed.innerHTML = '<div class="card">Nenhuma fofoca encontrada com essa palavra-chave.</div>';
    return;
  }

  filtered.forEach((post) => {
    const node = postTemplate.content.cloneNode(true);
    node.querySelector('h3').textContent = state.ownerMode ? (post.authorLabel || 'Anônimo') : 'Anônimo';
    node.querySelector('time').textContent = formatDate(post.createdAt);
    node.querySelector('.post-text').textContent = post.text;

    const img = node.querySelector('.post-image');
    if (post.image) {
      img.src = post.image;
      img.classList.remove('hidden');
    }

    feed.appendChild(node);
  });
}

function renderOwnerPanel() {
  if (!state.ownerMode) return;

  ownerPosts.innerHTML = '';
  ownerUsers.innerHTML = '';

  ownerPosts.insertAdjacentHTML('beforeend', '<button id="resetSiteBtn" class="btn danger small">Resetar site</button>');

  if (!state.posts.length) {
    ownerPosts.insertAdjacentHTML('beforeend', '<p>Nenhuma fofoca publicada ainda.</p>');
  } else {
    state.posts.forEach((post, index) => {
      ownerPosts.insertAdjacentHTML('beforeend', `
        <div class="owner-item">
          <div class="owner-head">
            <strong>#${state.posts.length - index}</strong>
            <button class="btn danger small" data-delete-id="${post.id}">Apagar</button>
          </div>
          <div>${formatDate(post.createdAt)}</div>
          <div><strong>Nick:</strong> ${escapeHtml(post.authorNick || '-')}</div>
          <div><strong>Texto:</strong> ${escapeHtml(post.text)}</div>
        </div>
      `);
    });
  }

  const usersWithoutAdmin = state.users.filter((u) => !u.isAdmin);
  if (!usersWithoutAdmin.length) {
    ownerUsers.innerHTML = '<p>Nenhuma conta para banir.</p>';
  } else {
    usersWithoutAdmin.forEach((u) => {
      ownerUsers.insertAdjacentHTML('beforeend', `
        <div class="owner-item">
          <div class="owner-head">
            <strong>${escapeHtml(u.nick)}</strong>
            <button class="btn danger small" data-ban-id="${u.id}">Banir</button>
          </div>
        </div>
      `);
    });
  }
}

async function markPresence(typingUntil = 0) {
  try {
    await api('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION_ID, typingUntil })
    });
  } catch {}
}

function isQuotaExceeded(error) {
  return (
    error?.name === 'QuotaExceededError' ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

async function refreshPresence() {
  try {
    const body = await api('/api/presence');
    onlineCount.textContent = `${body.online || 0} anônimos online`;
    typingCount.textContent = `${body.typing || 0} digitando agora`;
  } catch {}
}

function persistSession() {
  localStorage.setItem(STORAGE_KEYS.token, state.token);
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user));
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selecione um arquivo de imagem válido.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 1280;
        let { width, height } = img;

        const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Falha ao processar a imagem.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.82;
        let encoded = canvas.toDataURL('image/jpeg', quality);
        const maxLength = 1_200_000;

        while (encoded.length > maxLength && quality > 0.4) {
          quality -= 0.08;
          encoded = canvas.toDataURL('image/jpeg', quality);
        }

        if (encoded.length > maxLength) {
          reject(new Error('Imagem muito grande. Use uma imagem menor.'));
          return;
        }

        resolve(encoded);
      };

      img.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.readAsDataURL(file);
  });
}

renderAll();
refreshAllData();
refreshPresence();
markPresence();
