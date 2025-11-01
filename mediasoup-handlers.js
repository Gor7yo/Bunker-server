// Обработчики WebSocket сообщений для Mediasoup SFU

const mediasoupServer = require('./mediasoup-server');

/**
 * Обработка сообщений связанных с Mediasoup
 */
async function handleMediasoupMessage(ws, data, allPlayers, host) {
  try {
    switch (data.type) {
      case "mediasoup_connect_transport":
        await handleConnectTransport(ws, data);
        return true;

      case "mediasoup_create_producer":
        await handleCreateProducer(ws, data, allPlayers, host);
        return true;

      case "mediasoup_create_consumer":
        await handleCreateConsumer(ws, data);
        return true;

      case "mediasoup_get_producers":
        await handleGetProducers(ws);
        return true;

      default:
        return false; // Сообщение не связано с Mediasoup
    }
  } catch (error) {
    console.error(`❌ Ошибка обработки Mediasoup сообщения:`, error);
    ws.send(JSON.stringify({
      type: "error",
      message: `Ошибка Mediasoup: ${error.message}`
    }));
    return true;
  }
}

/**
 * Подключение транспорта (WebRTC DTLS)
 */
async function handleConnectTransport(ws, data) {
  const { transportId, dtlsParameters, direction } = data;
  
  if (!ws.id) {
    throw new Error('Игрок не идентифицирован');
  }

  await mediasoupServer.connectTransport(ws.id, transportId, dtlsParameters, direction);
  
  ws.send(JSON.stringify({
    type: "mediasoup_transport_connected",
    transportId,
    direction
  }));
}

/**
 * Создание producer (отправка видео)
 */
async function handleCreateProducer(ws, data, allPlayers, host) {
  const { transportId, rtpParameters } = data;
  
  if (!ws.id) {
    throw new Error('Игрок не идентифицирован');
  }

  const producer = await mediasoupServer.createProducer(ws.id, transportId, rtpParameters);
  
  ws.send(JSON.stringify({
    type: "mediasoup_producer_created",
    producer
  }));

  // Уведомляем всех остальных игроков о новом producer
  const allConnections = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN && p.id !== ws.id);
  allConnections.forEach(player => {
    player.send(JSON.stringify({
      type: "mediasoup_new_producer",
      producerId: producer.id,
      playerId: ws.id,
      kind: producer.kind
    }));
  });
}

/**
 * Создание consumer (получение видео от другого игрока)
 */
async function handleCreateConsumer(ws, data) {
  const { producerId, rtpCapabilities } = data;
  
  if (!ws.id) {
    throw new Error('Игрок не идентифицирован');
  }

  const consumer = await mediasoupServer.createConsumer(ws.id, producerId, rtpCapabilities);
  
  ws.send(JSON.stringify({
    type: "mediasoup_consumer_created",
    consumer
  }));
}

/**
 * Получение списка всех producers (других игроков)
 */
async function handleGetProducers(ws) {
  if (!ws.id) {
    throw new Error('Игрок не идентифицирован');
  }

  const producers = mediasoupServer.getProducers(ws.id);
  
  ws.send(JSON.stringify({
    type: "mediasoup_producers_list",
    producers
  }));
}

module.exports = {
  handleMediasoupMessage
};

