// Janus SFU интеграция для Bunker Game
// Этот файл предоставляет API для работы с Janus медиа-сервером

const https = require('https');
const http = require('http');
const WebSocket = require('ws');

// Конфигурация Janus сервера
const JANUS_HTTP_URL = process.env.JANUS_URL || 'http://localhost:8088/janus';
const JANUS_WS_URL = process.env.JANUS_WS_URL || 'ws://localhost:8188';

// Хранилище сессий и комнат
const janusSessions = new Map(); // playerId -> {sessionId, handleId, roomId}
const rooms = new Map(); // roomId -> {players: Set<playerId>, janusRoomId}

/**
 * Создает сессию в Janus для игрока
 */
async function createJanusSession(playerId) {
  try {
    const response = await fetch(JANUS_HTTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        janus: 'create',
        transaction: `tx_${Date.now()}_${Math.random()}`
      })
    });

    const data = await response.json();
    if (data.janus === 'success') {
      const sessionId = data.data.id;
      
      // Создаем handle для видеорoom плагина
      const handleResponse = await fetch(`${JANUS_HTTP_URL}/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          janus: 'attach',
          plugin: 'janus.plugin.videoroom',
          transaction: `tx_${Date.now()}_${Math.random()}`
        })
      });

      const handleData = await handleResponse.json();
      if (handleData.janus === 'success') {
        const handleId = handleData.data.id;
        
        janusSessions.set(playerId, {
          sessionId,
          handleId,
          roomId: null
        });

        return { sessionId, handleId };
      }
    }
    
    throw new Error('Failed to create Janus session');
  } catch (error) {
    console.error(`❌ Ошибка создания Janus сессии для ${playerId}:`, error);
    return null;
  }
}

/**
 * Создает или подключает к комнате
 */
async function joinRoom(playerId, roomId = 'bunker-game') {
  const session = janusSessions.get(playerId);
  if (!session) {
    await createJanusSession(playerId);
    return joinRoom(playerId, roomId);
  }

  try {
    // Проверяем существует ли комната
    let janusRoomId = null;
    if (!rooms.has(roomId)) {
      // Создаем комнату в Janus
      const createRoomResponse = await fetch(`${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          janus: 'message',
          transaction: `tx_${Date.now()}_${Math.random()}`,
          body: {
            request: 'create',
            room: parseInt(roomId.replace(/\D/g, '')) || 1234,
            publishers: 10,
            bitrate: 512000,
            fir_freq: 10
          }
        })
      });

      const createData = await createRoomResponse.json();
      if (createData.plugindata && createData.plugindata.data.videoroom === 'created') {
        janusRoomId = createData.plugindata.data.room;
      }
    } else {
      janusRoomId = rooms.get(roomId).janusRoomId;
    }

    // Подключаем игрока к комнате
    const joinResponse = await fetch(`${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        janus: 'message',
        transaction: `tx_${Date.now()}_${Math.random()}`,
        body: {
          request: 'join',
          room: janusRoomId,
          ptype: 'publisher',
          display: `Player_${playerId.substring(0, 8)}`
        }
      })
    });

    const joinData = await joinResponse.json();
    if (joinData.plugindata && joinData.plugindata.data.videoroom === 'joined') {
      session.roomId = roomId;
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          players: new Set(),
          janusRoomId
        });
      }
      rooms.get(roomId).players.add(playerId);

      return {
        sessionId: session.sessionId,
        handleId: session.handleId,
        roomId: janusRoomId,
        room: joinData.plugindata.data
      };
    }

    throw new Error('Failed to join room');
  } catch (error) {
    console.error(`❌ Ошибка подключения к комнате для ${playerId}:`, error);
    return null;
  }
}

/**
 * Получает список издателей (publishers) в комнате
 */
async function getRoomPublishers(playerId) {
  const session = janusSessions.get(playerId);
  if (!session || !session.roomId) return [];

  try {
    const roomInfo = rooms.get(session.roomId);
    if (!roomInfo) return [];

    const listResponse = await fetch(`${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        janus: 'message',
        transaction: `tx_${Date.now()}_${Math.random()}`,
        body: {
          request: 'listparticipants',
          room: roomInfo.janusRoomId
        }
      })
    });

    const listData = await listResponse.json();
    if (listData.plugindata && listData.plugindata.data.participants) {
      return listData.plugindata.data.participants;
    }

    return [];
  } catch (error) {
    console.error(`❌ Ошибка получения списка издателей для ${playerId}:`, error);
    return [];
  }
}

/**
 * Отключает игрока от комнаты
 */
async function leaveRoom(playerId) {
  const session = janusSessions.get(playerId);
  if (!session) return;

  try {
    if (session.roomId) {
      const roomInfo = rooms.get(session.roomId);
      if (roomInfo) {
        roomInfo.players.delete(playerId);
      }
      session.roomId = null;
    }

    // Уничтожаем handle и сессию в Janus
    if (session.handleId) {
      await fetch(`${JANUS_HTTP_URL}/${session.sessionId}/${session.handleId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          janus: 'detach',
          transaction: `tx_${Date.now()}_${Math.random()}`
        })
      });
    }

    if (session.sessionId) {
      await fetch(`${JANUS_HTTP_URL}/${session.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          janus: 'destroy',
          transaction: `tx_${Date.now()}_${Math.random()}`
        })
      });
    }

    janusSessions.delete(playerId);
  } catch (error) {
    console.error(`❌ Ошибка отключения ${playerId} от комнаты:`, error);
  }
}

module.exports = {
  createJanusSession,
  joinRoom,
  getRoomPublishers,
  leaveRoom,
  JANUS_WS_URL,
  JANUS_HTTP_URL
};

