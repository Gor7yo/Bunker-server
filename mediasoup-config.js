// mediasoup-config.js - Конфигурация Mediasoup для видеоконференции
const os = require('os');

// Получаем локальный IP адрес
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Конфигурация медиа-сервера
const mediasoupConfig = {
  // Число ядер для обработки медиа
  numWorkers: 2,
  
  // Настройки для каждого воркера
  worker: {
    rtcMinPort: 30000,
    rtcMaxPort: 31000,
    logLevel: 'info', // или 'debug' для отладки
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ]
  },

  // Router (комната) настройки
  router: {
    mediaCodecs: [
      // Видео кодек H264
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1
        }
      },
      // Видео кодек VP8 (лучше для WebRTC)
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      // Видео кодек VP9 (еще лучше качество)
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      // Аудио кодек Opus (стандарт для WebRTC)
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      }
    ]
  },

  // Настройки WebRTC транспорт
  webrtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0', // Слушаем на всех интерфейсах
        announcedIp: getLocalIP() // Объявляем внешний IP (важно для NAT)
      }
    ],
    initialAvailableOutgoingBitrate: 1000000, // 1 Mbps на клиента
    minimumAvailableOutgoingBitrate: 600000, // Минимум 600 kbps
    maxSctpMessageSize: 262144,
    enableSctp: false, // Отключаем SCTP если не нужен
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  },

  // Настройки производительности для 8 игроков
  performance: {
    // Битрейт для каждого клиента
    maxIncomingBitrate: 800000, // 800 kbps входящий
    maxOutgoingBitrate: 1000000, // 1 Mbps исходящий
    
    // Simulcast настройки (несколько качеств видео)
    simulcast: {
      enabled: true,
      layers: {
        low: { maxBitrate: 150000 },     // 150 kbps - низкое
        medium: { maxBitrate: 400000 },  // 400 kbps - среднее
        high: { maxBitrate: 800000 }     // 800 kbps - высокое
      }
    }
  }
};

module.exports = mediasoupConfig;

