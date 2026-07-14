/* Socket.io client wrapper */
const ChatSocket = (() => {
  let socket = null;
  const handlers = new Map();

  function connect(token) {
    socket = io({
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => { _emit('connected'); });
    socket.on('disconnect', (reason) => _emit('disconnected', { reason }));
    socket.on('connect_error', (err) => _emit('connect_error', { error: err.message }));

    socket.on('message:new', data => _emit('message:new', data));
    socket.on('message:read', data => _emit('message:read', data));
    socket.on('message:delivered', data => _emit('message:delivered', data));
    socket.on('typing:start', data => _emit('typing:start', data));
    socket.on('typing:stop', data => _emit('typing:stop', data));
    socket.on('user:online', data => _emit('user:online', data));
    socket.on('user:offline', data => _emit('user:offline', data));
    socket.on('user:online_list', data => _emit('user:online_list', data));
    socket.on('conversation:updated', data => _emit('conversation:updated', data));

    return socket;
  }

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  }

  function off(event, fn) {
    if (handlers.has(event)) {
      handlers.set(event, handlers.get(event).filter(h => h !== fn));
    }
  }

  function _emit(event, data) {
    const list = handlers.get(event);
    if (list) list.forEach(h => { try { h(data); } catch(e) { console.error('Socket handler error:', e); } });
  }

  function sendMessage(conversation_id, content, reply_to = null) {
    if (socket?.connected) {
      socket.emit('message:send', { conversation_id, content, reply_to });
    }
  }

  function sendTypingStart(conversation_id) {
    socket?.emit('typing:start', { conversation_id });
  }

  function sendTypingStop(conversation_id) {
    socket?.emit('typing:stop', { conversation_id });
  }

  function markRead(conversation_id) {
    socket?.emit('message:read', { conversation_id });
  }

  function getOnlineUsers() {
    socket?.emit('user:get_online');
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
  }

  function isConnected() {
    return socket?.connected || false;
  }

  return {
    connect, on, off,
    sendMessage, sendTypingStart, sendTypingStop,
    markRead, getOnlineUsers, disconnect, isConnected
  };
})();

window.ChatSocket = ChatSocket;
