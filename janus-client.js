// Клиент для работы с Janus WebRTC Server
// Использует HTTP API для управления сессиями и комнатами

const http = require('http');
const https = require('https');
const { URL } = require('url');

const JANUS_HTTP_URL = process.env.JANUS_URL || 'http://localhost:8088/janus';
const JANUS_WS_URL = process.env.JANUS_WS_URL || 'ws://localhost:8188';

class JanusClient {
  constructor() {
    this.sessions = new Map(); // playerId -> {sessionId, handleId, roomId}
    this.rooms = new Map(); // roomId -> {janusRoomId, players: Set<playerId>}
    this.defaultRoomId = 1234; // ID комнаты по умолчанию в Janus
  }

  /**
   * Выполняет HTTP запрос к Janus
   */
  async makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        };
        
        const req = client.request(reqOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              console.error(`❌ Ошибка парсинга ответа от Janus:`, e, data);
              resolve({ error: 'Invalid JSON response', raw: data });
            }
          });
        });

        req.on('error', (error) => {
          console.error(`❌ Ошибка HTTP запроса к Janus:`, error);
          reject(error);
        });
        
        if (options.body) {
          req.write(JSON.stringify(options.body));
        }
        
        req.end();
      } catch (error) {
        console.error(`❌ Ошибка создания запроса к Janus:`, error);
        reject(error);
      }
    });
  }

  /**
   * Генерирует уникальный transaction ID
   */
  generateTransaction() {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Создает сессию в Janus для игрока
   */
  async createSession(playerId) {
    try {
      const response = await this.makeRequest(JANUS_HTTP_URL, {
        method: 'POST',
        body: {
          janus: 'create',
          transaction: this.generateTransaction()
        }
      });

      if (response.janus === 'success' && response.data && response.data.id) {
        const sessionId = response.data.id;
        
        // Присоединяемся к видеорoom плагину
        const handleResponse = await this.makeRequest(`${JANUS_HTTP_URL}/${sessionId}`, {
          method: 'POST',
          body: {
            janus: 'attach',
            plugin: 'janus.plugin.videoroom',
            transaction: this.generateTransaction()
          }
        });

        if (handleResponse.janus === 'success' && handleResponse.data && handleResponse.data.id) {
          const handleId = handleResponse.data.id;
          
          this.sessions.set(playerId, {
            sessionId,
            handleId,
            roomId: null,
            createdAt: Date.now()
          });

          console.log(`✅ Janus сессия создана для игрока ${playerId}: session=${sessionId}, handle=${handleId}`);
          return { sessionId, handleId };
        }
      }
      
      throw new Error('Failed to create handle');
    } catch (error) {
      console.error(`❌ Ошибка создания Janus сессии для ${playerId}:`, error.message);
      return null;
    }
  }

  /**
   * Создает комнату в Janus (если не существует)
   */
  async ensureRoom(roomId = 'bunker-game') {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId).janusRoomId;
    }

    // Находим любого игрока с сессией для создания комнаты
    let sessionData = null;
    for (const [pid, data] of this.sessions.entries()) {
      if (data.sessionId && data.handleId) {
        sessionData = data;
        break;
      }
    }

    if (!sessionData) {
      console.warn(`⚠️ Нет активных сессий для создания комнаты ${roomId}`);
      return null;
    }

    try {
      const janusRoomId = this.defaultRoomId;
      
      // Пытаемся создать комнату
      const createResponse = await this.makeRequest(
        `${JANUS_HTTP_URL}/${sessionData.sessionId}/${sessionData.handleId}`,
        {
          method: 'POST',
          body: {
            janus: 'message',
            transaction: this.generateTransaction(),
            body: {
              request: 'create',
              room: janusRoomId,
              publishers: 10,
              bitrate: 512000,
              videocodec: 'vp8',
              fir_freq: 10
            }
          }
        }
      );

      if (createResponse.plugindata && 
          (createResponse.plugindata.data.videoroom === 'created' || 
           createResponse.plugindata.data.error_code === 427)) {
        // Комната создана или уже существует (ошибка 427)
        this.rooms.set(roomId, {
          janusRoomId,
          players: new Set()
        });
        console.log(`✅ Комната ${roomId} создана/найдена в Janus с ID ${janusRoomId}`);
        return janusRoomId;
      }

      throw new Error('Failed to create room');
    } catch (error) {
      console.error(`❌ Ошибка создания комнаты ${roomId}:`, error.message);
      return null;
    }
  }

  /**
   * Подключает игрока к комнате как publisher
   */
  async joinAsPublisher(playerId, roomId = 'bunker-game') {
    let session = this.sessions.get(playerId);
    
    if (!session) {
      const created = await this.createSession(playerId);
      if (!created) return null;
      session = this.sessions.get(playerId);
    }

    // Убеждаемся что комната существует
    const janusRoomId = await this.ensureRoom(roomId);
    if (!janusRoomId) {
      return null;
    }

    try {
      const joinResponse = await this.makeRequest(
        `${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`,
        {
          method: 'POST',
          body: {
            janus: 'message',
            transaction: this.generateTransaction(),
            body: {
              request: 'join',
              room: janusRoomId,
              ptype: 'publisher',
              display: `Player_${playerId.substring(0, 8)}`
            }
          }
        }
      );

      if (joinResponse.plugindata && joinResponse.plugindata.data.videoroom === 'joined') {
        session.roomId = roomId;
        
        if (!this.rooms.has(roomId)) {
          this.rooms.set(roomId, {
            janusRoomId,
            players: new Set()
          });
        }
        this.rooms.get(roomId).players.add(playerId);

        // Генерируем JSEP для публикации
        const publishResponse = await this.makeRequest(
          `${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`,
          {
            method: 'POST',
            body: {
              janus: 'message',
              transaction: this.generateTransaction(),
              body: {
                request: 'publish',
                audio: false, // Микрофон отключен
                video: true,
                videocodec: 'vp8'
              }
            }
          }
        );

        return {
          sessionId: session.sessionId,
          handleId: session.handleId,
          roomId: janusRoomId,
          jsep: publishResponse.jsep,
          roomInfo: joinResponse.plugindata.data
        };
      }

      throw new Error('Failed to join room');
    } catch (error) {
      console.error(`❌ Ошибка подключения игрока ${playerId} к комнате:`, error.message);
      return null;
    }
  }

  /**
   * Получает список участников комнаты
   */
  async getRoomParticipants(playerId) {
    const session = this.sessions.get(playerId);
    if (!session || !session.roomId) {
      return [];
    }

    const roomInfo = this.rooms.get(session.roomId);
    if (!roomInfo) {
      return [];
    }

    try {
      const listResponse = await this.makeRequest(
        `${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`,
        {
          method: 'POST',
          body: {
            janus: 'message',
            transaction: this.generateTransaction(),
            body: {
              request: 'listparticipants',
              room: roomInfo.janusRoomId
            }
          }
        }
      );

      if (listResponse.plugindata && listResponse.plugindata.data.participants) {
        return listResponse.plugindata.data.participants;
      }

      return [];
    } catch (error) {
      console.error(`❌ Ошибка получения списка участников:`, error.message);
      return [];
    }
  }

  /**
   * Отключает игрока от комнаты
   */
  async leaveRoom(playerId) {
    const session = this.sessions.get(playerId);
    if (!session) {
      return;
    }

    try {
      // Удаляем из комнаты
      if (session.roomId) {
        const roomInfo = this.rooms.get(session.roomId);
        if (roomInfo) {
          roomInfo.players.delete(playerId);
        }

        // Отключаемся от комнаты
        await this.makeRequest(
          `${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`,
          {
            method: 'POST',
            body: {
              janus: 'message',
              transaction: this.generateTransaction(),
              body: {
                request: 'leave'
              }
            }
          }
        );
      }

      // Уничтожаем handle
      if (session.handleId) {
        await this.makeRequest(
          `${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`,
          {
            method: 'POST',
            body: {
              janus: 'detach',
              transaction: this.generateTransaction()
            }
          }
        );
      }

      // Уничтожаем сессию
      if (session.sessionId) {
        await this.makeRequest(
          `${JANUS_HTTP_URL}/${session.sessionId}`,
          {
            method: 'POST',
            body: {
              janus: 'destroy',
              transaction: this.generateTransaction()
            }
          }
        );
      }

      this.sessions.delete(playerId);
      console.log(`✅ Игрок ${playerId} отключен от Janus`);
    } catch (error) {
      console.error(`❌ Ошибка отключения игрока ${playerId}:`, error.message);
    }
  }

  /**
   * Получает информацию о сессии игрока
   */
  getSessionInfo(playerId) {
    const session = this.sessions.get(playerId);
    if (!session) return null;

    return {
      sessionId: session.sessionId,
      handleId: session.handleId,
      roomId: session.roomId,
      janusWsUrl: JANUS_WS_URL
    };
  }
}

// Экспортируем singleton
const janusClient = new JanusClient();

module.exports = janusClient;

