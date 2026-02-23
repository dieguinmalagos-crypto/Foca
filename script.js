const STORAGE_KEYS = {
  users: 'foca_users',
  posts: 'foca_posts',
  currentUser: 'foca_current_user',
  presence: 'foca_presence'
};

const OWNER_PASS = 'FOFOCA8A_DONO';
const SESSION_ID = crypto.randomUUID();

const state = {
  users: load(STORAGE_KEYS.users, []),
  posts: load(STORAGE_KEYS.posts, []),
  currentUserId: localStorage.getItem(STORAGE_KEYS.currentUser),
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
const onlineCount = document.getElementById('onlineCount');
const typingCount = document.getElementById('typingCount');

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

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const nick = document.getElementById('registerNick').value.trim();
  const password = document.getElementById('registerPassword').value;

  if (!nick || !password) return;

  const nickTaken = state.users.some((user) => user.nick.toLowerCase() === nick.toLowerCase());
  if (nickTaken) {
    setAuthMessage('Esse nick já existe. Escolha outro.', true);
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    nick,
    password
  };

  state.users.push(user);
  persist(STORAGE_KEYS.users, state.users);

  registerForm.reset();
  setAuthMessage('Conta criada com sucesso! Agora você já pode entrar.');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const nick = document.getElementById('loginNick').value.trim();
  const password = document.getElementById('loginPassword').value;

  const user = state.users.find(
    (candidate) => candidate.nick.toLowerCase() === nick.toLowerCase() && candidate.password === password
  );

  if (!user) {
    setAuthMessage('Nick ou senha incorretos.', true);
    return;
  }

  state.currentUserId = user.id;
  localStorage.setItem(STORAGE_KEYS.currentUser, user.id);

  loginForm.reset();
  setAuthMessage('');
  renderAll();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  stopTyping();
  state.currentUserId = null;
  localStorage.removeItem(STORAGE_KEYS.currentUser);
  renderAll();
});

searchInput.addEventListener('input', () => renderFeed());

document.getElementById('gossipImage').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    state.imageBase64 = null;
    return;
  }
  state.imageBase64 = await fileToBase64(file);
});

gossipForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.currentUserId) return;

  const textEl = document.getElementById('gossipText');
  const text = textEl.value.trim();
  if (!text) return;

  const post = {
    id: crypto.randomUUID(),
    text,
    image: state.imageBase64,
    authorId: state.currentUserId,
    createdAt: new Date().toISOString()
  };

  state.posts.unshift(post);
  persist(STORAGE_KEYS.posts, state.posts);

  textEl.value = '';
  document.getElementById('gossipImage').value = '';
  state.imageBase64 = null;
  stopTyping();
  renderAll();
});

document.getElementById('ownerAccess').addEventListener('click', () => {
  const pass = prompt('Senha do dono:');
  if (pass === OWNER_PASS) {
    state.ownerMode = true;
    ownerPanel.classList.remove('hidden');
    renderOwnerPanel();
  } else if (pass !== null) {
    alert('Senha incorreta.');
  }
});

document.getElementById('closeOwner').addEventListener('click', () => {
  state.ownerMode = false;
  ownerPanel.classList.add('hidden');
});

ownerPosts.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-id]');
  if (!button) return;

  const postId = button.dataset.deleteId;
  state.posts = state.posts.filter((post) => post.id !== postId);
  persist(STORAGE_KEYS.posts, state.posts);
  renderAll();
});

const textArea = document.getElementById('gossipText');
textArea.addEventListener('input', () => {
  if (!state.currentUserId) return;
  markTyping(3000);
});

window.addEventListener('storage', (event) => {
  if ([STORAGE_KEYS.posts, STORAGE_KEYS.users, STORAGE_KEYS.presence].includes(event.key)) {
    state.posts = load(STORAGE_KEYS.posts, []);
    state.users = load(STORAGE_KEYS.users, []);
    renderAll();
  }
});

window.addEventListener('beforeunload', () => {
  removePresence();
});

setInterval(() => {
  touchPresence();
  clearOldPresence();
  renderPresence();
}, 5000);

setInterval(() => {
  renderPresence();
}, 1000);

function renderAll() {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const loggedIn = Boolean(currentUser);

  authSection.classList.toggle('hidden', loggedIn);
  composerSection.classList.toggle('hidden', !loggedIn);

  if (loggedIn) {
    sessionInfo.textContent = `Conectado como: ${currentUser.nick} (no feed todos veem "Anônimo")`;
  }

  renderFeed();
  renderOwnerPanel();
  touchPresence();
  renderPresence();
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
  if (!state.posts.length) {
    ownerPosts.innerHTML = '<p>Nenhuma fofoca publicada ainda.</p>';
    return;
  }

  state.posts.forEach((post, index) => {
    const author = state.users.find((user) => user.id === post.authorId);
    const item = document.createElement('div');
    item.className = 'owner-item';
    item.innerHTML = `
      <div class="owner-head">
        <strong>#${state.posts.length - index}</strong>
        <button class="btn danger small" data-delete-id="${post.id}">Apagar</button>
      </div>
      <div>${formatDate(post.createdAt)}</div>
      <div><strong>Autor:</strong> ${author?.nick || 'Perfil removido'}</div>
      <div><strong>Texto:</strong> ${escapeHtml(post.text)}</div>
    `;
    ownerPosts.appendChild(item);
  });
}

function renderPresence() {
  const presence = load(STORAGE_KEYS.presence, {});
  const now = Date.now();

  const entries = Object.values(presence);
  const online = entries.filter((entry) => now - entry.lastSeen < 15000).length;
  const typing = entries.filter((entry) => (entry.typingUntil || 0) > now).length;

  onlineCount.textContent = `${online} anônimos online`;
  typingCount.textContent = `${typing} digitando agora`;
}

function touchPresence() {
  const presence = load(STORAGE_KEYS.presence, {});
  const existing = presence[SESSION_ID] || {};
  presence[SESSION_ID] = {
    ...existing,
    userId: state.currentUserId,
    lastSeen: Date.now(),
    typingUntil: existing.typingUntil || 0
  };
  persist(STORAGE_KEYS.presence, presence);
}

function markTyping(durationMs) {
  const presence = load(STORAGE_KEYS.presence, {});
  const existing = presence[SESSION_ID] || {};
  presence[SESSION_ID] = {
    ...existing,
    userId: state.currentUserId,
    lastSeen: Date.now(),
    typingUntil: Date.now() + durationMs
  };
  persist(STORAGE_KEYS.presence, presence);
}

function stopTyping() {
  const presence = load(STORAGE_KEYS.presence, {});
  const existing = presence[SESSION_ID];
  if (!existing) return;
  existing.typingUntil = 0;
  presence[SESSION_ID] = existing;
  persist(STORAGE_KEYS.presence, presence);
}

function clearOldPresence() {
  const presence = load(STORAGE_KEYS.presence, {});
  const now = Date.now();
  let changed = false;

  Object.entries(presence).forEach(([session, entry]) => {
    if (now - entry.lastSeen > 30000) {
      delete presence[session];
      changed = true;
    }
  });

  if (changed) persist(STORAGE_KEYS.presence, presence);
}

function removePresence() {
  const presence = load(STORAGE_KEYS.presence, {});
  delete presence[SESSION_ID];
  persist(STORAGE_KEYS.presence, presence);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

function escapeHtml(value) {
  return value
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
