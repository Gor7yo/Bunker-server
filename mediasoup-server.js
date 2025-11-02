// Mediasoup SFU сервер
const mediasoup = require('mediasoup');
const config = require('./mediasoup-config');

// Глобальное хранилище
let workers = [];
let nextWorkerIndex = 0;
let lobbyRouter = null;
const producersMap = new Map(); // producerId -> producer

/**
 * Инициализация Mediasoup воркеров
 */
async function initializeWorkers() {
  console.log('🔧 Инициализируем Mediasoup воркеры...');
  
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.worker.logLevel,
      logTags: config.worker.logTags,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
      dtlsCertificateFile: undefined,
      dtlsPrivateKeyFile: undefined
    });

    worker.on('died', () => {
      console.error(`❌ Mediasoup воркер ${i} умер, перезапускаем...`);
      setTimeout(() => initializeWorkers(), 2000);
    });

    workers.push(worker);
    console.log(`✅ Mediasoup воркер ${i} создан (pid: ${worker.pid})`);
  }

  console.log(`✅ Создано ${workers.length} Mediasoup воркеров`);
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
  console.log('📊 Кодекы:', JSON.stringify(lobbyRouter.rtpCapabilities, null, 2));
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
 * Создание WebRTC транспорта для клиента
 */
async function createWebRtcTransport(socketId) {
  if (!lobbyRouter) {
    throw new Error('Роутер не инициализирован');
  }

  const worker = getNextWorker();
  const transport = await worker.createWebRtcTransport({
    listenIps: config.webRtcTransport.listenIps,
    enableUdp: config.webRtcTransport.enableUdp,
    enableTcp: config.webRtcTransport.enableTcp,
    preferUdp: config.webRtcTransport.preferUdp,
    initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate
  });

  transport.on('dtlsstatechange', (dtlsState) => {
    console.log(`🔐 DTLS state для транспорта ${socketId}: ${dtlsState}`);
  });

  transport.on('sctpstatechange', (sctpState) => {
    console.log(`📡 SCTP state для транспорта ${socketId}: ${sctpState}`);
  });

  console.log(`✅ WebRTC транспорт создан для ${socketId}`);
  return transport;
}

/**
 * Создание producer (отправка медиа)
 */
async function createProducer(transport, kind, rtpParameters) {
  const producer = await transport.produce({ kind, rtpParameters });
  producersMap.set(producer.id, producer);
  
  producer.on('transportclose', () => {
    console.log(`⚠️ Producer ${producer.id} закрыт: transport закрыт`);
    producersMap.delete(producer.id);
  });
  
  console.log(`✅ Producer создан: ${producer.id} (${kind})`);
  return producer;
}

/**
 * Создание consumer (прием медиа)
 */
async function createConsumer(transport, producerId, rtpCapabilities) {
  if (!producersMap.has(producerId)) {
    throw new Error(`Producer ${producerId} не найден`);
  }
  
  const producer = producersMap.get(producerId);
  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities
  });
  
  consumer.on('transportclose', () => {
    console.log(`⚠️ Consumer ${consumer.id} закрыт: transport закрыт`);
  });
  
  console.log(`✅ Consumer создан: ${consumer.id}`);
  return consumer;
}

/**
 * Получить RTP capabilities роутера
 */
function getRouterRtpCapabilities() {
  if (!lobbyRouter) {
    throw new Error('Роутер не инициализирован');
  }
  return lobbyRouter.rtpCapabilities;
}

/**
 * Получить всех active producers
 */
function getAllProducers() {
  return Array.from(producersMap.values());
}

/**
 * Закрыть транспорт
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

module.exports = {
  initializeWorkers,
  createWebRtcTransport,
  createProducer,
  createConsumer,
  getRouterRtpCapabilities,
  getAllProducers,
  closeTransport,
  closeProducer,
  closeConsumer
};

