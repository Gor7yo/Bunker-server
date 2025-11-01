// Mediasoup SFU сервер для Bunker Game
const mediasoup = require('mediasoup');

let worker = null;
let router = null;
const transports = new Map(); // playerId -> {sendTransport, recvTransport}
const producers = new Map(); // playerId -> producer
const consumers = new Map(); // playerId -> Map<producerId, consumer>

// Mediasoup configuration
const MEDIASOUP_OPTIONS = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },
};

/**
 * Инициализация Mediasoup worker и router
 */
async function initMediasoup() {
  try {
    // Создаем worker
    worker = await mediasoup.createWorker(MEDIASOUP_OPTIONS.worker);
    console.log('✅ Mediasoup worker создан:', worker.pid);

    // Обработка ошибок worker
    worker.on('died', () => {
      console.error('❌ Mediasoup worker умер, перезапускаем...');
      initMediasoup();
    });

    // Создаем router
    router = await worker.createRouter(MEDIASOUP_OPTIONS.router);
    console.log('✅ Mediasoup router создан:', router.id);

    return { worker, router };
  } catch (error) {
    console.error('❌ Ошибка инициализации Mediasoup:', error);
    throw error;
  }
}

/**
 * Создает WebRTC транспорт для игрока
 */
async function createTransport(playerId, direction = 'send') {
  if (!router) {
    throw new Error('Router не инициализирован');
  }

  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
  });

  // Обработка события DTLS
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      console.log(`🔌 DTLS закрыт для ${playerId} (${direction})`);
      transport.close();
    }
  });

  // Сохраняем транспорт
  if (!transports.has(playerId)) {
    transports.set(playerId, {});
  }
  const playerTransports = transports.get(playerId);
  
  if (direction === 'send') {
    playerTransports.sendTransport = transport;
  } else {
    playerTransports.recvTransport = transport;
  }

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

/**
 * Подключает игрока к медиа-серверу
 */
async function connectPlayer(playerId) {
  try {
    // Создаем send transport для отправки видео
    const sendTransportInfo = await createTransport(playerId, 'send');
    
    // Создаем recv transport для получения видео от других
    const recvTransportInfo = await createTransport(playerId, 'recv');

    console.log(`✅ Транспорты созданы для игрока ${playerId}`);

    return {
      sendTransport: sendTransportInfo,
      recvTransport: recvTransportInfo,
    };
  } catch (error) {
    console.error(`❌ Ошибка подключения игрока ${playerId}:`, error);
    throw error;
  }
}

/**
 * Обработка WebRTC connect (клиент подключил транспорт)
 */
async function connectTransport(playerId, transportId, dtlsParameters, direction) {
  const playerTransports = transports.get(playerId);
  if (!playerTransports) {
    throw new Error(`Транспорты для игрока ${playerId} не найдены`);
  }

  const transport = direction === 'send' 
    ? playerTransports.sendTransport 
    : playerTransports.recvTransport;

  if (!transport) {
    throw new Error(`Транспорт ${direction} для игрока ${playerId} не найден`);
  }

  await transport.connect({ dtlsParameters });
  console.log(`✅ Транспорт ${direction} подключен для игрока ${playerId}`);
}

/**
 * Создает producer (отправка видео от игрока)
 */
async function createProducer(playerId, transportId, rtpParameters) {
  const playerTransports = transports.get(playerId);
  if (!playerTransports || !playerTransports.sendTransport) {
    throw new Error(`Send transport для игрока ${playerId} не найден`);
  }

  const producer = await playerTransports.sendTransport.produce({ rtpParameters });
  producers.set(playerId, producer);

  console.log(`✅ Producer создан для игрока ${playerId}:`, producer.id);

  return {
    id: producer.id,
    kind: producer.kind,
    rtpParameters: producer.rtpParameters,
  };
}

/**
 * Создает consumer (получение видео от другого игрока)
 */
async function createConsumer(playerId, producerId, rtpCapabilities) {
  const playerTransports = transports.get(playerId);
  if (!playerTransports || !playerTransports.recvTransport) {
    throw new Error(`Recv transport для игрока ${playerId} не найден`);
  }

  // Находим producer
  let producer = null;
  for (const [pid, p] of producers.entries()) {
    if (p.id === producerId) {
      producer = p;
      break;
    }
  }

  if (!producer) {
    throw new Error(`Producer ${producerId} не найден`);
  }

  // Проверяем может ли router воспроизвести этот кодек
  if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
    throw new Error('Router не может создать consumer для этого producer');
  }

  const consumer = await playerTransports.recvTransport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: false,
  });

  // Сохраняем consumer
  if (!consumers.has(playerId)) {
    consumers.set(playerId, new Map());
  }
  consumers.get(playerId).set(producerId, consumer);

  console.log(`✅ Consumer создан для игрока ${playerId} от producer ${producerId}`);

  return {
    id: consumer.id,
    producerId: consumer.producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

/**
 * Получает список всех producers (других игроков)
 */
function getProducers(playerId) {
  const producerList = [];
  
  for (const [pid, producer] of producers.entries()) {
    if (pid !== playerId && producer && !producer.closed) {
      producerList.push({
        id: producer.id,
        playerId: pid,
        kind: producer.kind,
      });
    }
  }

  return producerList;
}

/**
 * Получает RTP capabilities router
 */
function getRouterRtpCapabilities() {
  if (!router) {
    throw new Error('Router не инициализирован');
  }
  return router.rtpCapabilities;
}

/**
 * Отключает игрока от медиа-сервера
 */
async function disconnectPlayer(playerId) {
  try {
    // Закрываем transports
    const playerTransports = transports.get(playerId);
    if (playerTransports) {
      if (playerTransports.sendTransport) {
        playerTransports.sendTransport.close();
      }
      if (playerTransports.recvTransport) {
        playerTransports.recvTransport.close();
      }
      transports.delete(playerId);
    }

    // Закрываем producer
    const producer = producers.get(playerId);
    if (producer) {
      producer.close();
      producers.delete(playerId);
    }

    // Закрываем consumers
    const playerConsumers = consumers.get(playerId);
    if (playerConsumers) {
      playerConsumers.forEach(consumer => consumer.close());
      consumers.delete(playerId);
    }

    console.log(`✅ Игрок ${playerId} отключен от Mediasoup`);
  } catch (error) {
    console.error(`❌ Ошибка отключения игрока ${playerId}:`, error);
  }
}

// Инициализируем при загрузке модуля
initMediasoup().catch(err => {
  console.error('❌ Критическая ошибка инициализации Mediasoup:', err);
  process.exit(1);
});

module.exports = {
  connectPlayer,
  connectTransport,
  createProducer,
  createConsumer,
  getProducers,
  getRouterRtpCapabilities,
  disconnectPlayer,
  router,
};

