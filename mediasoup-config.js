// Конфигурация Mediasoup SFU сервера
module.exports = {
  // Количество воркеров (1 обычно достаточно для большинства случаев)
  numWorkers: 1,
  
  // Настройки воркера
  worker: {
    rtcMinPort: 30000,
    rtcMaxPort: 31000,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ]
  },
  
  // Настройки роутера (кодекы)
  router: {
    mediaCodecs: [
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
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000
      },
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      }
    ]
  },
  
  // Настройки WebRTC транспорта
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null }
    ],
    maxIncomingBitrate: 1500000, // 1.5 Mbps
    initialAvailableOutgoingBitrate: 1000000, // 1 Mbps
    minimumAvailableOutgoingBitrate: 600000, // 600 Kbps
    maxSctpMessageSize: 262144,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  }
};

