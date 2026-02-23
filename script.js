const SESSION_ID = sessionStorage.getItem('foca_session_id') || crypto.randomUUID();
sessionStorage.setItem('foca_session_id', SESSION_ID);

const STORAGE_KEYS = { token: 'foca_token', user: 'foca_user' };

const state = {
  token: localStorage.getItem(STORAGE_KEYS.token),
  user: load(STORAGE_KEYS.user, null),
  posts: [],
  users: [],
  imageBase64: null,
  ownerMode: false
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

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error('Falha de conexão. Inicie com: node server.js');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
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
  state.imageBase64 = file ? await fileToBase64(file) : null;
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
    sessionInfo.textContent = `Conectado como: ${state.user.nick} (${role})`;
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
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, typingUntil })
    });
  } catch {}
}

async function refreshPresence() {
  try {
    const result = await fetch('/api/presence');
    const body = await result.json();
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
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

renderAll();
refreshAllData();
refreshPresence();
markPresence();
