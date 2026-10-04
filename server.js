const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const PUBLIC = __dirname;
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data, except) {
  for (const p of room.players) if (p.ws !== except) send(p.ws, data);
}
function roomInfo(room) {
  return { type: 'players', room: room.code, count: room.players.length };
}
function cleanCode(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); } catch { res.writeHead(400); return res.end('Bad request'); }
  let file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  if (file.includes('..')) { res.writeHead(403); return res.end('Forbidden'); }
  const full = path.join(PUBLIC, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full);
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 12 * 1024 * 1024 });

wss.on('connection', ws => {
  const player = { ws, room: null, id: Math.random().toString(36).slice(2, 10) };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type:'error', message:'Некорректное сообщение' }); }

    if (msg.type === 'join') {
      const code = cleanCode(msg.room);
      if (!code) return send(ws, { type:'error', message:'Неверный код комнаты' });
      let room = rooms.get(code);
      if (!room) { room = { code, players: [], state: null }; rooms.set(code, room); }
      if (player.room) return;
      player.room = room;
      room.players.push(player);
      send(ws, { type:'joined', room:code, id:player.id, players:room.players.length });
      broadcast(room, roomInfo(room), ws);
      if (room.state) send(ws, { type:'state', state:room.state.state, duration:room.state.duration });
      else if (room.players.length > 1) send(room.players[0].ws, { type:'request_state' });
      return;
    }

    if (!player.room) return send(ws, { type:'error', message:'Сначала войдите в комнату' });

    if (msg.type === 'state') {
      if (!msg.state || !msg.state.ukraine || !msg.state.russia) return;
      player.room.state = { state: msg.state, duration: Number(msg.duration) || 3 };
      broadcast(player.room, { type:'state', state:msg.state, duration:player.room.state.duration }, ws);
      return;
    }
  });

  ws.on('close', () => {
    const room = player.room;
    if (!room) return;
    room.players = room.players.filter(p => p !== player);
    if (!room.players.length) rooms.delete(room.code);
    else broadcast(room, roomInfo(room));
  });
});

server.listen(PORT, () => console.log(`GeoFront multiplayer server listening on http://localhost:${PORT}`));
