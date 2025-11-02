// mediasoup-server.js - Сервер Mediasoup для управления медиа трафиком
let mediasoup;
let mediasoupAvailable = false;

try {
  mediasoup = require('mediasoup');
  mediasoupAvailable = true;
  console.log('✅ Mediasoup модуль загружен');
} catch (error) {
  console.warn('⚠️ Mediasoup модуль недоступен:', error.message);
  mediasoupAvailable = false;
}

const config = require('./mediasoup-config');

// Глобальное хранилище медиа-серверов и роутеров
let workers = [];
let nextWorkerIndex = 0;

// Глобальный роутер для лобби (SFU - Single Forwarding Unit)
let lobbyRouter = null;

// Хранилище producers для отслеживания
const producersMap = new Map(); // producerId -> producer

/**
 * Инициализация Mediasoup воркеров
 */
async function initializeWorkers() {
  console.log('🔧 Инициализируем Mediasoup воркеры...');
  
  if (!mediasoupAvailable) {
    throw new Error('Mediasoup модуль недоступен');
  }
  
  for (let i = 0; i < config.numWorkers; i++) {
    try {
      const worker = await mediasoup.createWorker({
        logLevel: config.worker.logLevel,
        logTags: config.worker.logTags,
        rtcMinPort: config.worker.rtcMinPort,
        rtcMaxPort: config.worker.rtcMaxPort,
        dtlsCertificateFile: undefined, // Mediasoup сам сгенерирует
        dtlsPrivateKeyFile: undefined
      });

      worker.on('died', () => {
        console.error(`❌ Mediasoup воркер ${i} умер, перезапускаем...`);
        // Автоматический перезапуск воркера
        setTimeout(() => initializeWorkers(), 2000);
      });

      workers.push(worker);
      console.log(`✅ Mediasoup воркер ${i} создан (pid: ${worker.pid})`);
    } catch (error) {
      console.error(`❌ Не удалось создать Mediasoup воркер ${i}:`, error.message);
      throw error; // Пробрасываем дальше
    }
  }

  console.log(`✅ Создано ${workers.length} Mediasoup воркеров`);
  
  // Создаем главный роутер для лобби
  await createLobbyRouter();
}

/**
 * Создание главного роутера для лобби
 */
async function createLobbyRouter() {
  const worker = getNextWorker();
  
  lobbyRouter = await worker.createRouter({
    mediaCodecs: config.router.mediaCodecs
  });

  console.log('✅ Роутер лобби создан');
  console.log('📊 Кодекы:', lobbyRouter.rtpCapabilities);
}

/**
 * Получить следующий доступный воркер (load balancing)
 */
function getNextWorker() {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

/**
 * Создание WebRTC транспорт для клиента
 */
async function createWebRtcTransport(socketId) {
  if (!lobbyRouter) {
    throw new Error('Роутер лобби не создан');
  }

  const transport = await lobbyRouter.createWebRtcTransport({
    listenIps: config.webrtcTransport.listenIps,
    initialAvailableOutgoingBitrate: config.webrtcTransport.initialAvailableOutgoingBitrate,
    minimumAvailableOutgoingBitrate: config.webrtcTransport.minimumAvailableOutgoingBitrate,
    enableSctp: config.webrtcTransport.enableSctp,
    enableUdp: config.webrtcTransport.enableUdp,
    enableTcp: config.webrtcTransport.enableTcp,
    preferUdp: config.webrtcTransport.preferUdp,
    appData: { socketId }
  });

  console.log(`✅ Создан WebRTC транспорт для клиента ${socketId}:`, {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });

  return transport;
}

/**
 * Создание производителя (producer) - клиент отправляет медиа
 */
async function createProducer(transport, kind, rtpParameters) {
  if (!lobbyRouter) {
    throw new Error('Роутер лобби не создан');
  }

  const producer = await transport.produce({
    kind,
    rtpParameters
  });

  // Сохраняем producer в глобальное хранилище
  producersMap.set(producer.id, producer);

  console.log(`✅ Создан producer ${kind} для транспорта ${transport.id}:`, {
    id: producer.id,
    kind: producer.kind,
    rtpParameters: producer.rtpParameters
  });

  return producer;
}

/**
 * Создание потребителя (consumer) - клиент получает медиа
 */
async function createConsumer(transport, producerId, rtpCapabilities) {
  if (!lobbyRouter) {
    throw new Error('Роутер лобби не создан');
  }

  // Проверяем возможности клиента
  if (!lobbyRouter.canConsume({ producerId, rtpCapabilities })) {
    console.warn(`⚠️ Клиент не может потребить producer ${producerId}`);
    throw new Error('Клиент не может потребить producer');
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities
  });

  console.log(`✅ Создан consumer для producer ${producerId}:`, {
    id: consumer.id,
    producerId: consumer.producerId,
    kind: consumer.kind
  });

  return consumer;
}

/**
 * Получить RTCP возможности роутера
 */
function getRouterRtpCapabilities() {
  if (!lobbyRouter) {
    throw new Error('Роутер лобби не создан');
  }
  return lobbyRouter.rtpCapabilities;
}

/**
 * Получить всех активных производителей
 */
function getAllProducers() {
  return Array.from(producersMap.values());
}

/**
 * Закрыть транспорт и все связанные ресурсы
 */
async function closeTransport(transport) {
  if (!transport) return;
  
  try {
    transport.close();
    console.log(`✅ Транспорт ${transport.id} закрыт`);
  } catch (error) {
    console.error('❌ Ошибка закрытия транспорта:', error);
  }
}

/**
 * Закрыть producer
 */
async function closeProducer(producer) {
  if (!producer) return;
  
  try {
    producer.close();
    // Удаляем из хранилища
    producersMap.delete(producer.id);
    console.log(`✅ Producer ${producer.id} закрыт`);
  } catch (error) {
    console.error('❌ Ошибка закрытия producer:', error);
  }
}

/**
 * Закрыть consumer
 */
async function closeConsumer(consumer) {
  if (!consumer) return;
  
  try {
    consumer.close();
    console.log(`✅ Consumer ${consumer.id} закрыт`);
  } catch (error) {
    console.error('❌ Ошибка закрытия consumer:', error);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('🛑 Останавливаем Mediasoup...');
  
  // Закрываем все воркеры
  for (const worker of workers) {
    worker.close();
  }
  
  workers = [];
  lobbyRouter = null;
  
  console.log('✅ Mediasoup остановлен');
}

// Обработка сигналов для graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  initializeWorkers,
  createWebRtcTransport,
  createProducer,
  createConsumer,
  getRouterRtpCapabilities,
  getAllProducers,
  closeTransport,
  closeProducer,
  closeConsumer,
  shutdown
};

