// mediasoup-server.js
// Упрощенный медиа-сервер на базе Mediasoup для развертывания на Selectel

const mediasoup = require('mediasoup');
const os = require('os');

class MediasoupHandler {
  constructor(options = {}) {
    this.worker = null;
    this.router = null;
    this.producers = new Map(); // playerId -> {audio: producer, video: producer}
    this.consumers = new Map(); // playerId -> Map<remotePlayerId, {audio: consumer, video: consumer}>
    this.transports = new Map(); // playerId -> {send: transport, recv: transport}
    this.isReady = false;
    this.announcedIp = options.announcedIp || process.env.MEDIASOUP_ANNOUNCED_IP;
    
    this.init();
  }

  async init() {
    try {
      console.log('🔧 Инициализация Mediasoup Worker...');

      // Создаем медиа-воркер
      this.worker = await mediasoup.createWorker({
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'rtcp', 'srtp'],
        rtcMinPort: 40000,
        rtcMaxPort: 49999,
        dtlsCertificateFile: undefined,
        dtlsPrivateKeyFile: undefined
      });

      this.worker.on('died', () => {
        console.error('❌ Mediasoup worker умер, перезапускаем через 2 секунды...');
        setTimeout(() => this.init(), 2000);
      });

      // Создаем роутер (маршрутизатор медиа-потоков)
      const mediaCodecs = [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: {
            minptime: 10,
            useinbandfec: true
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'level-asymmetry-allowed': 1,
            'packetization-mode': 1,
            'profile-level-id': '42001f'
          }
        }
      ];

      this.router = await this.worker.createRouter({ mediaCodecs });
      
