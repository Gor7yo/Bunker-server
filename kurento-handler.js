// kurento-handler.js
// Обработчик Kurento Media Server для централизованной маршрутизации медиа-потоков

const kurentoClient = require('kurento-client');

// Конфигурация Kurento Media Server
const KURENTO_WS_URI = process.env.KURENTO_WS_URI || 'ws://localhost:8888/kurento';

class KurentoHandler {
  constructor() {
    this.kurentoClient = null;
    this.mediaPipeline = null;
    this.endpoints = new Map(); // Map: playerId -> {endpoint, hubPort}
    this.isConnected = false;
    
    this.connect();
  }

  // Подключение к Kurento Media Server
  async connect() {
    try {
      console.log(`🔌 Подключение к Kurento Media Server: ${KURENTO_WS_URI}`);
      
      this.kurentoClient = await kurentoClient(KURENTO_WS_URI, {
        failfast: false,
        request_timeout: 20000
      });

      this.isConnected = true;
      console.log('✅ Подключено к Kurento Media Server');

      // Создаем MediaPipeline для управления медиа-потоками
      await this.createMediaPipeline();

      // Обработка отключений
      this.kurentoClient.on('disconnect', () => {
        console.warn('⚠️ Отключено от Kurento Media Server');
        this.isConnected = false;
        this.mediaPipeline = null;
        this.endpoints.clear();
        
        // Переподключение
        setTimeout(() => this.connect(), 3000);
      });

    } catch (error) {
      console.error('❌ Ошибка подключения к Kurento Media Server:', error);
      console.error('💡 Убедитесь, что Kurento Media Server запущен на', KURENTO_WS_URI);
      this.isConnected = false;
    }
  }

  // Создание MediaPipeline (медиа-конвейера)
  async createMediaPipeline() {
    try {
      if (!this.kurentoClient) {
        throw new Error('Kurento Client не подключен');
      }

      this.mediaPipeline = await this.kurentoClient.create('MediaPipeline');
      console.log('✅ MediaPipeline создан:', this.mediaPipeline.id);

      // Обработка освобождения pipeline
      this.mediaPipeline.on('Error', (error) => {
        console.error('❌ Ошибка MediaPipeline:', error);
      });

    } catch (error) {
      console.error('❌ Ошибка создания MediaPipeline:', error);
      throw error;
    }
  }

  // Добавление игрока в медиа-хаб
  async addPlayer(playerId, playerName) {
    if (!this.isConnected || !this.mediaPipeline) {
      throw new Error('Kurento не подключен или MediaPipeline не создан');
    }

    try {
      console.log(`🎮 Добавляем игрока ${playerName} (${playerId}) в медиа-хаб`);

      // Создаем WebRtcEndpoint для входящего потока от клиента
      const webRtcEndpoint = await this.mediaPipeline.create('WebRtcEndpoint');

      // Настраиваем обработчики ICE кандидатов
      webRtcEndpoint.on('IceCandidateFound', (event) => {
        const candidate = kurentoClient.getComplexType('IceCandidate')(event.candidate);
        console.log(`🧊 ICE кандидат от ${playerId}`);
        
        // Отправляем ICE кандидат клиенту (через WebSocket будет обработано отдельно)
        this.onIceCandidate(playerId, candidate);
      });

      // Обработка ошибок endpoint
      webRtcEndpoint.on('Error', (error) => {
        console.error(`❌ Ошибка WebRtcEndpoint для ${playerId}:`, error);
      });

      // Создаем HubPort для подключения к Composite (микшер)
      // Для упрощения используем Composite вместо HubPort
      // Создаем Composite для микширования всех потоков
      let composite = null;
      
      // Проверяем, есть ли уже Composite в pipeline
      // Для простоты создаем новый Composite на каждого игрока
      // В реальности лучше создать один Composite и подключать к нему всех
      
      // Пока используем простую схему: каждый endpoint отправляет свои потоки
      // и получает потоки от всех остальных через HubPort или Composite

      // Сохраняем endpoint
      this.endpoints.set(playerId, {
        endpoint: webRtcEndpoint,
        playerName: playerName,
        createdAt: Date.now()
      });

      console.log(`✅ Игрок ${playerName} добавлен в медиа-хаб`);
      
      return webRtcEndpoint;

    } catch (error) {
      console.error(`❌ Ошибка добавления игрока ${playerId}:`, error);
      throw error;
    }
  }

