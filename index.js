// backend/server.js
import express from 'express';
import http from 'http';
import { ExpressPeerServer } from 'peer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import {router as AuthRouter} from './routes/routes-auth.js'

const app = express();
const server = http.createServer(app);

// Настройка CORS
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

app.use(express.json());

// Хранилище комнат и пользователей
const rooms = new Map(); // roomId -> { participants: Set(peerIds) }
const userNames = new Map(); // peerId -> username

// PeerJS сервер
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  allow_discovery: true,
  proxied: true,
});
app.use('/api/auth', AuthRouter);

app.use('/peerjs', peerServer);

// API для создания комнаты
app.post('/api/room/create', (req, res) => {
  try {
    const roomId = uuidv4().substring(0, 8);
    
    rooms.set(roomId, {
      id: roomId,
      participants: new Set(),
      createdAt: new Date().toISOString()
    });

    console.log(`✅ Комната создана: ${roomId}`);
    
    res.json({ 
      roomId, 
      message: 'Room created successfully' 
    });
  } catch (error) {
    console.error('❌ Ошибка создания комнаты:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// API для получения информации о комнате
app.get('/api/room/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ 
      roomId, 
      participants: Array.from(room.participants),
      participantCount: room.participants.size
    });
  } catch (error) {
    console.error('❌ Ошибка получения комнаты:', error);
    res.status(500).json({ error: 'Failed to get room info' });
  }
});

// API для присоединения к комнате
app.post('/api/room/:roomId/join', (req, res) => {
  try {
    const { roomId } = req.params;
    const { peerId, username } = req.body;
    
    console.log(`👤 Присоединяется: ${username} (${peerId}) к комнате ${roomId}`);
    
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Добавляем участника
    room.participants.add(peerId);
    // Сохраняем имя пользователя
    userNames.set(peerId, username);
    
    console.log(`✅ Участников в комнате: ${room.participants.size}`);
    console.log('👥 Участники:', Array.from(room.participants));
    
    res.json({ 
      success: true,
      participants: Array.from(room.participants)
    });
  } catch (error) {
    console.error('❌ Ошибка присоединения:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// API для получения имени пользователя по peerId
app.get('/api/room/:roomId/user/:peerId', (req, res) => {
  try {
    const { peerId } = req.params;
    const username = userNames.get(peerId) || 'Unknown';
    
    console.log(`📝 Запрошено имя для ${peerId}: ${username}`);
    
    res.json({ username });
  } catch (error) {
    console.error('❌ Ошибка получения имени:', error);
    res.status(500).json({ error: 'Failed to get username' });
  }
});

// API для выхода из комнаты
app.post('/api/room/:roomId/leave', (req, res) => {
  try {
    const { roomId } = req.params;
    const { peerId } = req.body;
    
    console.log(`👋 Выходит: ${peerId} из комнаты ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(peerId);
      userNames.delete(peerId);
      
      console.log(`✅ Осталось участников: ${room.participants.size}`);
      
      // Удаляем комнату если пуста
      if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Комната ${roomId} удалена (пуста)`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка выхода:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// API для проверки статуса
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size,
    users: userNames.size,
    timestamp: new Date().toISOString()
  });
});

// API для отладки - показать все комнаты
app.get('/api/debug/rooms', (req, res) => {
  const roomsInfo = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    participants: Array.from(room.participants).map(peerId => ({
      peerId,
      username: userNames.get(peerId) || 'Unknown'
    })),
    count: room.participants.size
  }));
  
  res.json({
    rooms: roomsInfo,
    totalRooms: rooms.size,
    totalUsers: userNames.size
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║     🚀 СЕРВЕР ЗАПУЩЕН!             ║
╠════════════════════════════════════╣
║ 📡 Порт: ${PORT}                         ║
║ 🔌 PeerJS: http://localhost:${PORT}/peerjs ║
║ 🌐 API: http://localhost:${PORT}/api      ║
╚════════════════════════════════════╝
  `);
});