// Обработчики WebSocket сообщений для Janus SFU
const janusClient = require('./janus-client');

/**
 * Обработка сообщений связанных с Janus
 */
function handleJanusMessage(ws, data, allPlayers, host) {
  switch (data.type) {
    case "janus_offer":
      // Игрок отправил SDP offer для публикации
      handleJanusOffer(ws, data, allPlayers, host);
      break;
    
    case "janus_answer":
      // Игрок отправил SDP answer для подписки
      handleJanusAnswer(ws, data, allPlayers, host);
      break;
    
    case "janus_ice_candidate":
      // Игрок отправил ICE candidate
      handleJanusIceCandidate(ws, data, allPlayers, host);
      break;
    
    case "janus_subscribe":
      // Игрок хочет подписаться на потоки других игроков
      handleJanusSubscribe(ws, data, allPlayers, host);
      break;
    
    default:
      return false; // Сообщение не связано с Janus
  }
  return true; // Сообщение обработано
}

/**
 * Обработка SDP offer от игрока
 */
async function handleJanusOffer(ws, data) {
  // Здесь должна быть логика обработки offer через Janus API
  // В реальной реализации это делается через WebSocket соединение с Janus
  console.log(`📡 Получен Janus offer от ${ws.id}`);
}

/**
 * Обработка SDP answer от игрока
 */
async function handleJanusAnswer(ws, data) {
  console.log(`📡 Получен Janus answer от ${ws.id}`);
}

/**
 * Обработка ICE candidate от игрока
 */
async function handleJanusIceCandidate(ws, data) {
  console.log(`📡 Получен Janus ICE candidate от ${ws.id}`);
}

/**
 * Подписка на потоки других игроков
 */
async function handleJanusSubscribe(ws, data, allPlayers, host) {
  try {
    const participants = await janusClient.getRoomParticipants(ws.id);
    
    // Отправляем список участников для подписки
    ws.send(JSON.stringify({
      type: "janus_participants",
      participants: participants.map(p => ({
        id: p.id,
        display: p.display
      }))
    }));
    
    console.log(`📡 Игрок ${ws.id} получил список участников: ${participants.length}`);
  } catch (error) {
    console.error(`❌ Ошибка получения участников для ${ws.id}:`, error);
    ws.send(JSON.stringify({
      type: "error",
      message: "Ошибка получения списка участников"
    }));
  }
}

module.exports = {
  handleJanusMessage
};

