// chat-server.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.CHAT_PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- temp storage file ---
const CHAT_FILE = path.join(__dirname, 'data/chat.json');
if (!fs.existsSync(path.dirname(CHAT_FILE))) fs.mkdirSync(path.dirname(CHAT_FILE), { recursive: true });
if (!fs.existsSync(CHAT_FILE)) fs.writeFileSync(CHAT_FILE, '[]', 'utf8');

function loadMessages() {
  try { return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8') || '[]'); }
  catch { return []; }
}
function saveMessages(msgs) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(msgs, null, 2));
}
function addMessage(msg) {
  const msgs = loadMessages();
  msgs.push(msg);
  saveMessages(msgs);
}

// --- auth handshake ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) { return next(new Error('Invalid token')); }
});

// --- connection ---
io.on('connection', (socket) => {
  const user = socket.user;
  if (!user) return socket.disconnect();

  const room = `user:${user.id}`;
  socket.join(room);
  console.log(`🔵 ${user.id} connected`);

  // handle send message
  socket.on('message', (payload) => {
    if (!payload?.to || !payload?.content) return;
    const msg = {
      id: uuidv4(),
      from: user.id,
      to: payload.to,
      content: payload.content,
      ts: new Date().toISOString()
    };
    addMessage(msg);

    // emit to recipient
    io.to(`user:${payload.to}`).emit('message', msg);
    // ack back
    socket.emit('message:sent', { tempId: payload.tempId, serverId: msg.id, ts: msg.ts });
    console.log(`💬 ${msg.from} -> ${msg.to}: ${msg.content}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 ${user.id} disconnected`);
  });
});

// cleanup old messages (24h retention)
setInterval(() => {
  let msgs = loadMessages();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const before = msgs.length;
  msgs = msgs.filter(m => new Date(m.ts).getTime() > cutoff);
  if (msgs.length !== before) {
    console.log(`🧹 removed ${before - msgs.length} expired messages`);
    saveMessages(msgs);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`🚀 Chat server listening on ${PORT}`);
});

