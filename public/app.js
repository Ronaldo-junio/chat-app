'use strict';

const socket = io();

// Estado local
let me = null;
let currentRoomId = null;
let rooms = {};
let onlineUsers = [];
let typingTimers = {};
let replyTo = null;
let unread = {};

const EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😎','🤔','😅','😭','🤩','😜','🤗','😴','🥳',
  '👍','👎','❤️','🔥','💯','🎉','✅','🙏','💪','🚀','⭐','💡','🎊','🎈','🌟',
  '🍕','🍔','🍣','☕','🍺','🎮','🏆','🎵','🎶','💃','🌈','🌍','🐶','🐱','🦁'];

// Elementos principais
const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const nameInput = document.getElementById('user-name');
const roomsList = document.getElementById('rooms-list');
const usersList = document.getElementById('users-list');
const emptyState = document.getElementById('empty-state');
const chatPanel = document.getElementById('chat-panel');
const messagesList = document.getElementById('messages-list');
const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const chatName = document.getElementById('chat-name');
const chatSubtitle = document.getElementById('chat-subtitle');
const chatAvatar = document.getElementById('chat-avatar');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const replyPreview = document.getElementById('reply-preview');
const replySender = document.getElementById('reply-sender');
const replyText = document.getElementById('reply-text');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const toastContainer = document.getElementById('toast-container');
const statusSelect = document.getElementById('status-select');
const searchInput = document.getElementById('search-input');
const myAvatar = document.getElementById('my-avatar');
const sidebar = document.getElementById('sidebar');
const backBtn = document.getElementById('back-btn');

// Login
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  socket.emit('register', { name });
});

socket.on('registered', ({ user, rooms: roomList }) => {
  me = user;
  myAvatar.style.background = user.color;
  myAvatar.textContent = user.name.charAt(0).toUpperCase();

  roomList.forEach(r => addRoom(r));

  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
});

// Usuários online
socket.on('users_online', (users) => {
  onlineUsers = users;
  renderUsersList();
  updateRoomSubtitles();
});

// Nova mensagem
socket.on('new_message', ({ roomId, message }) => {
  if (currentRoomId === roomId) {
    appendMessage(message);
    scrollToBottom();
  } else {
    unread[roomId] = (unread[roomId] || 0) + 1;
    renderRoomsList();
    if (message.senderId !== me?.id) showToast(`${message.senderName}: ${message.text}`, roomId);
  }
  updateRoomLastMsg(roomId, message);
});

// Mensagem do sistema
socket.on('system_message', ({ roomId, message }) => {
  if (currentRoomId === roomId) appendSystemMessage(message.text);
  updateRoomLastMsg(roomId, { text: message.text, senderName: '' });
});

// Nova sala adicionada
socket.on('room_added', (room) => {
  addRoom(room);
  showToast(`Você foi adicionado em "${room.name || 'nova conversa'}"`);
});

// Reações
socket.on('reaction_update', ({ roomId, messageId, reactions }) => {
  if (currentRoomId !== roomId) return;
  const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;
  let reactEl = msgEl.querySelector('.msg-reactions');
  if (!reactEl) { reactEl = document.createElement('div'); reactEl.className = 'msg-reactions'; msgEl.querySelector('.msg-footer').before(reactEl); }
  reactEl.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, users]) => {
    const pill = document.createElement('span');
    pill.className = 'reaction-pill';
    pill.textContent = `${emoji} ${users.length}`;
    pill.title = users.join(', ');
    pill.onclick = () => socket.emit('react', { roomId, messageId, emoji });
    reactEl.appendChild(pill);
  });
});

// Typing
socket.on('user_typing', ({ roomId, userId, name, isTyping }) => {
  if (currentRoomId !== roomId || userId === me?.id) return;
  clearTimeout(typingTimers[userId]);
  if (isTyping) {
    typingIndicator.classList.remove('hidden');
    typingText.textContent = `${name} está digitando...`;
    typingTimers[userId] = setTimeout(() => typingIndicator.classList.add('hidden'), 3000);
  } else {
    typingIndicator.classList.add('hidden');
  }
});

// Funções de UI
function addRoom(room) {
  rooms[room.id] = room;
  renderRoomsList();
  if (room.type === 'group' || room.id === 'general') {
    room.messages?.forEach(m => {/* loaded on open */});
  }
}

