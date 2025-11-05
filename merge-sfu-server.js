// Скрипт для объединения websocket.js и mediasoup функциональности
// Запустите: node merge-sfu-server.js
// Это создаст полный mediasoup-server.js с всей логикой игры

const fs = require('fs');

// Читаем оба файла
const websocketCode = fs.readFileSync('./websocket.js', 'utf8');
const mediasoupCode = fs.readFileSync('./mediasoup-server.js', 'utf8');

// Извлекаем функции игры из websocket.js (от generatePlayerCharacteristics до checkAllReady)
const gameFunctionsStart = websocketCode.indexOf('function generatePlayerCharacteristics');
const gameFunctionsEnd = websocketCode.indexOf('wss.on("connection"');

const gameFunctions = websocketCode.substring(gameFunctionsStart, gameFunctionsEnd);

// Извлекаем обработчики сообщений из websocket.js (все case в switch)
const handlersStart = websocketCode.indexOf('switch (data.type) {');
const handlersEnd = websocketCode.indexOf('default:', handlersStart + 100);
const handlersCode = websocketCode.substring(handlersStart, handlersEnd);

// Создаем полный файл
const fullCode = `// SFU сервер на базе Mediasoup - ПОЛНАЯ ВЕРСИЯ
// Включает всю логику игры + Mediasoup SFU

const mediasoup = require('mediasoup');
const WebSocket = require('ws');
const propertiesData = require("./properties.json");

// Mediasoup workers и routers
const workers = [];
const routers = new Map();
const rooms = new Map();

// Инициализация mediasoup workers
async function createWorkers() {
  const numWorkers = 1;
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: 40000,
      rtcMaxPort: 49999
    });
    
    worker.on('died', () => {
      console.error('❌ Mediasoup worker died, exiting...');
      process.exit(1);
    });
    
    workers.push(worker);
    console.log(\`✅ Mediasoup worker \${i + 1} создан\`);
  }
}

async function getOrCreateRouter(roomId = 'default') {
  if (routers.has(roomId)) {
    return routers.get(roomId);
  }
  
  const worker = workers[0];
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      }
    ]
  });
  
  routers.set(roomId, router);
  rooms.set(roomId, {
    producers: new Map(),
    consumers: new Map(),
    transports: new Map()
  });
  
  console.log(\`✅ Router создан для комнаты \${roomId}\`);
  return router;
}

const wss = new WebSocket.Server({ 
  port: 5000,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024,
  clientTracking: true
}, () => console.log("✅ SFU сервер запущен на порту 5000"));

const MAX_PLAYERS = 8;
let allPlayers = [];
let host = null;
let adminPanel = null;
let gameState = { 
  started: false, 
  startTime: null, 
  ready: false,
  currentRound: 0,
  totalRounds: 5
};
let bannedPlayers = new Set();
let highlightedPlayerId = null;
let disconnectedPlayers = new Map();
let usedCards = {};
let votingState = {
  phase: null,
  candidates: new Set(),
  votes: new Map(),
  voteCounts: {}
};
let votingHistory = [];

const clientMediasoup = new Map();

let lastPlayersUpdateData = null;
let lastPlayersUpdateString = null;
let playersUpdateTimeout = null;
const PLAYERS_UPDATE_THROTTLE = 100;

const DEBUG = process.env.NODE_ENV !== 'production';
const log = DEBUG ? console.log : () => {};
const logError = console.error;

// ============================
// ВСЕ ФУНКЦИИ ИГРЫ ИЗ WEBSOCKET.JS
// ============================
${gameFunctions}

// ============================
// ОБРАБОТКА ПОДКЛЮЧЕНИЙ
// ============================
wss.on("connection", async (ws) => {
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  ws.name = null;
  ws.role = "player";
  ws.ready = false;

  log("🔌 Новое подключение:", ws.id);

  ws.send(JSON.stringify({
    type: "welcome",
    yourId: ws.id,
    message: "Подключение установлено"
  }));

  sendPlayersUpdate(true);

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      const requestId = data.requestId;

      const sendResponse = (response) => {
        if (requestId) {
          ws.send(JSON.stringify({ ...response, requestId }));
        } else {
          ws.send(JSON.stringify(response));
        }
      };

      switch (data.type) {
        // MEDIASOUP ОБРАБОТЧИКИ
        case "getRouterRtpCapabilities": {
          const router = await getOrCreateRouter(data.roomId || 'default');
          sendResponse({
            type: "routerRtpCapabilities",
            rtpCapabilities: router.rtpCapabilities
          });
          break;
        }

        case "createTransport": {
          const { roomId = 'default', direction } = data;
          const router = await getOrCreateRouter(roomId);
          
          const transport = await router.createWebRtcTransport({
            listenIps: [
              { ip: '0.0.0.0', announcedIp: '87.228.76.59' }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 1000000
          });

          if (!clientMediasoup.has(ws.id)) {
            clientMediasoup.set(ws.id, { router, transports: new Map(), producer: null, consumers: new Map() });
          }
          
          const clientData = clientMediasoup.get(ws.id);
          clientData.transports.set(direction, transport);

          transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
              transport.close();
            }
          });

          sendResponse({
            type: "transportCreated",
            direction,
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
          });
          break;
        }

        case "connectTransport": {
          const { direction, dtlsParameters } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has(direction)) {
            sendResponse({ type: "error", message: "Transport не найден" });
            return;
          }

          const transport = clientData.transports.get(direction);
          await transport.connect({ dtlsParameters });
          
          sendResponse({ type: "transportConnected", direction });
          break;
        }

        case "createProducer": {
          const { roomId = 'default', kind, rtpParameters } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has('send')) {
            sendResponse({ type: "error", message: "Send transport не найден" });
            return;
          }

          const transport = clientData.transports.get('send');
          const producer = await transport.produce({ kind, rtpParameters });
          
          clientData.producer = producer;
          
          const room = rooms.get(roomId);
          if (room) {
            room.producers.set(ws.id, producer);
          }

          const allConnections = [...allPlayers, host].filter(p => p && p.id !== ws.id);
          allConnections.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: "newProducer",
                producerId: producer.id,
                playerId: ws.id,
                kind: kind
              }));
            }
          });

          sendResponse({ type: "producerCreated", id: producer.id });
          break;
        }

        case "createConsumer": {
          const { roomId = 'default', producerId, rtpCapabilities } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has('recv')) {
            sendResponse({ type: "error", message: "Recv transport не найден" });
            return;
          }

          const router = clientData.router;
          const transport = clientData.transports.get('recv');
          
          if (!router.canConsume({ producerId, rtpCapabilities })) {
            sendResponse({ type: "error", message: "Несовместимые capabilities" });
            return;
          }

          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: false
          });

          clientData.consumers.set(producerId, consumer);
          
          const room = rooms.get(roomId);
          if (room) {
            room.consumers.set(consumer.id, consumer);
          }

          sendResponse({
            type: "consumerCreated",
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
          });
          break;
        }

        case "getExistingProducers": {
          const room = rooms.get(data.roomId || 'default');
          const producers = [];
          
          if (room) {
            room.producers.forEach((producer, playerId) => {
              if (playerId !== ws.id) {
                producers.push({
                  producerId: producer.id,
                  playerId: playerId
                });
              }
            });
          }
          
          sendResponse({ type: "existingProducers", producers });
          break;
        }

        case "resumeConsumer": {
          const clientData = clientMediasoup.get(ws.id);
          if (!clientData) {
            sendResponse({ type: "error", message: "Клиент не найден" });
            return;
          }
          
          let targetConsumer = null;
          for (const consumer of clientData.consumers.values()) {
            if (consumer.id === data.consumerId) {
              targetConsumer = consumer;
              break;
            }
          }
          
          if (targetConsumer) {
            await targetConsumer.resume();
            sendResponse({ type: "consumerResumed", consumerId: data.consumerId });
          } else {
            sendResponse({ type: "error", message: "Consumer не найден" });
          }
          break;
        }

        // ВСЕ ОБРАБОТЧИКИ ИГРЫ ИЗ WEBSOCKET.JS
        // Скопируйте сюда все case из websocket.js:
        // join_admin_panel, join, set_ready, get_lobby_state, 
        // chat_message, get_player_cards, reveal_characteristic,
        // execute_action_card, toggle_ban_player, kick_player,
        // set_mirror_camera, game_ready, set_total_rounds,
        // change_round, start_voting_selection, set_voting_candidates,
        // confirm_voting_candidates, cancel_voting, vote_to_kick,
        // toggle_player_highlight, reset_game
        
        default:
          ws.send(JSON.stringify({ type: "error", message: "Неизвестная команда" }));
      }
    } catch (error) {
      logError("❌ Ошибка обработки сообщения:", error);
      ws.send(JSON.stringify({ type: "error", message: "Ошибка сервера" }));
    }
  });

  ws.on("close", () => {
    log(\`❌ Отключился: \${ws.name || 'Unknown'} (\${ws.role})\`);
    
    const clientData = clientMediasoup.get(ws.id);
    if (clientData) {
      if (clientData.producer) {
        clientData.producer.close();
      }
      clientData.consumers.forEach(consumer => consumer.close());
      clientData.transports.forEach(transport => transport.close());
      clientMediasoup.delete(ws.id);
    }
    
    if (ws.name && gameState.started && ws.role !== "admin_panel") {
      disconnectedPlayers.set(ws.name.toLowerCase(), {
        characteristics: ws.characteristics ? JSON.parse(JSON.stringify(ws.characteristics)) : null,
        ready: ws.ready || false,
        role: ws.role || "player",
        id: ws.id,
        mirrorCamera: ws.mirrorCamera || false,
        disconnectedAt: Date.now()
      });
    }
    
    if (ws.role === "player") {
      allPlayers = allPlayers.filter((p) => p !== ws);
    } else if (ws.role === "host") {
      host = null;
      broadcast({ 
        type: "host_left",
        message: "Ведущий вышел из игры"
      });
    } else if (ws.role === "admin_panel") {
      adminPanel = null;
    }

    if (ws.role !== "admin_panel") {
      broadcast({
        type: "player_left",
        playerId: ws.id,
        playerName: ws.name
      });
      sendPlayersUpdate();
    }
  });

  ws.on("error", (error) => {
    logError(\`💥 Ошибка: \${ws.name || ws.id}\`, error);
  });
});

createWorkers().then(() => {
  console.log("🚀 Mediasoup SFU готов!");
});

console.log("🚀 Сервер 'Бункер' готов для 8 игроков!");
`;

fs.writeFileSync('./mediasoup-server-full.js', fullCode);
console.log('✅ Создан mediasoup-server-full.js');
console.log('⚠️ ВАЖНО: Скопируйте все case обработчики из websocket.js в switch statement');

