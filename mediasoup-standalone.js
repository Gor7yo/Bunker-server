// mediasoup-standalone.js
// Отдельный сервер Mediasoup для запуска на Selectel
// Запускается отдельно от websocket.js на Render.com

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const MediasoupHandler = require('./mediasoup-server');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/mediasoup' });

const PORT = process.env.PORT || 8888;
const MEDIASOUP_HANDLER = new MediasoupHandler({
  announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = MEDIASOUP_HANDLER.getStats();
  res.json({
    status: 'ok',
    mediasoup: stats,
    timestamp: Date.now()
  });
});

// WebSocket подключения
wss.on('connection', (ws, req) => {
  console.log('🔌 Новое WebSocket подключение к Mediasoup');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'get_rtp_capabilities': {
          const rtpCapabilities = MEDIASOUP_HANDLER.getRtpCapabilities();
          ws.send(JSON.stringify({
            type: 'rtp_capabilities',
            rtpCapabilities
          }));
          break;
        }

        case 'create_transport': {
          const transport = await MEDIASOUP_HANDLER.createTransport(
            data.playerId,
            data.direction || 'both'
          );
          ws.send(JSON.stringify({
            type: 'transport_created',
            transport,
            direction: data.direction || 'both'
          }));
          break;
        }

        case 'connect_transport': {
          await MEDIASOUP_HANDLER.connectTransport(
            data.playerId,
            data.transportId,
            data.dtlsParameters,
            data.direction
          );
          ws.send(JSON.stringify({
            type: 'transport_connected',
            transportId: data.transportId
          }));
          break;
        }

        case 'create_producer': {
          const producer = await MEDIASOUP_HANDLER.createProducer(
            data.playerId,
            data.transportId,
            data.kind,
            data.rtpParameters
          );
          ws.send(JSON.stringify({
            type: 'producer_created',
            producer
          }));
          
          // Уведомляем о новом producer
          broadcastToAll(ws, {
            type: 'new_producer',
            playerId: data.playerId,
            producerId: producer.id,
            kind: producer.kind
          });
          break;
        }

        case 'create_consumer': {
          const consumer = await MEDIASOUP_HANDLER.createConsumer(
            data.playerId,
            data.remotePlayerId,
            data.kind
          );
          ws.send(JSON.stringify({
            type: 'consumer_created',
            consumer
          }));
          break;
        }

        case 'get_active_producers': {
          const producers = MEDIASOUP_HANDLER.getActiveProducers();
          ws.send(JSON.stringify({
            type: 'active_producers',
            producers
          }));
          break;
        }

        case 'ice_candidate': {
          // Обработка ICE кандидатов от клиента
          // В Mediasoup это обрабатывается автоматически через transport
          break;
        }

        case 'remove_player': {
          await MEDIASOUP_HANDLER.removePlayer(data.playerId);
          ws.send(JSON.stringify({
            type: 'player_removed',
            playerId: data.playerId
          }));
          break;
        }

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${data.type}`
          }));
      }
    } catch (error) {
      console.error('❌ Ошибка обработки сообщения:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket соединение закрыто');
  });

  ws.on('error', (error) => {
    console.error('💥 Ошибка WebSocket:', error);
  });

  // Отправляем RTP capabilities при подключении
  const rtpCapabilities = MEDIASOUP_HANDLER.getRtpCapabilities();
  if (rtpCapabilities) {
    ws.send(JSON.stringify({
      type: 'rtp_capabilities',
      rtpCapabilities
    }));
  }
});

// Функция для broadcast всем клиентам кроме отправителя
function broadcastToAll(excludeWs, message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Mediasoup Standalone Server запущен на порту ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${PORT}/mediasoup`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
  
  if (MEDIASOUP_HANDLER.announcedIp) {
    console.log(`🌐 Announced IP: ${MEDIASOUP_HANDLER.announcedIp}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM, завершаем работу...');
  server.close(() => {
    console.log('✅ Сервер закрыт');
    process.exit(0);
  });
});