function getRoomDisplayName(room) {
  if (room.type === 'dm') {
    const other = onlineUsers.find(u => room.members?.includes(u.id) && u.id !== me?.id);
    return other ? other.name : room.name || 'Conversa Privada';
  }
  return room.name || 'Sala';
}

function getRoomAvatar(room) {
  if (room.type === 'dm') {
    const other = onlineUsers.find(u => room.members?.includes(u.id) && u.id !== me?.id);
    return { text: (other ? other.name : 'U').charAt(0).toUpperCase(), color: other?.color || '#607D8B' };
  }
  return { text: room.icon || room.name?.charAt(0)?.toUpperCase() || '?', color: '#128C7E' };
}

function renderRoomsList() {
  const query = searchInput.value.toLowerCase();
  roomsList.innerHTML = '';
  const sorted = Object.values(rooms).sort((a, b) => {
    const aMsg = a.messages?.[a.messages.length - 1]?.timestamp || a.createdAt || 0;
    const bMsg = b.messages?.[b.messages.length - 1]?.timestamp || b.createdAt || 0;
    return bMsg - aMsg;
  });
  sorted.filter(r => {
    const name = getRoomDisplayName(r).toLowerCase();
    return !query || name.includes(query);
  }).forEach(room => {
    const item = document.createElement('div');
    item.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');
    const av = getRoomAvatar(room);
    const lastMsg = room.messages?.[room.messages.length - 1];
    const badge = unread[room.id] || 0;
    item.innerHTML = `
      <div class="room-avatar" style="background:${av.color}">${av.text}</div>
      <div class="room-info">
        <div class="room-name">${escHtml(getRoomDisplayName(room))}</div>
        <div class="room-last-msg">${lastMsg ? escHtml((lastMsg.senderName ? lastMsg.senderName + ': ' : '') + (lastMsg.text || '')) : '<span style="color:#536471">Sem mensagens ainda</span>'}</div>
      </div>
      <div class="room-meta">
        ${lastMsg ? `<div class="room-time">${formatTime(lastMsg.timestamp)}</div>` : ''}
        ${badge > 0 ? `<div class="room-badge">${badge}</div>` : ''}
      </div>`;
    item.onclick = () => openRoom(room.id);
    roomsList.appendChild(item);
  });
}

function renderUsersList() {
  const query = searchInput.value.toLowerCase();
  usersList.innerHTML = '';
  onlineUsers.filter(u => u.id !== me?.id && (!query || u.name.toLowerCase().includes(query))).forEach(user => {
    const item = document.createElement('div');
    item.className = 'user-item';
    item.innerHTML = `
      <div class="user-avatar" style="background:${user.color}">${user.name.charAt(0).toUpperCase()}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(user.name)}</div>
        <div class="user-status-text">
          <span class="user-status-dot ${user.status}"></span>${statusLabel(user.status)}
        </div>
      </div>
      <button class="btn-dm">Mensagem</button>`;
    item.querySelector('.btn-dm').onclick = (e) => { e.stopPropagation(); socket.emit('start_dm', { targetUserId: user.id }); switchToChatsTab(); };
    usersList.appendChild(item);
  });
  if (!usersList.children.length) {
    usersList.innerHTML = '<div style="text-align:center;color:#8696A0;padding:24px;font-size:14px">Nenhum usuário online</div>';
  }
}

function switchToChatsTab() {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="chats"]').classList.add('active');
  document.getElementById('tab-chats').classList.add('active');
}

function updateRoomSubtitles() {
  if (currentRoomId && rooms[currentRoomId]) renderChatHeader(rooms[currentRoomId]);
  renderRoomsList();
}

function openRoom(roomId) {
  currentRoomId = roomId;
  unread[roomId] = 0;
  const room = rooms[roomId];
  if (!room) return;

  emptyState.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  replyTo = null;
  replyPreview.classList.add('hidden');
  typingIndicator.classList.add('hidden');

  renderChatHeader(room);
  renderMessages(room.messages || []);
  scrollToBottom(false);
  renderRoomsList();

  if (window.innerWidth <= 700) sidebar.classList.add('hidden-mobile');
  messageInput.focus();
}

