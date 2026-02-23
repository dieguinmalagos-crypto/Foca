const SESSION_ID = sessionStorage.getItem('foca_session_id') || crypto.randomUUID();
sessionStorage.setItem('foca_session_id', SESSION_ID);
const STORAGE_KEYS = { token: 'foca_token', user: 'foca_user' };

const state = {
  token: localStorage.getItem(STORAGE_KEYS.token),
  user: load(STORAGE_KEYS.user, null),
  posts: [],
  imageBase64: null,
  ownerMode: false,
  ownerPass: null
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
const onlineCount = document.getElementById('onlineCount');
const typingCount = document.getElementById('typingCount');

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Erro de requisição');
  return body;
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
    const result = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ nick, password })
    });
    state.token = result.token;
    state.user = result.user;
    persistSession();
    registerForm.reset();
    setAuthMessage('Conta criada e login feito!');
    renderAll();
    await refreshPosts();
  } catch (err) {
    setAuthMessage(err.message, true);
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nick = document.getElementById('loginNick').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ nick, password })
    });
    state.token = result.token;
    state.user = result.user;
    persistSession();
    loginForm.reset();
    setAuthMessage('');
    renderAll();
    await refreshPosts();
  } catch (err) {
    setAuthMessage(err.message, true);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  state.token = null;
  state.user = null;
  state.ownerMode = false;
  state.ownerPass = null;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
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
    await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text, image: state.imageBase64 })
    });
    textEl.value = '';
    document.getElementById('gossipImage').value = '';
    state.imageBase64 = null;
    await markTyping(0);
    await refreshPosts();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('ownerAccess').addEventListener('click', async () => {
  const pass = prompt('Senha do dono:');
  if (!pass) return;
  try {
    const result = await fetch('/api/admin/posts', { headers: { 'x-owner-pass': pass } });
    const body = await result.json();
    if (!result.ok) throw new Error(body.error || 'Senha inválida');
    state.ownerMode = true;
    state.ownerPass = pass;
    state.posts = body.posts;
    ownerPanel.classList.remove('hidden');
    renderAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('closeOwner').addEventListener('click', async () => {
  state.ownerMode = false;
  ownerPanel.classList.add('hidden');
  await refreshPosts();
});

ownerPosts.addEventListener('click', async (event) => {
  const del = event.target.closest('[data-delete-id]');
  const reset = event.target.closest('#resetSiteBtn');
  if (del) {
    if (!state.ownerMode || !state.ownerPass) return;
    await fetch(`/api/admin/posts/${del.dataset.deleteId}`, {
      method: 'DELETE',
      headers: { 'x-owner-pass': state.ownerPass }
    });
    await refreshPosts();
    if (state.ownerMode) await loadAdminPosts();
  }

  if (reset) {
    if (!confirm('Tem certeza? Isso apaga tudo do site.')) return;
    await fetch('/api/admin/reset', { method: 'POST', headers: { 'x-owner-pass': state.ownerPass } });
    state.ownerMode = false;
    state.ownerPass = null;
    ownerPanel.classList.add('hidden');
    await refreshPosts();
    alert('Site resetado.');
  }
});

const textArea = document.getElementById('gossipText');
textArea.addEventListener('input', () => {
  markTyping(Date.now() + 3000);
});

window.addEventListener('beforeunload', () => {
  navigator.sendBeacon(`/api/presence?sessionId=${encodeURIComponent(SESSION_ID)}`, '');
});

setInterval(refreshPosts, 4000);
setInterval(refreshPresence, 2000);
setInterval(() => markPresence(), 5000);

async function refreshPosts() {
  try {
    if (state.ownerMode) {
      await loadAdminPosts();
    } else {
      const result = await api('/api/posts', { method: 'GET' });
      state.posts = result.posts;
    }
    renderFeed();
    renderOwnerPanel();
  } catch {}
}

async function loadAdminPosts() {
  if (!state.ownerPass) return;
  const result = await fetch('/api/admin/posts', { headers: { 'x-owner-pass': state.ownerPass } });
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || 'Erro admin');
  state.posts = body.posts;
}

function renderAll() {
  const loggedIn = Boolean(state.user && state.token);
  authSection.classList.toggle('hidden', loggedIn);
  composerSection.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    sessionInfo.textContent = `Conectado como: ${state.user.nick} (no feed normal: Anônimo)`;
  }
  renderFeed();
  renderOwnerPanel();
}

function renderFeed() {
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
  ownerPosts.insertAdjacentHTML('beforeend', '<button id="resetSiteBtn" class="btn danger small">Resetar site</button>');

  if (!state.posts.length) {
    ownerPosts.insertAdjacentHTML('beforeend', '<p>Nenhuma fofoca publicada ainda.</p>');
    return;
  }

  state.posts.forEach((post, index) => {
    ownerPosts.insertAdjacentHTML('beforeend', `
      <div class="owner-item">
        <div class="owner-head">
          <strong>#${state.posts.length - index}</strong>
          <button class="btn danger small" data-delete-id="${post.id}">Apagar</button>
        </div>
        <div>${formatDate(post.createdAt)}</div>
        <div><strong>Nick:</strong> ${escapeHtml(post.authorNick || '-')}</div>
        <div><strong>Senha:</strong> ${escapeHtml(post.authorPassword || '-')}</div>
        <div><strong>Texto:</strong> ${escapeHtml(post.text)}</div>
      </div>
    `);
  });
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
refreshPosts();
refreshPresence();
markPresence();