      console.log('✅ Mediasoup Worker и Router созданы');
      console.log(`📡 Router ID: ${this.router.id}`);
      this.isReady = true;

    } catch (error) {
      console.error('❌ Ошибка инициализации Mediasoup:', error);
      this.isReady = false;
      throw error;
    }
  }

  // Создание транспорта для игрока (WebRTC транспорт)
  async createTransport(playerId, direction = 'both') {
    if (!this.isReady || !this.router) {
      throw new Error('Mediasoup не готов');
    }

    const listenIps = [{
      ip: '0.0.0.0',
      announcedIp: this.announcedIp || undefined
    }];

    const config = {
      listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    };

    if (direction === 'send' || direction === 'both') {
      const sendTransport = await this.router.createWebRtcTransport(config);
      
      if (!this.transports.has(playerId)) {
        this.transports.set(playerId, { send: sendTransport, recv: null });
      } else {
        this.transports.get(playerId).send = sendTransport;
      }

      console.log(`✅ Send transport создан для ${playerId}, id: ${sendTransport.id}`);
      
      return {
        id: sendTransport.id,
        iceParameters: sendTransport.iceParameters,
        iceCandidates: sendTransport.iceCandidates,
        dtlsParameters: sendTransport.dtlsParameters
      };
    }

    if (direction === 'recv' || direction === 'both') {
      const recvTransport = await this.router.createWebRtcTransport(config);
      
      if (!this.transports.has(playerId)) {
        this.transports.set(playerId, { send: null, recv: recvTransport });
      } else {
        this.transports.get(playerId).recv = recvTransport;
      }

      console.log(`✅ Recv transport создан для ${playerId}, id: ${recvTransport.id}`);
      
      return {
        id: recvTransport.id,
        iceParameters: recvTransport.iceParameters,
        iceCandidates: recvTransport.iceCandidates,
        dtlsParameters: recvTransport.dtlsParameters
      };
    }
  }

  // Подключение транспорта (после получения DTLS параметров от клиента)
  async connectTransport(playerId, transportId, dtlsParameters, direction = 'send') {
    const playerTransport = this.transports.get(playerId);
    if (!playerTransport) {
      throw new Error('Транспорт не найден');
    }

    const transport = direction === 'send' ? playerTransport.send : playerTransport.recv;
    if (!transport || transport.id !== transportId) {
      throw new Error(`Транспорт ${direction} не найден`);
    }

    await transport.connect({ dtlsParameters });
    console.log(`✅ Transport ${direction} подключен для ${playerId}`);
  }

  // Создание Producer (отправка потока от клиента)
  async createProducer(playerId, transportId, kind, rtpParameters) {
    if (!this.isReady || !this.router) {
      throw new Error('Mediasoup не готов');
    }

    const playerTransport = this.transports.get(playerId);
    if (!playerTransport || !playerTransport.send || playerTransport.send.id !== transportId) {
      throw new Error('Send transport не найден');
    }

    const producer = await playerTransport.send.produce({
      kind,
      rtpParameters
    });

    if (!this.producers.has(playerId)) {
      this.producers.set(playerId, {});
    }
    this.producers.get(playerId)[kind] = producer;

    console.log(`✅ Producer создан для ${playerId}, kind: ${kind}, id: ${producer.id}`);

    return {
      id: producer.id,
      kind: producer.kind
    };
  }

  // Создание Consumer (получение потока от другого игрока)
  async createConsumer(playerId, remotePlayerId, kind) {
    if (!this.isReady || !this.router) {
      throw new Error('Mediasoup не готов');
    }

    // Находим producer от другого игрока
    const remoteProducers = this.producers.get(remotePlayerId);
    if (!remoteProducers || !remoteProducers[kind]) {
      throw new Error(`Producer ${kind} не найден для ${remotePlayerId}`);
    }

    const producer = remoteProducers[kind];

    // Создаем или используем существующий recv транспорт
    let playerTransport = this.transports.get(playerId);
    if (!playerTransport || !playerTransport.recv) {
      const recvData = await this.createTransport(playerId, 'recv');
      playerTransport = this.transports.get(playerId);
    }

    const consumer = await playerTransport.recv.consume({
      producerId: producer.id,
      rtpCapabilities: playerTransport.recv.rtpCapabilities
    });

    // Сохраняем consumer
    if (!this.consumers.has(playerId)) {
      this.consumers.set(playerId, new Map());
    }
    if (!this.consumers.get(playerId).has(remotePlayerId)) {
      this.consumers.get(playerId).set(remotePlayerId, {});
    }
    this.consumers.get(playerId).get(remotePlayerId)[kind] = consumer;

    console.log(`✅ Consumer создан для ${playerId} от ${remotePlayerId}, kind: ${kind}`);

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    };
  }

  // Получение RTP capabilities роутера
  getRtpCapabilities() {
    if (!this.isReady || !this.router) {
      return null;
    }
    return this.router.rtpCapabilities;
  }

  // Получение всех активных producers (для подключения новых игроков)
  getActiveProducers() {
    const producers = [];
    for (const [playerId, playerProducers] of this.producers.entries()) {
      for (const [kind, producer] of Object.entries(playerProducers)) {
        if (producer && !producer.closed) {
          producers.push({
            playerId,
            kind,
            producerId: producer.id
          });
        }
      }
    }
    return producers;
  }

  // Удаление игрока
  async removePlayer(playerId) {
    try {
      console.log(`🗑️ Удаление игрока ${playerId} из Mediasoup...`);

      // Закрываем transports
      const transport = this.transports.get(playerId);
      if (transport) {
        if (transport.send) {
          await transport.send.close();
        }
        if (transport.recv) {
          await transport.recv.close();
        }
        this.transports.delete(playerId);
      }

      // Удаляем producers
      const producers = this.producers.get(playerId);
      if (producers) {
        for (const producer of Object.values(producers)) {
          if (producer && !producer.closed) {
            producer.close();
          }
        }
        this.producers.delete(playerId);
      }

      // Удаляем consumers
      const playerConsumers = this.consumers.get(playerId);
      if (playerConsumers) {
        for (const consumers of playerConsumers.values()) {
          for (const consumer of Object.values(consumers)) {
            if (consumer && !consumer.closed) {
              consumer.close();
            }
          }
        }
        this.consumers.delete(playerId);
      }

      console.log(`✅ Игрок ${playerId} удален из Mediasoup`);
    } catch (error) {
      console.error(`❌ Ошибка удаления игрока ${playerId}:`, error);
    }
  }

  // Получение статистики
  getStats() {
    return {
      isReady: this.isReady,
      activePlayers: this.transports.size,
      totalProducers: Array.from(this.producers.values()).reduce((sum, p) => sum + Object.keys(p).length, 0),
      totalConsumers: Array.from(this.consumers.values()).reduce((sum, map) => sum + map.size, 0)
    };
  }
}

module.exports = MediasoupHandler;