function renderChatHeader(room) {
  const av = getRoomAvatar(room);
  chatAvatar.style.background = av.color;
  chatAvatar.textContent = av.text;
  chatName.textContent = getRoomDisplayName(room);
  if (room.type === 'group' || room.id === 'general') {
    const count = room.members?.length || 0;
    chatSubtitle.textContent = `${count} participante${count !== 1 ? 's' : ''}`;
  } else {
    const other = onlineUsers.find(u => room.members?.includes(u.id) && u.id !== me?.id);
    chatSubtitle.textContent = other ? statusLabel(other.status) : 'Offline';
  }
}

function renderMessages(msgs) {
  messagesList.innerHTML = '';
  let lastDate = null;
  msgs.forEach(msg => {
    const dateStr = formatDate(msg.timestamp);
    if (dateStr !== lastDate) { appendDateSeparator(dateStr); lastDate = dateStr; }
    if (msg.type === 'system') appendSystemMessage(msg.text);
    else appendMessage(msg);
  });
}

function appendMessage(msg) {
  const isOut = msg.senderId === me?.id;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isOut ? 'out' : 'in'}`;

  const replyHtml = msg.replyTo ? (() => {
    const orig = findMessageById(msg.replyTo);
    return orig ? `<div class="msg-reply"><div class="reply-name">${escHtml(orig.senderName)}</div><div class="reply-body">${escHtml(orig.text)}</div></div>` : '';
  })() : '';

  const senderHtml = !isOut && rooms[currentRoomId]?.type !== 'dm'
    ? `<div class="msg-sender" style="color:${msg.senderColor}">${escHtml(msg.senderName)}</div>` : '';

  const reactions = msg.reactions || {};
  const reactionHtml = Object.keys(reactions).length ? `<div class="msg-reactions">${
    Object.entries(reactions).map(([e, users]) =>
      `<span class="reaction-pill" onclick="react('${msg.id}','${e}')" title="${users.join(', ')}">${e} ${users.length}</span>`
    ).join('')
  }</div>` : '';

  wrapper.innerHTML = `
    <div class="msg-bubble" data-msg-id="${msg.id}">
      ${replyHtml}${senderHtml}
      <div class="msg-text">${escHtml(msg.text)}</div>
      ${reactionHtml}
      <div class="msg-footer">
        <div class="msg-time">${formatTime(msg.timestamp)}</div>
        ${isOut ? '<div class="msg-tick">✓✓</div>' : ''}
      </div>
      <div class="msg-actions">
        <button class="msg-action-btn" onclick="setReply('${msg.id}')" title="Responder">↩</button>
        <button class="msg-action-btn" onclick="showEmojiReact('${msg.id}')" title="Reagir">😊</button>
      </div>
    </div>`;

  messagesList.appendChild(wrapper);
}

function appendSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-message';
  el.innerHTML = `<span>${escHtml(text)}</span>`;
  messagesList.appendChild(el);
}

function appendDateSeparator(dateStr) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.innerHTML = `<span>${dateStr}</span>`;
  messagesList.appendChild(el);
}

function updateRoomLastMsg(roomId, msg) {
  if (!rooms[roomId]) return;
  if (!rooms[roomId].messages) rooms[roomId].messages = [];
  rooms[roomId].messages.push(msg);
  renderRoomsList();
}

function scrollToBottom(smooth = true) {
  setTimeout(() => {
    messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }, 50);
}

// Enviar mensagem
function sendMessage() {
  const text = messageInput.textContent.trim();
  if (!text || !currentRoomId) return;
  socket.emit('send_message', { roomId: currentRoomId, text, replyTo: replyTo?.id || null });
  messageInput.textContent = '';
  replyTo = null;
  replyPreview.classList.add('hidden');
  socket.emit('typing', { roomId: currentRoomId, isTyping: false });
}

sendBtn.onclick = sendMessage;
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

let typingTimer;
messageInput.addEventListener('input', () => {
  if (!currentRoomId) return;
  socket.emit('typing', { roomId: currentRoomId, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', { roomId: currentRoomId, isTyping: false }), 2000);
});

// Reply
window.setReply = function(msgId) {
  const msg = findMessageById(msgId);
  if (!msg) return;
  replyTo = msg;
  replySender.textContent = msg.senderName;
  replyText.textContent = msg.text;
  replyPreview.classList.remove('hidden');
  messageInput.focus();
};

document.getElementById('cancel-reply').onclick = () => {
  replyTo = null;
  replyPreview.classList.add('hidden');
};

// Emoji react
const quickEmojis = ['👍','❤️','😂','😮','😢','🙏'];
window.showEmojiReact = function(msgId) {
  const existing = document.getElementById('quick-react-' + msgId);
  if (existing) { existing.remove(); return; }
  const el = document.createElement('div');
  el.id = 'quick-react-' + msgId;
  el.style.cssText = 'position:fixed;background:#1F2C34;border:1px solid #2A3942;border-radius:24px;padding:8px 12px;display:flex;gap:8px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  const bubble = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (bubble) {
    const rect = bubble.getBoundingClientRect();
    el.style.top = (rect.top - 60) + 'px';
    el.style.left = rect.left + 'px';
  }
  quickEmojis.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.style.cssText = 'font-size:22px;cursor:pointer;padding:2px;border-radius:4px;transition:transform 0.1s';
    span.onmouseenter = () => span.style.transform = 'scale(1.3)';
    span.onmouseleave = () => span.style.transform = '';
    span.onclick = () => { react(msgId, emoji); el.remove(); };
    el.appendChild(span);
  });
  document.body.appendChild(el);
  setTimeout(() => document.addEventListener('click', () => el.remove(), { once: true }), 50);
};

window.react = function(msgId, emoji) {
  if (!currentRoomId) return;
  socket.emit('react', { roomId: currentRoomId, messageId: msgId, emoji });
};

// Emoji picker
EMOJIS.forEach(e => {
  const span = document.createElement('span');
  span.textContent = e;
  span.onclick = () => { insertAtCursor(e); emojiPicker.classList.add('hidden'); };
  emojiPicker.appendChild(span);
});
emojiBtn.onclick = (e) => { e.stopPropagation(); emojiPicker.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add('hidden'); });

function insertAtCursor(text) {
  messageInput.focus();
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    messageInput.textContent += text;
  }
}

// Grupo modal
document.getElementById('btn-new-group').onclick = () => {
  const modal = document.getElementById('modal-group');
  modal.classList.remove('hidden');
  renderModalUsers();
};
document.getElementById('close-modal').onclick = closeModal;
document.getElementById('cancel-group').onclick = closeModal;
document.getElementById('modal-overlay').onclick = closeModal;

function closeModal() { document.getElementById('modal-group').classList.add('hidden'); }

function renderModalUsers() {
  const container = document.getElementById('modal-users');
  container.innerHTML = '';
  onlineUsers.filter(u => u.id !== me?.id).forEach(user => {
    const item = document.createElement('label');
    item.className = 'modal-user-item';
    item.innerHTML = `
      <input type="checkbox" value="${user.id}">
      <div class="modal-user-avatar" style="background:${user.color}">${user.name.charAt(0).toUpperCase()}</div>
      <span>${escHtml(user.name)}</span>`;
    container.appendChild(item);
  });
  if (!container.children.length) container.innerHTML = '<div style="color:#8696A0;text-align:center;padding:16px">Nenhum usuário disponível</div>';
}

document.getElementById('create-group').onclick = () => {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { showToast('Digite o nome do grupo'); return; }
  const members = Array.from(document.querySelectorAll('#modal-users input:checked')).map(c => c.value);
  socket.emit('create_group', { name, members });
  closeModal();
  document.getElementById('group-name').value = '';
  switchToChatsTab();
};

// Status
statusSelect.onchange = () => socket.emit('set_status', { status: statusSelect.value });

// Search
searchInput.addEventListener('input', () => { renderRoomsList(); renderUsersList(); });

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  };
});

// Back (mobile)
backBtn.onclick = () => {
  sidebar.classList.remove('hidden-mobile');
  chatPanel.classList.add('hidden');
  emptyState.classList.remove('hidden');
  currentRoomId = null;
};

// Toast
function showToast(msg, roomId) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.style.cursor = roomId ? 'pointer' : 'default';
  if (roomId) el.onclick = () => { openRoom(roomId); el.remove(); };
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 4000);
}

// Helpers
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR');
}

function statusLabel(s) {
  return { online: '🟢 Online', away: '🟡 Ausente', busy: '🔴 Ocupado' }[s] || '⚫ Offline';
}

function findMessageById(id) {
  if (!currentRoomId || !rooms[currentRoomId]) return null;
  return rooms[currentRoomId].messages?.find(m => m.id === id) || null;
}
