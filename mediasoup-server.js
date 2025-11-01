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
    // Проверяем доступность mediasoup worker
    const mediasoupPath = require.resolve('mediasoup');
    console.log('📦 Mediasoup путь:', mediasoupPath);
    
    // Создаем worker с обработкой ошибок
    try {
      worker = await mediasoup.createWorker({
        ...MEDIASOUP_OPTIONS.worker,
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      });
      console.log('✅ Mediasoup worker создан:', worker.pid);
    } catch (workerError) {
      console.error('❌ Ошибка создания worker:', workerError);
      
      // Если worker не может быть создан (например, на Render.com), используем fallback
      if (process.env.RENDER || process.env.NODE_ENV === 'production') {
        console.warn('⚠️ Mediasoup worker недоступен. Используем fallback режим.');
        // В fallback режиме можно использовать mesh топологию или другой подход
        return null;
      }
      throw workerError;
    }

    // Обработка ошибок worker
    worker.on('died', () => {
      console.error('❌ Mediasoup worker умер, перезапускаем...');
      setTimeout(() => {
        initMediasoup().catch(err => {
          console.error('❌ Не удалось перезапустить worker:', err);
        });
      }, 1000);
    });

    // Создаем router
    router = await worker.createRouter(MEDIASOUP_OPTIONS.router);
    console.log('✅ Mediasoup router создан:', router.id);

    return { worker, router };
  } catch (error) {
    console.error('❌ Ошибка инициализации Mediasoup:', error);
    console.error('Детали ошибки:', error.message, error.stack);
    
    // На Render.com Mediasoup может быть недоступен из-за нативной сборки
    if (process.env.RENDER) {
      console.warn('⚠️ Mediasoup недоступен на Render.com. Рекомендуется использовать отдельный VPS для медиа-сервера.');
    }
    
    throw error;
  }
}

/**
 * Создает WebRTC транспорт для игрока
 */
async function createTransport(playerId, direction = 'send') {
  // Убеждаемся что Mediasoup инициализирован
  await ensureMediasoupInitialized();
  
  if (!router || !mediasoupAvailable) {
    throw new Error('Router не инициализирован. Mediasoup недоступен на этой платформе.');
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
  // Убеждаемся что Mediasoup инициализирован
  const initResult = await ensureMediasoupInitialized();
  
  if (!initResult || !mediasoupAvailable) {
    throw new Error('Mediasoup недоступен на этой платформе');
  }
  
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
async function getRouterRtpCapabilities() {
  const initResult = await ensureMediasoupInitialized();
  
  if (!initResult || !router || !mediasoupAvailable) {
    throw new Error('Router не инициализирован. Mediasoup недоступен на этой платформе.');
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

// Инициализируем при загрузке модуля (не блокируем запуск сервера)
let initPromise = null;
let mediasoupAvailable = false;

async function ensureMediasoupInitialized() {
  if (initPromise === null) {
    initPromise = (async () => {
      try {
        const result = await initMediasoup();
        if (result) {
          mediasoupAvailable = true;
          console.log('✅ Mediasoup успешно инициализирован');
          return result;
        } else {
          mediasoupAvailable = false;
          console.warn('⚠️ Mediasoup недоступен, используется fallback');
          return null;
        }
      } catch (err) {
        console.error('❌ Ошибка инициализации Mediasoup:', err.message);
        mediasoupAvailable = false;
        console.warn('⚠️ Сервер продолжит работу без Mediasoup SFU. Будет использована mesh топология.');
        return null;
      }
    })();
  }
  return initPromise;
}

// Пытаемся инициализировать асинхронно, не блокируя запуск сервера
setTimeout(() => {
  ensureMediasoupInitialized().catch(() => {
    // Ошибка уже обработана в ensureMediasoupInitialized
  });
}, 100);

module.exports = {
  connectPlayer,
  connectTransport,
  createProducer,
  createConsumer,
  getProducers,
  getRouterRtpCapabilities,
  disconnectPlayer,
  router,
  isAvailable: () => mediasoupAvailable,
};

