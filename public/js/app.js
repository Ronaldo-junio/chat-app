'use strict';

const App = (() => {
  let groupSelectedUsers = [];
  let groupSelectedColor = '#00a884';
  let searchDebounce = null;
  let userSearchDebounce = null;

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    await ChatDB.open();
    if (Auth.isLoggedIn()) {
      await startApp();
    } else {
      showAuthScreen();
      setupAuthListeners();
    }
  }

  async function startApp() {
    const user = Auth.getUser();
    if (!user) { showAuthScreen(); setupAuthListeners(); return; }

    Settings.applyTheme(user);

    // Connect socket
    ChatSocket.connect(Auth.getToken());
    ChatSocket.on('message:new',    data => Chat.onMessageNew(data));
    ChatSocket.on('typing:start',   data => Chat.onTypingStart(data));
    ChatSocket.on('typing:stop',    data => Chat.onTypingStop(data));
    ChatSocket.on('user:online',    data => Chat.updateOnlineStatus(data.userId, true));
    ChatSocket.on('user:offline',   data => Chat.updateOnlineStatus(data.userId, false));
    ChatSocket.on('disconnected',   () => showToast('Conexão perdida. Reconectando...', 'warning'));
    ChatSocket.on('connected',      () => {
      showToast('Conectado', 'success');
      Chat.loadConversations();
    });

    showMainScreen();
    Settings.init(user);
    await Chat.init();
    setupUIListeners();

    if (Notification.permission === 'default') Notification.requestPermission();
  }

  // ── AUTH ──────────────────────────────────────────────────────────────────
  function showAuthScreen() {
    document.getElementById('screen-auth')?.classList.remove('hidden');
    document.getElementById('screen-auth')?.classList.add('active');
    document.getElementById('screen-main')?.classList.add('hidden');
    document.getElementById('screen-main')?.classList.remove('active');
  }

  function showMainScreen() {
    document.getElementById('screen-main')?.classList.remove('hidden');
    document.getElementById('screen-main')?.classList.add('active');
    document.getElementById('screen-auth')?.classList.add('hidden');
    document.getElementById('screen-auth')?.classList.remove('active');
  }

  function setupAuthListeners() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('form-login')?.classList.toggle('active', target === 'login');
        document.getElementById('form-login')?.classList.toggle('hidden', target !== 'login');
        document.getElementById('form-register')?.classList.toggle('active', target === 'register');
        document.getElementById('form-register')?.classList.toggle('hidden', target !== 'register');
      });
    });

    // Login form
    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username')?.value.trim();
      const password = document.getElementById('login-password')?.value;
      const errEl = document.getElementById('login-error');
      if (errEl) errEl.classList.add('hidden');
      try {
        await Auth.login(username, password);
        await startApp();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      }
    });

    // Register form
    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const display_name = document.getElementById('reg-display')?.value.trim();
      const username     = document.getElementById('reg-username')?.value.trim();
      const password     = document.getElementById('reg-password')?.value;
      const errEl = document.getElementById('reg-error');
      if (errEl) errEl.classList.add('hidden');
      try {
        await Auth.register(username, password, display_name);
        await startApp();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      }
    });
  }

  // ── MAIN UI LISTENERS ──────────────────────────────────────────────────────
  function setupUIListeners() {
    // Search bar
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        const q = searchInput.value.trim();
        searchDebounce = setTimeout(() => {
          if (!q) {
            Chat.renderConversationList();
            return;
          }
          // First filter local conversations
          Chat.renderConversationList(null, q);
        }, 200);
      });
      searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim()) openNewChatModal();
      });
    }

    // Back button (mobile)
    document.getElementById('btn-back')?.addEventListener('click', () => {
      document.getElementById('chat-view')?.classList.add('hidden');
      document.getElementById('chat-empty')?.classList.remove('hidden');
      document.getElementById('sidebar')?.classList.remove('mobile-hidden');
      document.getElementById('btn-back')?.classList.add('hidden');
    });

    // New group button
    document.getElementById('btn-new-group')?.addEventListener('click', openNewGroupModal);

    // New chat modal
    document.getElementById('btn-close-new-chat')?.addEventListener('click', closeNewChatModal);
    document.getElementById('modal-new-chat')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-new-chat')) closeNewChatModal();
    });

    const userSearchInput = document.getElementById('user-search-input');
    if (userSearchInput) {
      userSearchInput.addEventListener('input', async () => {
        clearTimeout(userSearchDebounce);
        const q = userSearchInput.value.trim();
        if (!q) { document.getElementById('user-search-results').innerHTML = ''; return; }
        userSearchDebounce = setTimeout(async () => {
          const users = await Chat.searchUsers(q);
          renderUserSearchResults('user-search-results', users, async (user) => {
            closeNewChatModal();
            await Chat.startDirectChat(user.id);
          });
        }, 300);
      });
    }

    // New group modal
    setupGroupModal();

    // Window resize
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        document.getElementById('sidebar')?.classList.remove('mobile-hidden');
        document.getElementById('btn-back')?.classList.add('hidden');
      }
    });
  }

  // ── NEW CHAT MODAL ────────────────────────────────────────────────────────
  function openNewChatModal() {
    const modal = document.getElementById('modal-new-chat');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => document.getElementById('user-search-input')?.focus(), 100);
    }
    document.getElementById('search-input').blur();
  }

  function closeNewChatModal() {
    document.getElementById('modal-new-chat')?.classList.add('hidden');
    document.getElementById('user-search-input').value = '';
    document.getElementById('user-search-results').innerHTML = '';
    document.getElementById('search-input').value = '';
    Chat.renderConversationList();
  }

  // ── USER SEARCH RESULTS ───────────────────────────────────────────────────
  function renderUserSearchResults(containerId, users, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!users.length) {
      container.innerHTML = '<div class="search-empty">Nenhum usuário encontrado</div>';
      return;
    }
    users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'user-result-item';
      const avatarEl = document.createElement('div');
      avatarEl.className = 'user-result-avatar';
      Settings.renderAvatar(avatarEl, user.display_name, user.avatar_color, 40);
      item.appendChild(avatarEl);
      const info = document.createElement('div');
      info.className = 'user-result-info';
      info.innerHTML = `<div class="user-result-name">${esc(user.display_name)}</div><div class="user-result-username">@${esc(user.username)}</div>`;
      item.appendChild(info);
      item.addEventListener('click', () => onSelect(user));
      container.appendChild(item);
    });
  }

  // ── NEW GROUP MODAL ───────────────────────────────────────────────────────
  function openNewGroupModal() {
    groupSelectedUsers = [];
    groupSelectedColor = '#00a884';
    document.getElementById('modal-new-group')?.classList.remove('hidden');
    document.getElementById('group-step-1')?.classList.remove('hidden');
    document.getElementById('group-step-2')?.classList.add('hidden');
    document.getElementById('group-selected-users').innerHTML = '';
    document.getElementById('group-search-results').innerHTML = '';
    document.getElementById('group-user-search').value = '';
    document.getElementById('group-name-input').value = '';
    document.getElementById('btn-group-next').disabled = true;
    setTimeout(() => document.getElementById('group-user-search')?.focus(), 100);
  }

  function setupGroupModal() {
    document.getElementById('btn-close-new-group')?.addEventListener('click', () => {
      document.getElementById('modal-new-group')?.classList.add('hidden');
    });
    document.getElementById('modal-new-group')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-new-group')) document.getElementById('modal-new-group').classList.add('hidden');
    });

    const groupSearch = document.getElementById('group-user-search');
    if (groupSearch) {
      groupSearch.addEventListener('input', async () => {
        clearTimeout(userSearchDebounce);
        const q = groupSearch.value.trim();
        if (!q) { document.getElementById('group-search-results').innerHTML = ''; return; }
        userSearchDebounce = setTimeout(async () => {
          const users = await Chat.searchUsers(q);
          renderUserSearchResults('group-search-results', users.filter(u => !groupSelectedUsers.find(s => s.id === u.id)), (user) => {
            addGroupUser(user);
            groupSearch.value = '';
            document.getElementById('group-search-results').innerHTML = '';
            groupSearch.focus();
          });
        }, 300);
      });
    }

    document.getElementById('btn-group-next')?.addEventListener('click', () => {
      if (groupSelectedUsers.length < 1) return;
      document.getElementById('group-step-1')?.classList.add('hidden');
      document.getElementById('group-step-2')?.classList.remove('hidden');
      Settings.renderColorPicker('group-color-picker', groupSelectedColor, (c) => { groupSelectedColor = c; });
      setTimeout(() => document.getElementById('group-name-input')?.focus(), 100);
    });

    document.getElementById('btn-group-create')?.addEventListener('click', async () => {
      const name = document.getElementById('group-name-input')?.value.trim();
      if (!name) { showToast('Digite o nome do grupo', 'error'); return; }
      document.getElementById('modal-new-group')?.classList.add('hidden');
      await Chat.createGroup(name, groupSelectedUsers.map(u => u.id), groupSelectedColor);
    });
  }

  function addGroupUser(user) {
    groupSelectedUsers.push(user);
    const container = document.getElementById('group-selected-users');
    const chip = document.createElement('div');
    chip.className = 'user-chip';
    chip.dataset.id = user.id;
    const av = document.createElement('div');
    Settings.renderAvatar(av, user.display_name, user.avatar_color, 28);
    chip.appendChild(av);
    chip.innerHTML += `<span>${esc(user.display_name)}</span><button>✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      groupSelectedUsers = groupSelectedUsers.filter(u => u.id !== user.id);
      chip.remove();
      document.getElementById('btn-group-next').disabled = groupSelectedUsers.length < 1;
    });
    container.appendChild(chip);
    document.getElementById('btn-group-next').disabled = groupSelectedUsers.length < 1;
  }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, showToast };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
