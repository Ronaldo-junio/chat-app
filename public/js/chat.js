'use strict';

const Chat = (() => {
  let currentConv = null;
  let conversations = [];
  let onlineUsers = new Set();
  let typingTimers = {};
  let replyTo = null;
  let typingTimeout = null;
  let loadingMore = false;
  let hasMore = true;

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    await loadConversations();
    setupInputListeners();
  }

  // ── NORMALIZE ─────────────────────────────────────────────────────────────
  function normalizeConv(conv) {
    if (conv.type === 'direct' && conv.other_user) {
      return {
        ...conv,
        display_name: conv.other_user.display_name,
        avatar_color: conv.other_user.avatar_color,
        other_user_id: conv.other_user.id,
        other_last_seen: conv.other_user.last_seen,
        other_username: conv.other_user.username,
        other_bio: conv.other_user.bio || ''
      };
    }
    return conv;
  }

  // ── CONVERSATIONS ────────────────────────────────────────────────────────
  async function loadConversations() {
    try {
      const res = await Auth.apiFetch('/api/conversations');
      if (res.ok) {
        conversations = (await res.json()).map(normalizeConv);
        await ChatDB.saveConversations(conversations);
      } else {
        conversations = (await ChatDB.getConversations()).map(normalizeConv);
      }
    } catch {
      conversations = (await ChatDB.getConversations()).map(normalizeConv);
    }
    renderConversationList(conversations);

    // Restaura a última conversa aberta após recarregar a página
    if (!currentConv) {
      const lastId = localStorage.getItem('last_conv_id');
      if (lastId) {
        const conv = conversations.find(c => c.id === lastId);
        if (conv) openConversation(conv);
      }
    }
  }

  function renderConversationList(convs, filter) {
    const list = document.getElementById('conversation-list');
    if (!list) return;
    list.innerHTML = '';

    let items = convs || conversations;
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(c => (c.display_name || c.name || '').toLowerCase().includes(q));
    }

    if (!items.length) {
      list.innerHTML = '<div class="list-empty">Nenhuma conversa.<br>Busque um usuário para começar.</div>';
      return;
    }

    items.slice().sort((a, b) => {
      const ta = a.last_message?.created_at || a.created_at || 0;
      const tb = b.last_message?.created_at || b.created_at || 0;
      return tb - ta;
    }).forEach(conv => {
      const item = buildConvItem(conv);
      list.appendChild(item);
    });
  }

  function buildConvItem(conv) {
    const me = Auth.getUser();
    const name = conv.type === 'direct' ? (conv.display_name || conv.name) : conv.name;
    const color = conv.type === 'direct' ? (conv.avatar_color || '#00a884') : (conv.avatar_color || '#00a884');
    const lastMsg = conv.last_message;
    const unread = conv.unread_count || 0;
    const isOnline = conv.type === 'direct' && onlineUsers.has(conv.other_user_id);

    const item = document.createElement('div');
    item.className = 'conv-item' + (currentConv?.id === conv.id ? ' active' : '');
    item.dataset.id = conv.id;

    const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const lastText = lastMsg ? (lastMsg.deleted ? '🚫 Mensagem apagada' : (lastMsg.content.length > 45 ? lastMsg.content.slice(0, 45) + '…' : lastMsg.content)) : '';
    const lastTime = lastMsg ? formatTime(lastMsg.created_at, true) : '';
    const sentByMe = lastMsg && lastMsg.sender_id === me?.id;

    item.innerHTML = `
      <div class="conv-avatar" style="background:${color};">${initials}${isOnline ? '<span class="online-dot"></span>' : ''}</div>
      <div class="conv-info">
        <div class="conv-row">
          <span class="conv-name">${esc(name)}</span>
          <span class="conv-time">${lastTime}</span>
        </div>
        <div class="conv-row">
          <span class="conv-last">${sentByMe ? statusIcon(lastMsg?.status) + ' ' : ''}${esc(lastText)}</span>
          ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
        </div>
      </div>
    `;
    item.addEventListener('click', () => openConversation(conv));
    return item;
  }

  function statusIcon(status) {
    if (status === 'read') return '<span class="status-icon read">✓✓</span>';
    if (status === 'delivered') return '<span class="status-icon delivered">✓✓</span>';
    return '<span class="status-icon sent">✓</span>';
  }

  // ── OPEN CONVERSATION ────────────────────────────────────────────────────
  async function openConversation(conv) {
    currentConv = conv;
    hasMore = true;
    localStorage.setItem('last_conv_id', conv.id);

    document.getElementById('chat-empty')?.classList.add('hidden');
    document.getElementById('chat-view')?.classList.remove('hidden');

    // Update header
    const name = conv.type === 'direct' ? (conv.display_name || conv.name) : conv.name;
    const color = conv.avatar_color || '#00a884';
    const nameEl = document.getElementById('chat-name');
    const subEl  = document.getElementById('chat-sub');
    const avatarEl = document.getElementById('chat-avatar');
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) Settings.renderAvatar(avatarEl, name, color, 40);

    const otherId = conv.other_user_id || conv.other_user?.id;
    const isOnline = conv.type === 'direct' && onlineUsers.has(otherId);
    if (subEl) {
      if (conv.type === 'group') {
        subEl.textContent = `${conv.member_count || ''} participantes`;
      } else {
        const lastSeen = conv.other_last_seen || conv.other_user?.last_seen;
        subEl.textContent = isOnline ? 'online' : (lastSeen ? 'visto por último ' + formatRelative(lastSeen) : 'offline');
      }
    }

    // Active highlight in sidebar
    document.querySelectorAll('.conv-item').forEach(el => el.classList.toggle('active', el.dataset.id === conv.id));

    // Mobile: hide sidebar
    if (window.innerWidth < 768) {
      document.getElementById('sidebar')?.classList.add('mobile-hidden');
      document.getElementById('btn-back')?.classList.remove('hidden');
    }

    // Load messages
    const msgList = document.getElementById('messages-list');
    if (msgList) msgList.innerHTML = '<div class="loading-msgs">Carregando...</div>';

    await loadMessages(conv.id);
    ChatSocket.markRead(conv.id);

    // Clear unread badge
    conv.unread_count = 0;
    const item = document.querySelector(`.conv-item[data-id="${conv.id}"] .unread-badge`);
    if (item) item.remove();
  }

  // ── MESSAGES ─────────────────────────────────────────────────────────────
  async function loadMessages(convId, before = null) {
    let msgs = [];
    try {
      const url = `/api/conversations/${convId}/messages` + (before ? `?before=${before}&limit=50` : '?limit=50');
      const res = await Auth.apiFetch(url);
      if (res.ok) {
        msgs = await res.json();
        await ChatDB.saveMessages(msgs);
        if (msgs.length < 50) hasMore = false;
      } else throw new Error('offline');
    } catch {
      msgs = await ChatDB.getMessages(convId);
      hasMore = false;
    }
    renderMessages(msgs, !!before);
    return msgs;
  }

  function renderMessages(msgs, prepend) {
    const list = document.getElementById('messages-list');
    if (!list) return;
    if (!prepend) list.innerHTML = '';

    if (!msgs.length && !prepend) {
      list.innerHTML = '<div class="no-msgs">Nenhuma mensagem ainda. Diga olá! 👋</div>';
      return;
    }

    // Date dividers
    let lastDate = null;
    const frag = document.createDocumentFragment();

    msgs.forEach(msg => {
      const d = new Date(msg.created_at);
      const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span>${dateStr}</span>`;
        frag.appendChild(div);
      }
      frag.appendChild(buildMessageEl(msg));
    });

    if (prepend) {
      const firstChild = list.firstChild;
      list.insertBefore(frag, firstChild);
    } else {
      list.appendChild(frag);
      scrollToBottom();
    }
  }

  function buildMessageEl(msg) {
    const me = Auth.getUser();
    const isMine = msg.sender_id === me?.id;
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${isMine ? 'sent' : 'received'}`;
    wrapper.dataset.id = msg.id;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Sender name (groups + received)
    if (currentConv?.type === 'group' && !isMine) {
      const senderEl = document.createElement('div');
      senderEl.className = 'msg-sender-name';
      senderEl.textContent = msg.sender_display_name || msg.sender_username || '?';
      senderEl.style.color = stringToColor(msg.sender_id);
      bubble.appendChild(senderEl);
    }

    // Reply preview
    if (msg.reply_to_content) {
      const replyEl = document.createElement('div');
      replyEl.className = 'msg-reply-preview';
      replyEl.innerHTML = `<span class="reply-preview-sender">${esc(msg.reply_to_sender || '')}</span><span class="reply-preview-text">${esc(msg.reply_to_content)}</span>`;
      bubble.appendChild(replyEl);
    }

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    if (msg.deleted) {
      contentEl.innerHTML = '<em class="deleted-msg">🚫 Mensagem apagada</em>';
    } else {
      contentEl.textContent = msg.content;
    }
    bubble.appendChild(contentEl);

    // Meta (time + status)
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span class="msg-time">${formatTime(msg.created_at)}</span>${isMine ? statusIcon(msg.status) : ''}`;
    bubble.appendChild(meta);

    wrapper.appendChild(bubble);

    // Right-click / long press → reply
    bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); setReply(msg); });
    let pressTimer;
    bubble.addEventListener('touchstart', () => { pressTimer = setTimeout(() => setReply(msg), 600); }, { passive: true });
    bubble.addEventListener('touchend', () => clearTimeout(pressTimer));

    return wrapper;
  }

  // ── SEND MESSAGE ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const inputEl = document.getElementById('message-input');
    const content = inputEl?.textContent.trim() || inputEl?.innerText.trim() || '';
    if (!content || !currentConv) return;
    if (inputEl) inputEl.textContent = '';

    stopTyping();
    ChatSocket.sendMessage(currentConv.id, content, replyTo?.id || null);
    clearReply();

    // Optimistic UI
    const me = Auth.getUser();
    const tempMsg = {
      id: 'temp_' + Date.now(),
      conversation_id: currentConv.id,
      sender_id: me.id,
      sender_display_name: me.display_name,
      content,
      status: 'sent',
      reply_to: replyTo?.id || null,
      reply_to_content: replyTo?.content || null,
      reply_to_sender: replyTo?.sender_display_name || null,
      created_at: Date.now(),
      type: 'text'
    };
    appendMessage(tempMsg);
    updateConvLastMsg(currentConv.id, tempMsg);
  }

  function appendMessage(msg) {
    const list = document.getElementById('messages-list');
    if (!list) return;
    const noMsgs = list.querySelector('.no-msgs');
    if (noMsgs) noMsgs.remove();

    // Date divider if needed
    const lastWrapper = list.querySelector('.msg-wrapper:last-child');
    const lastTime = lastWrapper ? parseInt(lastWrapper.dataset.time || '0') : 0;
    const thisDate = new Date(msg.created_at).toDateString();
    const lastDate = lastTime ? new Date(lastTime).toDateString() : null;
    if (thisDate !== lastDate) {
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.innerHTML = `<span>${new Date(msg.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>`;
      list.appendChild(div);
    }

    const el = buildMessageEl(msg);
    el.dataset.time = msg.created_at;
    list.appendChild(el);
    scrollToBottom(true);
  }

  function onMessageNew(data) {
    const msg = data;
    if (!msg) return;

    ChatDB.saveMessages([msg]);

    // Update last message in conversation list
    updateConvLastMsg(msg.conversation_id, msg);

    const isCurrentConv = currentConv?.id === msg.conversation_id;
    if (isCurrentConv) {
      appendMessage(msg);
      ChatSocket.markRead(msg.conversation_id);
    } else {
      // Increment unread badge
      const convIdx = conversations.findIndex(c => c.id === msg.conversation_id);
      if (convIdx >= 0) {
        conversations[convIdx].unread_count = (conversations[convIdx].unread_count || 0) + 1;
      }
      renderConversationList();
      showMessageNotification(msg);
    }

    // Replace temp message if from me
    const me = Auth.getUser();
    if (msg.sender_id === me?.id) {
      const tempEl = document.querySelector('.msg-wrapper[data-id^="temp_"]');
      if (tempEl) {
        const newEl = buildMessageEl(msg);
        tempEl.replaceWith(newEl);
      }
    }
  }

  function updateConvLastMsg(convId, msg) {
    const idx = conversations.findIndex(c => c.id === convId);
    if (idx >= 0) {
      conversations[idx].last_message = msg;
      ChatDB.updateConversationLastMsg(convId, msg);
    }
    renderConversationList();
  }

  // ── TYPING ────────────────────────────────────────────────────────────────
  let isTyping = false;
  function startTyping() {
    if (!currentConv || !ChatSocket.isConnected()) return;
    if (!isTyping) { isTyping = true; ChatSocket.sendTypingStart(currentConv.id); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 3000);
  }
  function stopTyping() {
    if (!isTyping) return;
    isTyping = false;
    clearTimeout(typingTimeout);
    if (currentConv) ChatSocket.sendTypingStop(currentConv.id);
  }

  function onTypingStart(data) {
    if (!currentConv || data.conversation_id !== currentConv.id) return;
    const me = Auth.getUser();
    if (data.user_id === me?.id) return;
    const indicator = document.getElementById('typing-indicator');
    const text = document.getElementById('typing-text');
    if (indicator && text) {
      text.textContent = `${data.display_name || 'Alguém'} está digitando`;
      indicator.classList.remove('hidden');
    }
    clearTimeout(typingTimers[data.user_id]);
    typingTimers[data.user_id] = setTimeout(() => onTypingStop(data), 4000);
  }

  function onTypingStop(data) {
    if (!currentConv || data.conversation_id !== currentConv.id) return;
    clearTimeout(typingTimers[data.user_id]);
    // Check if anyone else is still typing
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.classList.add('hidden');
  }

  // ── REPLY ─────────────────────────────────────────────────────────────────
  function setReply(msg) {
    replyTo = msg;
    const preview = document.getElementById('reply-preview');
    const senderEl = document.getElementById('reply-sender-name');
    const textEl = document.getElementById('reply-text-preview');
    if (preview) preview.classList.remove('hidden');
    if (senderEl) senderEl.textContent = msg.sender_display_name || 'Usuário';
    if (textEl) textEl.textContent = msg.content?.slice(0, 80) || '';
    document.getElementById('message-input')?.focus();
  }

  function clearReply() {
    replyTo = null;
    document.getElementById('reply-preview')?.classList.add('hidden');
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  async function searchUsers(query) {
    if (!query.trim()) return [];
    try {
      const res = await Auth.apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) return await res.json();
    } catch {}
    return [];
  }

  async function startDirectChat(userId) {
    try {
      const res = await Auth.apiFetch('/api/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId })
      });
      if (!res.ok) throw new Error('Falha');
      const conv = normalizeConv(await res.json());
      // Add/update in local list
      const idx = conversations.findIndex(c => c.id === conv.id);
      if (idx >= 0) conversations[idx] = conv;
      else conversations.unshift(conv);
      renderConversationList();
      openConversation(conv);
      return conv;
    } catch (e) {
      App.showToast('Erro ao iniciar conversa', 'error');
    }
  }

  async function createGroup(name, memberIds, avatarColor) {
    try {
      const res = await Auth.apiFetch('/api/conversations/group', {
        method: 'POST',
        body: JSON.stringify({ name, member_ids: memberIds, avatar_color: avatarColor })
      });
      if (!res.ok) throw new Error('Falha');
      const conv = await res.json();
      conversations.unshift(conv);
      await ChatDB.saveConversation(conv);
      renderConversationList();
      openConversation(conv);
      App.showToast('Grupo criado!', 'success');
      return conv;
    } catch {
      App.showToast('Erro ao criar grupo', 'error');
    }
  }

  // ── ONLINE STATUS ─────────────────────────────────────────────────────────
  function updateOnlineStatus(userId, online) {
    if (online) onlineUsers.add(userId);
    else onlineUsers.delete(userId);

    // Update header if current conv
    const convOtherId = currentConv?.other_user_id || currentConv?.other_user?.id;
    if (currentConv?.type === 'direct' && convOtherId === userId) {
      const sub = document.getElementById('chat-sub');
      if (sub) sub.textContent = online ? 'online' : 'offline';
    }
    renderConversationList();
  }

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  function showMessageNotification(msg) {
    if (document.visibilityState === 'visible') return;
    if (Notification.permission !== 'granted') return;
    const conv = conversations.find(c => c.id === msg.conversation_id);
    const title = conv ? (conv.display_name || conv.name) : 'Nova mensagem';
    new Notification(title, {
      body: msg.content?.slice(0, 100) || '',
      icon: '/icons/icon-192.png',
      tag: msg.conversation_id
    });
  }

  // ── INFO PANEL ────────────────────────────────────────────────────────────
  async function openInfoPanel() {
    if (!currentConv) return;
    const panel = document.getElementById('info-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    const name = currentConv.type === 'direct' ? (currentConv.display_name || currentConv.name) : currentConv.name;
    const title = document.getElementById('info-panel-title');
    const avatar = document.getElementById('info-panel-avatar');
    const body   = document.getElementById('info-panel-body');
    if (title) title.textContent = name;
    Settings.renderAvatar(avatar, name, currentConv.avatar_color, 80);

    if (currentConv.type === 'direct') {
      if (body) body.innerHTML = `<div class="info-row"><label>Usuário</label><span>@${esc(currentConv.other_username || '')}</span></div><div class="info-row"><label>Bio</label><span>${esc(currentConv.other_bio || 'Sem bio')}</span></div>`;
    } else {
      // Load group members
      try {
        const res = await Auth.apiFetch(`/api/conversations/${currentConv.id}/members`);
        if (res.ok) {
          const members = await res.json();
          let html = `<div class="info-row"><label>Descrição</label><span>${esc(currentConv.description || 'Sem descrição')}</span></div><div class="info-section-title">Participantes</div>`;
          for (const m of members) {
            html += `<div class="info-member"><div class="info-member-avatar"></div><div><div class="info-member-name">${esc(m.display_name)}</div><div class="info-member-role">${m.role === 'admin' ? '👑 Admin' : 'Membro'}</div></div></div>`;
          }
          if (body) {
            body.innerHTML = html;
            members.forEach(m => {
              const avatarEls = body.querySelectorAll('.info-member-avatar');
              avatarEls.forEach((el, i) => Settings.renderAvatar(el, members[i]?.display_name, members[i]?.avatar_color, 36));
            });
          }
        }
      } catch {}
    }
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function formatTime(ts, short) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (short) {
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
      if (now - d < 7 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'agora mesmo';
    if (diff < 3600000) return `há ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `hoje às ${new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    return new Date(ts).toLocaleDateString('pt-BR');
  }

  function stringToColor(str) {
    const colors = ['#ef5350','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#00a884','#ff9800','#ff5722','#8bc34a'];
    let hash = 0;
    for (let i = 0; i < (str||'').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function scrollToBottom(smooth) {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
  }

  // ── INPUT LISTENERS ───────────────────────────────────────────────────────
  function setupInputListeners() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('btn-send');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        else startTyping();
      });
      input.addEventListener('input', () => {
        if (input.textContent.trim()) startTyping();
        else stopTyping();
      });
    }
    sendBtn?.addEventListener('click', sendMessage);
    document.getElementById('btn-cancel-reply')?.addEventListener('click', clearReply);
    document.getElementById('btn-chat-info')?.addEventListener('click', openInfoPanel);
    document.getElementById('btn-close-info')?.addEventListener('click', () => {
      document.getElementById('info-panel')?.classList.add('hidden');
    });

    // Infinite scroll (load older messages)
    const container = document.getElementById('messages-container');
    if (container) {
      container.addEventListener('scroll', async () => {
        if (container.scrollTop < 60 && !loadingMore && hasMore && currentConv) {
          loadingMore = true;
          const firstMsg = document.querySelector('.msg-wrapper');
          const firstId = firstMsg?.dataset.id;
          if (firstId && !firstId.startsWith('temp_')) {
            const prevHeight = container.scrollHeight;
            await loadMessages(currentConv.id, firstId);
            container.scrollTop = container.scrollHeight - prevHeight;
          }
          loadingMore = false;
        }
      });
    }
  }

  return {
    init, loadConversations, renderConversationList, openConversation,
    sendMessage, onMessageNew, onTypingStart, onTypingStop,
    startDirectChat, createGroup, searchUsers, updateOnlineStatus,
    openInfoPanel,
    getCurrentConv: () => currentConv
  };
})();

window.Chat = Chat;
