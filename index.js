import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors'
import {router as AuthRouter} from './routes/routes-auth.js'
import { log } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Хранилище комнат и пользователей
const rooms = new Map();

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'], // URL фронтенда
  credentials: true // Важно! Разрешает передачу cookie
}));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.use('/api/auth', AuthRouter)

// Health check endpoint
// app.get('/health', (req, res) => {
//   res.json({ 
//     status: 'ok', 
//     timestamp: new Date().toISOString(),
//     activeRooms: rooms.size 
//   });
// });

// Получить информацию о комнате
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const users = Array.from(room.users.values())
    .filter(user => user.username)
    .map(user => ({
      userId: user.userId,
      username: user.username,
      polite: user.polite
    }));

  res.json({ 
    roomId, 
    users,
    userCount: users.length
  });
});

// Создать новую комнату
app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8); // Короткий ID комнаты
  
  rooms.set(roomId, {
    id: roomId,
    users: new Map(),
  });

  
  res.json({ 
    roomId, 
    message: 'Room created successfully' 
  });
});

console.log("asdp[aksd");


// WebSocket обработчик
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('roomId');
  const userId = url.searchParams.get('userId');
  const username = url.searchParams.get('username');
  // const userId = url.searchParams.get('userId');

  
  if (!roomId || !userId) {
    ws.close(1008, 'RoomId and UserId are required');
    return;
  }

  console.log(`🔌 New WebSocket connection: User ${userId} in room ${roomId}`);

  // Получаем или создаем комнату
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      users: new Map(),
      createdAt: new Date().toISOString(),
      createdBy: 'unknown'
    };
    rooms.set(roomId, room);
  }

  // Сохраняем WebSocket соединение пользователя
  room.users.set(userId, {
    ws,
    userId,
    username: username,
    polite: null,
    joinedAt: new Date().toISOString()
  });

  // Обработка входящих сообщений
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 Message from ${userId} in room ${roomId}: ${data.type}`);

      const room = rooms.get(roomId);
      if (!room) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Room not found' }
        }));
        return;
      }

      switch (data.type) {
        case 'join':
          handleJoin(ws, room, userId, data.payload);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          handleSignalingMessage(room, userId, data);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Failed to process message' }
      }));
    }
  });

  // Обработка закрытия соединения
  ws.on('close', () => {
    console.log(`❌ User ${userId} disconnected from room ${roomId}`);
    handleUserDisconnect(roomId, userId);
  });

  // Обработка ошибок
  ws.on('error', (error) => {
    console.error(`WebSocket error for user ${userId}:`, error);
  });
});

// Обработка join сообщения
const handleJoin = (ws, room, userId, payload) => {
  const { username } = payload;
  
  // Обновляем информацию о пользователе
  const user = room.users.get(userId);

  let otherUsers = []

  if (user) {
    user.username = username;
    // Первый пользователь в комнате - вежливый (polite=true)
    // Остальные - невежливые (polite=false)
    otherUsers = Array.from(room.users.values())
      .filter(u => u.userId !== userId && u.username);

    // ОЧЕНЬ ВАЖНО: ЕСЛИ ВЕЖЛИВЫХ В КОМНАТЕ НЕТ, ТО ТЫ СТАНОВИШЬСЯ ВЕЖЛИВЫМ. ВРОДЕ БЫ ЭТО РАБОТАЕТ, НО ЕСЛИ ЧТО ПОДУМАТЬ КАК ПРАВИЛЬНО РЕАЛИЗОВАТЬ 
    const politeExist = otherUsers.find((user) => user.polite)

    user.polite = politeExist ? false : true;
  }

  console.log(`👤 User ${username} (${userId}) joined room ${room.id}. Polite: ${user.polite}`);

  // Отправляем подтверждение подключившемуся пользователю
  ws.send(JSON.stringify({
    type: 'joined',
    otherUsers: otherUsers,
    payload: {
      userId,
      username,
      polite: user.polite,
      roomId: room.id
    }
  }));

  // Уведомляем других пользователей в комнате
  broadcastToRoom(room, userId, {
    type: 'user-joined',
    payload: {
      userId,
      username,
      polite: user.polite
    }
  });

  // Отправляем новому пользователю список уже подключенных пользователей
//   const existingUsers = Array.from(room.users.values())
//     .filter(u => u.userId !== userId && u.username)
//     .map(u => ({
//       userId: u.userId,
//       username: u.username,
//       polite: u.polite
//     }));

//   if (existingUsers.length > 0) {
//     ws.send(JSON.stringify({
//       type: 'existing-users',
//       payload: existingUsers
//     }));
//   }
};

// Обработка сигнальных сообщений (offer, answer, ice-candidate)
const handleSignalingMessage = (room, senderId, data) => {
  const { type, payload } = data;
  
    // console.log('room -= ', room );
    // console.log('sender id -= ', senderId );
    // console.log('data -= ', data );
    

  broadcastToRoom(room, senderId, {
    type,
    payload: {
      ...payload,
      from: senderId
    }
  });
};

// Обработка отключения пользователя
const handleUserDisconnect = (roomId, userId) => {
  const room = rooms.get(roomId);
  if (!room) return;

  // Удаляем пользователя из комнаты
  const user = room.users.get(userId);
  room.users.delete(userId);

  // Уведомляем остальных пользователей
  if (user && user.username) {
    broadcastToRoom(room, userId, {
      type: 'user-left',
      payload: {
        userId,
        username: user.username
      }
    });
  }

  // Удаляем комнату, если в ней никого нет
  if (room.users.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty)`);
  }
};

// Рассылка сообщения всем пользователям в комнате кроме отправителя
const broadcastToRoom = (room, excludeUserId, message) => {
  const messageStr = JSON.stringify(message);
  
  room.users.forEach((user, userId) => {
    if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(messageStr);
    }
  });
};

// Очистка неактивных комнат (каждые 30 минут)
// setInterval(() => {
//   const now = Date.now();
//   const thirtyMinutes = 30 * 60 * 1000;
  
//   rooms.forEach((room, roomId) => {
//     // Проверяем, есть ли активные пользователи
//     const hasActiveUsers = Array.from(room.users.values())
//       .some(user => user.ws.readyState === WebSocket.OPEN);
    
//     if (!hasActiveUsers) {
//       rooms.delete(roomId);
//       console.log(`Room ${roomId} deleted (inactive)`);
//     }
//   });
// }, 30 * 60 * 1000);

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`
🚀 Server is running!
📡 Port: ${PORT}
🔌 WebSocket: ws://localhost:${PORT}
🌐 HTTP: http://localhost:${PORT}
  `);
});