const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(express.json());

// Compatibilidade com ngrok (bypass do aviso de browser)
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Estado em memória
const users = new Map();       // socketId -> { id, name, avatar, color, status }
const rooms = new Map();       // roomId -> { id, name, type, members, messages, createdAt }
const userRooms = new Map();   // socketId -> Set<roomId>

// Sala geral padrão
const GENERAL_ROOM = {
  id: 'general',
  name: 'Geral',
  type: 'group',
  icon: '🌍',
  members: new Set(),
  messages: [],
  createdAt: Date.now()
};
rooms.set('general', GENERAL_ROOM);

const AVATAR_COLORS = [
  '#25D366', '#128C7E', '#075E54', '#34B7F1', '#00BCD4',
  '#9C27B0', '#E91E63', '#FF5722', '#FF9800', '#607D8B'
];

function getOnlineUsers() {
  return Array.from(users.values()).map(u => ({
    id: u.id, name: u.name, color: u.color, status: u.status
  }));
}

function getRoomData(roomId, requesterId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    id: room.id,
    name: room.type === 'dm' ? getDMName(room, requesterId) : room.name,
    type: room.type,
    icon: room.icon || null,
    members: Array.from(room.members),
    messages: room.messages.slice(-100),
    createdAt: room.createdAt
  };
}

function getDMName(room, requesterId) {
  const otherId = Array.from(room.members).find(id => {
    const user = Array.from(users.values()).find(u => u.id === id);
    return user && user.socketId !== requesterId;
  });
  if (!otherId) return 'Conversa';
  const other = Array.from(users.values()).find(u => u.id === otherId);
  return other ? other.name : 'Usuário';
}

io.on('connection', (socket) => {
  console.log('Nova conexão:', socket.id);

  // Registro de usuário
  socket.on('register', ({ name }) => {
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const user = {
      id: uuidv4(),
      socketId: socket.id,
      name: name.trim().slice(0, 30),
      color,
      status: 'online',
      joinedAt: Date.now()
    };
    users.set(socket.id, user);
    userRooms.set(socket.id, new Set(['general']));

    // Entrar na sala geral
    socket.join('general');
    GENERAL_ROOM.members.add(user.id);

    // Confirmar registro
    socket.emit('registered', {
      user: { id: user.id, name: user.name, color: user.color },
      rooms: [getRoomData('general', socket.id)]
    });

    // Notificar sala geral
    const joinMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${user.name} entrou no chat`,
      timestamp: Date.now()
    };
    GENERAL_ROOM.messages.push(joinMsg);
    io.to('general').emit('system_message', { roomId: 'general', message: joinMsg });

    // Atualizar lista de usuários online
    io.emit('users_online', getOnlineUsers());
    console.log(`Usuário registrado: ${user.name}`);
  });

  // Enviar mensagem
  socket.on('send_message', ({ roomId, text, replyTo }) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    if (!user || !room) return;

    const myRooms = userRooms.get(socket.id);
    if (!myRooms || !myRooms.has(roomId)) return;

    const msg = {
      id: uuidv4(),
      type: 'text',
      senderId: user.id,
      senderName: user.name,
      senderColor: user.color,
      text: text.trim().slice(0, 2000),
      timestamp: Date.now(),
      replyTo: replyTo || null,
      reactions: {}
    };

    room.messages.push(msg);
    if (room.messages.length > 500) room.messages.shift();

    io.to(roomId).emit('new_message', { roomId, message: msg });
  });

  // Criar grupo
  socket.on('create_group', ({ name, members }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const roomId = uuidv4();
    const group = {
      id: roomId,
      name: name.trim().slice(0, 50),
      type: 'group',
      icon: '👥',
      members: new Set([user.id, ...members]),
      messages: [],
      createdAt: Date.now()
    };
    rooms.set(roomId, group);

    // Adicionar criador ao grupo
    socket.join(roomId);
    const myRooms = userRooms.get(socket.id);
    if (myRooms) myRooms.add(roomId);

    // Adicionar outros membros
    for (const [sid, u] of users.entries()) {
      if (members.includes(u.id)) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.join(roomId);
          const sRooms = userRooms.get(sid);
          if (sRooms) sRooms.add(roomId);
          s.emit('room_added', getRoomData(roomId, sid));
        }
      }
    }

    const sysMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${user.name} criou o grupo "${group.name}"`,
      timestamp: Date.now()
    };
    group.messages.push(sysMsg);
    io.to(roomId).emit('system_message', { roomId, message: sysMsg });

    socket.emit('room_added', getRoomData(roomId, socket.id));
  });

  // Iniciar DM
  socket.on('start_dm', ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const targetSocket = Array.from(users.entries())
      .find(([, u]) => u.id === targetUserId);
    if (!targetSocket) return;

    const [targetSid, targetUser] = targetSocket;

    // Verificar se DM já existe
    const existingRoom = Array.from(rooms.values()).find(r =>
      r.type === 'dm' &&
      r.members.has(user.id) &&
      r.members.has(targetUser.id)
    );

    if (existingRoom) {
      socket.emit('room_added', getRoomData(existingRoom.id, socket.id));
      return;
    }

    const roomId = uuidv4();
    const dm = {
      id: roomId,
      name: `DM`,
      type: 'dm',
      members: new Set([user.id, targetUser.id]),
      messages: [],
      createdAt: Date.now()
    };
    rooms.set(roomId, dm);

    socket.join(roomId);
    const myRooms = userRooms.get(socket.id);
    if (myRooms) myRooms.add(roomId);

    const targetS = io.sockets.sockets.get(targetSid);
    if (targetS) {
      targetS.join(roomId);
      const tRooms = userRooms.get(targetSid);
      if (tRooms) tRooms.add(roomId);
      targetS.emit('room_added', getRoomData(roomId, targetSid));
    }

    socket.emit('room_added', getRoomData(roomId, socket.id));
  });

  // Reação a mensagem
  socket.on('react', ({ roomId, messageId, emoji }) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    if (!user || !room) return;

    const msg = room.messages.find(m => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions[emoji]) msg.reactions[emoji] = new Set();

    if (msg.reactions[emoji].has(user.id)) {
      msg.reactions[emoji].delete(user.id);
      if (msg.reactions[emoji].size === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].add(user.id);
    }

    const reactionsOut = {};
    for (const [e, set] of Object.entries(msg.reactions)) {
      reactionsOut[e] = Array.from(set);
    }

    io.to(roomId).emit('reaction_update', { roomId, messageId, reactions: reactionsOut });
  });

  // Typing indicator
  socket.on('typing', ({ roomId, isTyping }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('user_typing', {
      roomId,
      userId: user.id,
      name: user.name,
      isTyping
    });
  });

  // Status do usuário
  socket.on('set_status', ({ status }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const valid = ['online', 'away', 'busy'];
    if (!valid.includes(status)) return;
    user.status = status;
    io.emit('users_online', getOnlineUsers());
  });

  // Desconexão
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      GENERAL_ROOM.members.delete(user.id);
      const leaveMsg = {
        id: uuidv4(),
        type: 'system',
        text: `${user.name} saiu do chat`,
        timestamp: Date.now()
      };
      GENERAL_ROOM.messages.push(leaveMsg);
      io.to('general').emit('system_message', { roomId: 'general', message: leaveMsg });

      users.delete(socket.id);
      userRooms.delete(socket.id);
      io.emit('users_online', getOnlineUsers());
      console.log(`Usuário desconectado: ${user.name}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🟢 Servidor rodando em http://localhost:${PORT}`);
});