  // Удаление игрока из медиа-хаба
  async removePlayer(playerId) {
    try {
      const playerData = this.endpoints.get(playerId);
      if (!playerData) {
        console.log(`⚠️ Игрок ${playerId} не найден в медиа-хабе`);
        return;
      }

      console.log(`🗑️ Удаляем игрока ${playerId} из медиа-хаба`);

      // Освобождаем endpoint
      if (playerData.endpoint) {
        await playerData.endpoint.release();
      }

      // Удаляем из Map
      this.endpoints.delete(playerId);

      console.log(`✅ Игрок ${playerId} удален из медиа-хаба`);

    } catch (error) {
      console.error(`❌ Ошибка удаления игрока ${playerId}:`, error);
    }
  }

  // Получение SDP offer для клиента
  async processOffer(playerId, sdpOffer) {
    try {
      const playerData = this.endpoints.get(playerId);
      if (!playerData || !playerData.endpoint) {
        throw new Error(`Endpoint для игрока ${playerId} не найден`);
      }

      console.log(`📥 Обрабатываем SDP offer от ${playerId}`);

      const sdpAnswer = await playerData.endpoint.processOffer(sdpOffer);
      
      // Начинаем сбор ICE кандидатов
      await playerData.endpoint.gatherCandidates();

      console.log(`📤 SDP answer отправлен для ${playerId}`);

      return sdpAnswer;

    } catch (error) {
      console.error(`❌ Ошибка обработки SDP offer для ${playerId}:`, error);
      throw error;
    }
  }

  // Добавление ICE кандидата от клиента
  async addIceCandidate(playerId, candidate) {
    try {
      const playerData = this.endpoints.get(playerId);
      if (!playerData || !playerData.endpoint) {
        throw new Error(`Endpoint для игрока ${playerId} не найден`);
      }

      await playerData.endpoint.addIceCandidate(candidate);

    } catch (error) {
      console.error(`❌ Ошибка добавления ICE кандидата для ${playerId}:`, error);
    }
  }

  // Подключение всех endpoints друг к другу (для mesh-подобной топологии)
  // Альтернатива: использовать Composite для микширования
  async connectEndpoints() {
    try {
      const endpointsArray = Array.from(this.endpoints.values());
      
      // Подключаем каждый endpoint к каждому другому
      for (let i = 0; i < endpointsArray.length; i++) {
        for (let j = i + 1; j < endpointsArray.length; j++) {
          const endpoint1 = endpointsArray[i].endpoint;
          const endpoint2 = endpointsArray[j].endpoint;
          
          // Подключаем друг к другу (двунаправленно)
          await endpoint1.connect(endpoint2);
          await endpoint2.connect(endpoint1);
          
          console.log(`🔗 Соединены endpoints: ${endpointsArray[i].playerName} ↔ ${endpointsArray[j].playerName}`);
        }
      }

    } catch (error) {
      console.error('❌ Ошибка подключения endpoints:', error);
    }
  }

  // Callback для ICE кандидатов (будет переопределен из websocket.js)
  onIceCandidate(playerId, candidate) {
    // Этот метод будет переопределен из websocket.js
    console.log(`🧊 ICE кандидат от ${playerId}:`, candidate);
  }

  // Получение статуса
  getStatus() {
    return {
      isConnected: this.isConnected,
      hasPipeline: !!this.mediaPipeline,
      connectedPlayers: this.endpoints.size,
      players: Array.from(this.endpoints.entries()).map(([id, data]) => ({
        id,
        name: data.playerName,
        createdAt: data.createdAt
      }))
    };
  }

  // Очистка и освобождение ресурсов
  async cleanup() {
    try {
      console.log('🧹 Очистка Kurento ресурсов...');

      // Освобождаем все endpoints
      for (const [playerId, playerData] of this.endpoints.entries()) {
        if (playerData.endpoint) {
          await playerData.endpoint.release();
        }
      }
      this.endpoints.clear();

      // Освобождаем MediaPipeline
      if (this.mediaPipeline) {
        await this.mediaPipeline.release();
        this.mediaPipeline = null;
      }

      // Закрываем клиент
      if (this.kurentoClient) {
        // Kurento Client не имеет метода disconnect, просто очищаем ссылку
        this.kurentoClient = null;
      }

      this.isConnected = false;
      console.log('✅ Kurento ресурсы очищены');

    } catch (error) {
      console.error('❌ Ошибка очистки Kurento:', error);
    }
  }
}

module.exports = KurentoHandler;

