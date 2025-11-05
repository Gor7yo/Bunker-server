// SFU сервер на базе Mediasoup
// Полная интеграция: логика игры + Mediasoup SFU

const mediasoup = require('mediasoup');
const WebSocket = require("ws");
const propertiesData = require("./properties.json");

// ============================
// Mediasoup инициализация
// ============================
const workers = [];
const routers = new Map(); // roomId -> router
const rooms = new Map(); // roomId -> { producers: Map, consumers: Map, transports: Map }
const clientMediasoup = new Map(); // wsId -> { router, transports: Map, producer: null, consumers: Map }

async function createWorkers() {
  const numWorkers = 1; // Для вашего сервера (1 vCPU) - 1 worker достаточно
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: 40000,
      rtcMaxPort: 49999
    });
    
    worker.on('died', () => {
      console.error('❌ Mediasoup worker died, exiting...');
      process.exit(1);
    });
    
    workers.push(worker);
    console.log(`✅ Mediasoup worker ${i + 1} создан`);
  }
}

async function getOrCreateRouter(roomId = 'default') {
  if (routers.has(roomId)) {
    return routers.get(roomId);
  }
  
  const worker = workers[0];
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      }
    ]
  });
  
  routers.set(roomId, router);
  rooms.set(roomId, {
    producers: new Map(), // playerId -> producer
    consumers: new Map(), // consumerId -> consumer
    transports: new Map() // playerId -> { send, recv }
  });
  
  console.log(`✅ Router создан для комнаты ${roomId}`);
  return router;
}

// ============================
// WebSocket сервер
// ============================
const wss = new WebSocket.Server({ 
  port: 5000,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024,
  clientTracking: true
}, () => console.log("✅ SFU сервер запущен на порту 5000"));

// ============================
// Состояние игры (из websocket.js)
// ============================
const MAX_PLAYERS = 8;
let allPlayers = [];
let host = null;
let adminPanel = null;
let gameState = { 
  started: false, 
  startTime: null, 
  ready: false,
  currentRound: 0,
  totalRounds: 5
};
let bannedPlayers = new Set();
let highlightedPlayerId = null;
let disconnectedPlayers = new Map();
let usedCards = {};
let votingState = {
  phase: null,
  candidates: new Set(),
  votes: new Map(),
  voteCounts: {}
};
let votingHistory = [];

// Оптимизации
let lastPlayersUpdateData = null;
let lastPlayersUpdateString = null;
let playersUpdateTimeout = null;
const PLAYERS_UPDATE_THROTTLE = 100;

const DEBUG = process.env.NODE_ENV !== 'production';
const log = DEBUG ? console.log : () => {};
const logError = console.error;

// ============================
// ВСЕ ФУНКЦИИ ИГРЫ ИЗ WEBSOCKET.JS
// ============================
// ВАЖНО: Скопируйте сюда ВСЕ функции из websocket.js:
// - generatePlayerCharacteristics
// - markPlayerCardsAsUsed
// - generateAllPlayerCards
// - handleActionCard и все handle* функции
// - broadcast
// - sendPlayersUpdate и _sendPlayersUpdateNow
// - checkVotingComplete
// - checkAllReady
// - sendToPlayer
// 
// Для краткости здесь указана только структура.
// Вам нужно скопировать ВСЕ функции игры из websocket.js (строки 52-904)

function generatePlayerCharacteristics() {
  const characteristics = {};
  const categories = ['bandage', 'actions', 'fact', 'fobia', 'health', 'hobbie', 'age', 'proffesion'];
  
  categories.forEach(category => {
    const categoryData = propertiesData.propertiesCategory.find(cat => cat.category === category);
    if (categoryData && categoryData.items.length > 0) {
      if (!usedCards[category]) {
        usedCards[category] = new Set();
      }
      
      const availableItems = categoryData.items.filter(item => !usedCards[category].has(item.value));
      
      if (availableItems.length === 0) {
        console.warn(`⚠️ Все карты категории ${category} использованы! Сбрасываем...`);
        usedCards[category] = new Set();
        const randomIndex = Math.floor(Math.random() * categoryData.items.length);
        const selectedItem = categoryData.items[randomIndex];
        usedCards[category].add(selectedItem.value);
        
        characteristics[category] = {
          value: selectedItem.value,
          description: selectedItem.description || null,
          experience: selectedItem.experience || null,
          revealed: false
        };
      } else {
        const randomIndex = Math.floor(Math.random() * availableItems.length);
        const selectedItem = availableItems[randomIndex];
        usedCards[category].add(selectedItem.value);
        
        characteristics[category] = {
          value: selectedItem.value,
          description: selectedItem.description || null,
          experience: selectedItem.experience || null,
          revealed: false
        };
      }
    }
  });
  
  return characteristics;
}

function markPlayerCardsAsUsed(characteristics) {
  if (!characteristics) return;
  
  Object.keys(characteristics).forEach(category => {
    const cardValue = characteristics[category]?.value;
    if (cardValue) {
      if (!usedCards[category]) {
        usedCards[category] = new Set();
      }
      usedCards[category].add(cardValue);
    }
  });
}

function generateAllPlayerCards() {
  console.log("🎲 Генерируем карты для всех игроков...");
  usedCards = {};
  
  allPlayers.forEach(player => {
    if (player.readyState === WebSocket.OPEN && !player.characteristics) {
      player.characteristics = generatePlayerCharacteristics();
      console.log(`📋 Карты для ${player.name}:`, Object.keys(player.characteristics));
    } else if (player.characteristics) {
      markPlayerCardsAsUsed(player.characteristics);
    }
  });
  
  if (host && host.readyState === WebSocket.OPEN) {
    if (!host.characteristics) {
      host.characteristics = generatePlayerCharacteristics();
      console.log(`📋 Карты для ведущего ${host.name}:`, Object.keys(host.characteristics));
    } else {
      markPlayerCardsAsUsed(host.characteristics);
    }
  }
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  const clients = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
  
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch (error) {
        logError("❌ Ошибка отправки:", error);
      }
    }
  }
}

function sendPlayersUpdate(force = false) {
  if (!force && playersUpdateTimeout) {
    return;
  }
  
  playersUpdateTimeout = setTimeout(() => {
    playersUpdateTimeout = null;
    _sendPlayersUpdateNow();
  }, force ? 0 : PLAYERS_UPDATE_THROTTLE);
}

function _sendPlayersUpdateNow() {
  const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
  const activeHost = host && host.readyState === WebSocket.OPEN ? host : null;
  const playersList = [...activePlayers];
  if (activeHost) {
    playersList.push(activeHost);
  }

  const readyCount = playersList.filter((p) => p.ready).length;
  const totalPlayers = playersList.length;

  log("📤 Игроков онлайн:", activePlayers.length, "Готовых:", readyCount);

  const updateData = {
    type: "players_update",
    players: playersList.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      role: p.role,
      characteristics: p.characteristics || null,
      mirrorCamera: p.mirrorCamera || false
    })),
    readyCount,
    totalPlayers,
    regularPlayers: activePlayers.length,
    maxRegularPlayers: MAX_PLAYERS,
    hostConnected: !!activeHost,
    hostReady: activeHost ? activeHost.ready : false,
    gameStarted: gameState.started,
    gameStartTime: gameState.startTime,
    gameElapsedTime: gameState.started && gameState.startTime ? Date.now() - gameState.startTime : 0,
    gameReady: gameState.ready,
    currentRound: gameState.currentRound,
    totalRounds: gameState.totalRounds,
    highlightedPlayerId: highlightedPlayerId,
    votingActive: votingState.phase === "voting",
    votingPhase: votingState.phase,
    votingCandidates: Array.from(votingState.candidates),
    votedPlayers: Array.from(votingState.votes.keys()),
    voteCounts: votingState.voteCounts
  };

  const dataKey = `${playersList.length}-${readyCount}-${gameState.started}-${gameState.currentRound}`;
  if (lastPlayersUpdateData === dataKey && lastPlayersUpdateString) {
    const msg = lastPlayersUpdateString;
    
    if (adminPanel && adminPanel.readyState === WebSocket.OPEN) {
      try {
        adminPanel.send(msg);
      } catch (e) {
        logError("❌ Ошибка отправки админ-панели:", e);
      }
    }
    
    broadcast(updateData);
    return;
  }

  lastPlayersUpdateData = dataKey;
  const msg = JSON.stringify(updateData);
  lastPlayersUpdateString = msg;

  if (adminPanel && adminPanel.readyState === WebSocket.OPEN) {
    try {
      adminPanel.send(msg);
    } catch (e) {
      logError("❌ Ошибка отправки админ-панели:", e);
    }
  }

  broadcast(updateData);
}

function sendToPlayer(playerId, data) {
  const allConnections = [...allPlayers, host];
  const targetPlayer = allConnections.find(p => p && p.id === playerId && p.readyState === WebSocket.OPEN);
  
  if (targetPlayer) {
    try {
      targetPlayer.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logError(`❌ Ошибка отправки игроку ${playerId}:`, error);
      return false;
    }
  }
  return false;
}

// ВАЖНО: Добавьте сюда ВСЕ остальные функции из websocket.js:
// - handleActionCard и все handle* функции (handleExchangeFates, handleHealthReset, и т.д.)
// - checkVotingComplete
// - checkAllReady
// Для краткости они не включены, но нужны для полной функциональности

function handleActionCard(actionType, parameters, allConnections) {
  console.log(`⚡ Обработка карты: ${actionType}`, parameters);
  
  switch (actionType) {
    case "Обмен судьбами":
      handleExchangeFates(parameters.selectedPlayers, allConnections);
      break;
    case "Выборочный обмен":
      handleSelectiveExchange(parameters.selectedPlayers, parameters.selectedCharacteristics, allConnections);
      break;
    case "Подозрение":
      handleSuspicion(parameters.selectedPlayers, allConnections);
      break;
    case "Проверка досье":
      handleDossierCheck(parameters.selectedPlayers, parameters.selectedCharacteristics, allConnections);
      break;
    case "Атака на репутацию":
      handleReputationAttack(parameters.selectedPlayers, allConnections);
      break;
    case "Реинкарнация":
      handleReincarnation(parameters.selectedPlayers, allConnections);
      break;
    case "Переквалификация":
      handleRetraining(parameters.selectedPlayers, allConnections);
      break;
    case "Фобия исчезла":
      handlePhobiaGone(parameters.selectedPlayers, allConnections);
      break;
    case "Сбросс здоровья":
      handleHealthReset(allConnections);
      break;
    case "Второй шанс":
      handleSecondChance(parameters.selectedPlayers, allConnections);
      break;
    case "Иммунитет":
      handleImmunity(parameters.selectedPlayers, allConnections);
      break;
    case "Тайное знание":
      handleSecretKnowledge(parameters.selectedPlayers, parameters.selectedCharacteristics, allConnections);
      break;
    case "Перезапуск":
      handleRestart(allConnections);
      break;
    case "Исповедь":
      handleConfession(parameters.selectedPlayers, parameters.selectedCharacteristics, allConnections);
      break;
    case "Генная терапия":
      handleGeneTherapy(parameters.selectedPlayers, parameters.selectedCharacteristics, allConnections);
      break;
    case "Наследие":
      handleLegacy(parameters.selectedPlayers, allConnections);
      break;
    case "Религиозный фанатизм":
      handleReligiousFanaticism(parameters.selectedPlayers, allConnections);
      break;
    case "Экспериментальное лечение":
      handleExperimentalTreatment(parameters.selectedPlayers, allConnections);
      break;
    default:
      console.log(`⚠️ Неизвестная карта действия: ${actionType}`);
  }
}

function handleExchangeFates(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 2) {
    console.error("❌ Обмен судьбами требует двух игроков");
    return;
  }
  const [player1Id, player2Id] = playerIds;
  const player1 = allConnections.find(p => p && p.id === player1Id);
  const player2 = allConnections.find(p => p && p.id === player2Id);
  if (!player1 || !player2 || !player1.characteristics || !player2.characteristics) {
    console.error("❌ Игроки не найдены или у них нет характеристик");
    return;
  }
  const categories = ['bandage', 'actions', 'fact', 'fobia', 'health', 'hobbie', 'age', 'proffesion'];
  categories.forEach(category => {
    const char1 = player1.characteristics[category];
    const char2 = player2.characteristics[category];
    if (char1 && char2 && char1.revealed && char2.revealed) {
      const tempValue = char1.value;
      char1.value = char2.value;
      char2.value = tempValue;
      console.log(`🔄 Обмен ${category}: ${char2.value} <-> ${char1.value}`);
    }
  });
  sendPlayersUpdate();
}

function handleHealthReset(allConnections) {
  allConnections.forEach(player => {
    if (player && player.characteristics && player.characteristics.health) {
      const healthData = propertiesData.propertiesCategory.find(cat => cat.category === 'health');
      if (healthData && healthData.items.length > 0) {
        const randomIndex = Math.floor(Math.random() * healthData.items.length);
        const selectedHealth = healthData.items[randomIndex];
        const wasRevealed = player.characteristics.health.revealed;
        player.characteristics.health = {
          value: selectedHealth.value,
          description: selectedHealth.description || null,
          experience: selectedHealth.experience || null,
          revealed: wasRevealed
        };
        console.log(`🏥 Новое здоровье для ${player.name}: ${selectedHealth.value} (раскрыто: ${wasRevealed})`);
      }
    }
  });
  sendPlayersUpdate();
}

function handleSelectiveExchange(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 2 || !characteristic) {
    console.error("❌ Выборочный обмен требует двух игроков и характеристику");
    return;
  }
  const [player1Id, player2Id] = playerIds;
  const player1 = allConnections.find(p => p && p.id === player1Id);
  const player2 = allConnections.find(p => p && p.id === player2Id);
  if (!player1 || !player2 || !player1.characteristics || !player2.characteristics) return;
  const char1 = player1.characteristics[characteristic];
  const char2 = player2.characteristics[characteristic];
  if (char1 && char2) {
    const tempValue = char1.value;
    const tempRevealed = char1.revealed;
    char1.value = char2.value;
    char1.revealed = char2.revealed;
    char2.value = tempValue;
    char2.revealed = tempRevealed;
    console.log(`🔄 Выборочный обмен ${characteristic}`);
  }
  sendPlayersUpdate();
}

function handleSuspicion(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  const closedCharacteristics = Object.keys(player.characteristics).filter(
    key => player.characteristics[key] && !player.characteristics[key].revealed
  );
  if (closedCharacteristics.length > 0) {
    const randomKey = closedCharacteristics[Math.floor(Math.random() * closedCharacteristics.length)];
    player.characteristics[randomKey].revealed = true;
    console.log(`🔍 Раскрыта характеристика: ${randomKey}`);
  }
  sendPlayersUpdate();
}

function handleDossierCheck(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 1 || !characteristic) return;
  console.log(`📋 Проверка досье игрока ${playerIds[0]}, характеристика: ${characteristic}`);
  sendPlayersUpdate();
}

function handleReputationAttack(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  player.muted = true;
  console.log(`🔇 Игрок ${player.name} потерял право говорить`);
  sendPlayersUpdate();
}

function handleReincarnation(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  const ageData = propertiesData.propertiesCategory.find(cat => cat.category === 'age');
  if (ageData && ageData.items.length > 0) {
    const randomIndex = Math.floor(Math.random() * ageData.items.length);
    const selectedAge = ageData.items[randomIndex];
    player.characteristics.age.value = selectedAge.value;
    console.log(`🔄 Новый возраст: ${selectedAge.value}`);
  }
  sendPlayersUpdate();
}

function handleRetraining(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  const professionData = propertiesData.propertiesCategory.find(cat => cat.category === 'proffesion');
  if (professionData && professionData.items.length > 0) {
    const randomIndex = Math.floor(Math.random() * professionData.items.length);
    const selectedProf = professionData.items[randomIndex];
    player.characteristics.proffesion.value = selectedProf.value;
    console.log(`🎓 Новая профессия: ${selectedProf.value}`);
  }
  sendPlayersUpdate();
}

function handlePhobiaGone(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  const wasRevealed = player.characteristics.fobia ? player.characteristics.fobia.revealed : false;
  player.characteristics.fobia = {
    value: "Нет фобии",
    description: null,
    experience: null,
    revealed: wasRevealed
  };
  console.log(`😌 Фобия исчезла`);
  sendPlayersUpdate();
}

function handleSecondChance(playerIds, allConnections) {
  console.log(`🔄 Второй шанс используется`);
  sendPlayersUpdate();
}

function handleImmunity(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  player.immune = true;
  console.log(`🛡️ Игрок ${player.name} получил иммунитет`);
  sendPlayersUpdate();
}

function handleSecretKnowledge(playerIds, characteristic, allConnections) {
  console.log(`🔮 Тайное знание`);
  sendPlayersUpdate();
}

function handleRestart(allConnections) {
  allConnections.forEach(player => {
    if (player && player.characteristics) {
      const openCharacteristics = Object.keys(player.characteristics).filter(
        key => player.characteristics[key] && player.characteristics[key].revealed
      );
      if (openCharacteristics.length > 0) {
        const randomKey = openCharacteristics[Math.floor(Math.random() * openCharacteristics.length)];
        const categoryData = propertiesData.propertiesCategory.find(cat => cat.category === randomKey);
        if (categoryData && categoryData.items.length > 0) {
          const randomIndex = Math.floor(Math.random() * categoryData.items.length);
          const selectedItem = categoryData.items[randomIndex];
          player.characteristics[randomKey].value = selectedItem.value;
          player.characteristics[randomKey].description = selectedItem.description || null;
          console.log(`🔄 Перезапуск: ${randomKey}`);
        }
      }
    }
  });
  sendPlayersUpdate();
}

function handleConfession(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 1 || !characteristic) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics || !player.characteristics[characteristic]) return;
  player.characteristics[characteristic].revealed = true;
  console.log(`📖 Исповедь: раскрыта ${characteristic}`);
  sendPlayersUpdate();
}

function handleGeneTherapy(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 1 || !characteristic) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  if (characteristic === 'health' || characteristic === 'fobia') {
    const categoryData = propertiesData.propertiesCategory.find(cat => cat.category === characteristic);
    if (categoryData && categoryData.items.length > 0) {
      const randomIndex = Math.floor(Math.random() * categoryData.items.length);
      const selectedItem = categoryData.items[randomIndex];
      const wasRevealed = player.characteristics[characteristic] ? player.characteristics[characteristic].revealed : false;
      player.characteristics[characteristic] = {
        value: selectedItem.value,
        description: selectedItem.description || null,
        experience: selectedItem.experience || null,
        revealed: wasRevealed
      };
      console.log(`🧬 Генная терапия: ${characteristic}`);
    }
  }
  sendPlayersUpdate();
}

function handleLegacy(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  console.log(`🏛️ Наследие установлено`);
  sendPlayersUpdate();
}

function handleReligiousFanaticism(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  player.hasProphetPower = true;
  console.log(`✝️ Религиозный фанатизм активирован`);
  sendPlayersUpdate();
}

function handleExperimentalTreatment(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics) return;
  const healed = Math.random() < 0.5;
  if (!healed) {
    const fobiaData = propertiesData.propertiesCategory.find(cat => cat.category === 'fobia');
    if (fobiaData && fobiaData.items.length > 0) {
      const randomIndex = Math.floor(Math.random() * fobiaData.items.length);
      const selectedFobia = fobiaData.items[randomIndex];
      const wasRevealed = player.characteristics.fobia ? player.characteristics.fobia.revealed : false;
      player.characteristics.fobia = {
        value: selectedFobia.value,
        description: selectedFobia.description || null,
        experience: selectedFobia.experience || null,
        revealed: wasRevealed
      };
    }
  }
  console.log(`💊 Экспериментальное лечение: ${healed ? 'вылечен' : 'новая фобия'}`);
  sendPlayersUpdate();
}

function checkVotingComplete() {
  if (votingState.phase !== "voting") return;
  const activePlayers = allPlayers.filter(p => 
    p.readyState === WebSocket.OPEN && 
    p.role !== "host" &&
    p.ready &&
    !bannedPlayers.has(p.id)
  );
  const allVoted = activePlayers.length > 0 && 
    activePlayers.every(p => votingState.votes.has(p.id));
  if (allVoted && activePlayers.length > 0) {
    console.log(`🗳️ Все игроки проголосовали. Подсчитываем результаты...`);
    const candidateVotes = Object.entries(votingState.voteCounts)
      .filter(([playerId]) => votingState.candidates.has(playerId));
    const maxVotes = candidateVotes.length > 0 
      ? Math.max(...candidateVotes.map(([, count]) => count), 0)
      : 0;
    if (maxVotes === 0) {
      votingState.phase = null;
      votingState.candidates.clear();
      const allConnections = [...allPlayers, host];
      const allVotingResults = Array.from(votingState.candidates)
        .map(candidateId => {
          const player = allConnections.find(p => p && p.id === candidateId);
          return player ? { id: candidateId, name: player.name, votes: 0 } : null;
        })
        .filter(p => p !== null)
        .sort((a, b) => b.votes - a.votes);
      const historyEntry = { timestamp: Date.now(), results: allVotingResults, candidates: [] };
      votingHistory.push(historyEntry);
      broadcast({
        type: "voting_completed",
        message: "Голосование на вылет завершено. Никто не получил голосов.",
        candidates: [],
        allResults: allVotingResults
      });
    } else {
      const candidates = Object.entries(votingState.voteCounts)
        .filter(([playerId, count]) => count === maxVotes && votingState.candidates.has(playerId))
        .map(([playerId]) => {
          const allConnections = [...allPlayers, host];
          const player = allConnections.find(p => p && p.id === playerId);
          return player ? { id: playerId, name: player.name, votes: maxVotes } : null;
        })
        .filter(p => p !== null);
      const candidatesList = Array.from(votingState.candidates);
      votingState.phase = null;
      votingState.candidates.clear();
      console.log(`🗳️ Результаты голосования: ${candidates.length} кандидат(ов) с ${maxVotes} голос(ами)`);
      const allConnections = [...allPlayers, host];
      const allVotingResults = candidatesList
        .map(candidateId => {
          const player = allConnections.find(p => p && p.id === candidateId);
          return player ? {
            id: candidateId,
            name: player.name,
            votes: votingState.voteCounts[candidateId] || 0
          } : null;
        })
        .filter(p => p !== null)
        .sort((a, b) => b.votes - a.votes);
      const historyEntry = { timestamp: Date.now(), results: allVotingResults, candidates: candidates };
      votingHistory.push(historyEntry);
      let resultMessage = "Голосование на вылет завершено. ";
      if (maxVotes === 0) {
        resultMessage += "Никто не получил голосов.";
      } else if (candidates.length === 1) {
        resultMessage += `Кандидат на вылет: ${candidates[0].name} (${maxVotes} голос(ов)).`;
      } else if (candidates.length > 1) {
        resultMessage += `Кандидаты на вылет: ${candidates.map(c => `${c.name} (${c.votes} голос(ов))`).join(', ')}.`;
      }
      broadcast({
        type: "voting_completed",
        message: resultMessage,
        candidates: candidates,
        allResults: allVotingResults
      });
      if (candidates.length > 1) {
        const hostConnection = allPlayers.find(p => p.role === "host" && p.readyState === WebSocket.OPEN) || host;
        if (hostConnection) {
          hostConnection.send(JSON.stringify({
            type: "voting_tie",
            message: "Несколько игроков получили одинаковое количество голосов",
            candidates: candidates,
            allResults: allVotingResults
          }));
        }
      } else if (candidates.length === 1) {
        bannedPlayers.add(candidates[0].id);
        console.log(`🚪 Игрок ${candidates[0].name} изгнан по результатам голосования`);
        sendPlayersUpdate();
      }
    }
    votingState.votes.clear();
    votingState.voteCounts = {};
    sendPlayersUpdate();
  }
}

function checkAllReady() {
  const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
  const activeHost = host && host.readyState === WebSocket.OPEN ? host : null;
  if (!activeHost || !activeHost.ready) {
    if (gameState.started) {
      gameState.started = false;
      gameState.startTime = null;
      gameState.ready = false;
    }
    return;
  }
  const playersList = [...activePlayers, activeHost];
  const allReady = playersList.length > 1 && playersList.every((p) => p.ready);
  if (allReady && !gameState.started) {
    gameState.started = true;
    gameState.startTime = Date.now();
    gameState.ready = false;
    gameState.currentRound = 0;
    console.log("🎮 Игра началась! Генерируем карты и устанавливаем WebRTC соединения...");
    generateAllPlayerCards();
    broadcast({ 
      type: "game_started",
      message: "Игра начинается! Карты сгенерированы, устанавливаем видеосвязь..."
    });
    sendPlayersUpdate();
    setTimeout(() => {
      broadcast({
        type: "game_message", 
        message: "Проверьте видео и аудио соединения"
      });
    }, 3000);
  }
}

// ============================
// Обработка подключений
// ============================
wss.on("connection", async (ws) => {
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  ws.name = null;
  ws.role = "player";
  ws.ready = false;

  log("🔌 Новое подключение:", ws.id);

  ws.send(JSON.stringify({
    type: "welcome",
    yourId: ws.id,
    message: "Подключение установлено"
  }));

  sendPlayersUpdate(true);

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      const requestId = data.requestId;

      // Функция для отправки ответа
      const sendResponse = (response) => {
        if (requestId) {
          ws.send(JSON.stringify({ ...response, requestId }));
        } else {
          ws.send(JSON.stringify(response));
        }
      };

      switch (data.type) {
        // ============================
        // MEDIASOUP ОБРАБОТЧИКИ
        // ============================
        
        case "getRouterRtpCapabilities": {
          const router = await getOrCreateRouter(data.roomId || 'default');
          sendResponse({
            type: "routerRtpCapabilities",
            rtpCapabilities: router.rtpCapabilities
          });
          break;
        }

        case "createTransport": {
          const { roomId = 'default', direction } = data;
          const router = await getOrCreateRouter(roomId);
          
          const transport = await router.createWebRtcTransport({
            listenIps: [
              { ip: '0.0.0.0', announcedIp: '87.228.76.59' } // Замените на ваш IP
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 2_500_000
          });

          if (!clientMediasoup.has(ws.id)) {
            clientMediasoup.set(ws.id, { 
              router, 
              transports: new Map(), 
              producer: null, 
              consumers: new Map() 
            });
          }
          
          const clientData = clientMediasoup.get(ws.id);
          clientData.transports.set(direction, transport);

          transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
              transport.close();
            }
          });

          sendResponse({
            type: "transportCreated",
            direction,
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
          });
          break;
        }

        case "connectTransport": {
          const { direction, dtlsParameters } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has(direction)) {
            sendResponse({ type: "error", message: "Transport не найден" });
            return;
          }

          const transport = clientData.transports.get(direction);
          await transport.connect({ dtlsParameters });
          
          sendResponse({ type: "transportConnected", direction });
          break;
        }

        case "createProducer": {
          const { roomId = 'default', kind, rtpParameters } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has('send')) {
            sendResponse({ type: "error", message: "Send transport не найден" });
            return;
          }

          const transport = clientData.transports.get('send');
          const producer = await transport.produce({ kind, rtpParameters });
          
          clientData.producer = producer;
          
          const room = rooms.get(roomId);
          if (room) {
            room.producers.set(ws.id, producer);
          }

          // Уведомляем всех остальных клиентов о новом producer
          const allConnections = [...allPlayers, host].filter(p => p && p.id !== ws.id && p.readyState === WebSocket.OPEN);
          allConnections.forEach(client => {
            client.send(JSON.stringify({
              type: "newProducer",
              producerId: producer.id,
              playerId: ws.id,
              kind: kind
            }));
          });

          sendResponse({ type: "producerCreated", id: producer.id });
          break;
        }

        case "createConsumer": {
          const { roomId = 'default', producerId, rtpCapabilities } = data;
          const clientData = clientMediasoup.get(ws.id);
          
          if (!clientData || !clientData.transports.has('recv')) {
            sendResponse({ type: "error", message: "Recv transport не найден" });
            return;
          }

          const router = clientData.router;
          const transport = clientData.transports.get('recv');
          
          if (!router.canConsume({ producerId, rtpCapabilities })) {
            sendResponse({ type: "error", message: "Несовместимые capabilities" });
            return;
          }

          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: false
          });

          clientData.consumers.set(producerId, consumer);
          
          const room = rooms.get(roomId);
          if (room) {
            room.consumers.set(consumer.id, consumer);
          }

          sendResponse({
            type: "consumerCreated",
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
          });
          break;
        }

        case "getExistingProducers": {
          const room = rooms.get(data.roomId || 'default');
          const producers = [];
          
          if (room) {
            room.producers.forEach((producer, playerId) => {
              if (playerId !== ws.id) {
                producers.push({
                  producerId: producer.id,
                  playerId: playerId
                });
              }
            });
          }
          
          sendResponse({ type: "existingProducers", producers });
          break;
        }

        case "resumeConsumer": {
          const clientData = clientMediasoup.get(ws.id);
          if (!clientData) {
            sendResponse({ type: "error", message: "Клиент не найден" });
            return;
          }
          
          let targetConsumer = null;
          for (const consumer of clientData.consumers.values()) {
            if (consumer.id === data.consumerId) {
              targetConsumer = consumer;
              break;
            }
          }
          
          if (targetConsumer) {
            await targetConsumer.resume();
            sendResponse({ type: "consumerResumed", consumerId: data.consumerId });
          } else {
            sendResponse({ type: "error", message: "Consumer не найден" });
          }
          break;
        }

        // ============================
        // ОБРАБОТЧИКИ ИГРЫ ИЗ WEBSOCKET.JS
        // ============================
        
        case "join_admin_panel": {
          if (adminPanel && adminPanel.readyState === WebSocket.OPEN) {
            sendResponse({ type: "error", message: "Админ-панель уже занята" });
            return;
          }
          ws.role = "admin_panel";
          ws.name = "admin_panel";
          adminPanel = ws;
          console.log(`🎛️ Подключение к админ-панели`);
          sendResponse({ type: "joined_as_admin", id: ws.id, message: "Подключение к админ-панели установлено" });
          sendPlayersUpdate();
          break;
        }

        case "join": {
          const nickname = (data.name || "").trim();
          if (!nickname) {
            sendResponse({ type: "error", message: "Введите никнейм" });
            return;
          }
          if (nickname.length > 24) {
            sendResponse({ type: "error", message: "Никнейм слишком длинный" });
            return;
          }
          if (ws.name) {
            if (ws.name !== nickname) {
              ws.name = nickname;
              sendPlayersUpdate();
            }
            return;
          }
          const activePlayers = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
          const existingPlayer = activePlayers.find(p => p.name && p.name.toLowerCase() === nickname.toLowerCase());
          if (existingPlayer && existingPlayer.id !== ws.id) {
            sendResponse({ type: "error", message: "Никнейм уже занят" });
            return;
          }
          const disconnectedData = disconnectedPlayers.get(nickname.toLowerCase());
          let isReconnecting = false;
          if (disconnectedData && gameState.started) {
            console.log(`🔄 Игрок ${nickname} переподключается, восстанавливаем данные...`);
            isReconnecting = true;
            ws.name = nickname;
            ws.characteristics = disconnectedData.characteristics ? JSON.parse(JSON.stringify(disconnectedData.characteristics)) : null;
            ws.ready = disconnectedData.ready || false;
            ws.role = disconnectedData.role || "player";
            ws.mirrorCamera = disconnectedData.mirrorCamera || false;
            if (ws.characteristics) {
              markPlayerCardsAsUsed(ws.characteristics);
              console.log(`📝 Карты игрока ${nickname} помечены как использованные`);
            }
            disconnectedPlayers.delete(nickname.toLowerCase());
            console.log(`✅ Данные восстановлены для ${nickname}:`, {
              hasCharacteristics: !!ws.characteristics,
              characteristicsCount: ws.characteristics ? Object.keys(ws.characteristics).length : 0
            });
          } else {
            ws.name = nickname;
          }
          if (["millisana", "host", "ведущий"].includes(nickname.toLowerCase())) {
            if (host && host.readyState === WebSocket.OPEN && host.id !== ws.id) {
              sendResponse({ type: "error", message: "Ведущий уже есть" });
              return;
            }
            ws.role = "host";
            host = ws;
            console.log(`🎙 Ведущий: ${ws.name}${isReconnecting ? ' (переподключение)' : ''}`);
            sendResponse({ type: "joined_as_host", id: ws.id, isReconnecting: isReconnecting });
            if (gameState.started) {
              console.log(`🎮 Ведущий заходит в уже начатую игру`);
              if (!ws.characteristics) {
                console.log(`🎲 Генерируем карты для ведущего (заход во время игры)`);
                ws.characteristics = generatePlayerCharacteristics();
                markPlayerCardsAsUsed(ws.characteristics);
              }
              ws.send(JSON.stringify({ type: "game_started", message: "Игра уже началась, вы присоединяетесь" }));
              ws.ready = true;
              sendPlayersUpdate();
            }
          } else {
            if (!allPlayers.includes(ws)) {
              const activeRegularPlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
              if (activeRegularPlayers.length >= MAX_PLAYERS && !isReconnecting) {
                sendResponse({ type: "error", message: `Лобби заполнено (максимум ${MAX_PLAYERS} игроков)` });
                return;
              }
              allPlayers.push(ws);
            }
            console.log(`👤 Игрок: ${ws.name}${isReconnecting ? ' (переподключение)' : ''}`);
            sendResponse({ type: "joined_as_player", id: ws.id, isReconnecting: isReconnecting });
            if (gameState.started) {
              console.log(`🎮 Игрок ${ws.name} заходит в уже начатую игру`);
              if (!ws.characteristics) {
                console.log(`🎲 Генерируем карты для игрока ${ws.name} (заход во время игры)`);
                ws.characteristics = generatePlayerCharacteristics();
                markPlayerCardsAsUsed(ws.characteristics);
                sendPlayersUpdate();
              }
              if (gameState.ready) {
                ws.send(JSON.stringify({ type: "game_ready", message: "Игра уже готова, присоединяйтесь" }));
              } else {
                ws.send(JSON.stringify({ type: "game_started", message: "Игра уже началась, вы можете присоединиться" }));
              }
            }
          }
          sendPlayersUpdate();
          broadcast({ type: "new_player_joined", playerId: ws.id, playerName: ws.name }, ws);
          break;
        }

        case "set_ready": {
          if (!ws.name) {
            sendResponse({ type: "error", message: "Сначала введите никнейм" });
            return;
          }
          ws.ready = data.ready;
          console.log(`✅ ${ws.name}: ${data.ready ? 'готов' : 'не готов'}`);
          sendResponse({ type: "ready_status", ready: data.ready });
          if (data.ready && gameState.started) {
            console.log(`🎮 Игрок ${ws.name} готов и игра уже началась - отправляем состояние`);
            if (gameState.ready) {
              ws.send(JSON.stringify({ type: "game_ready", message: "Игра уже готова" }));
            } else {
              ws.send(JSON.stringify({ type: "game_started", message: "Игра уже началась" }));
            }
          }
          sendPlayersUpdate();
          checkAllReady();
          break;
        }

        case "get_lobby_state": {
          sendPlayersUpdate();
          break;
        }

        case "chat_message": {
          if (data.message) {
            broadcast({
              type: "chat_message",
              from: ws.id,
              fromName: ws.name,
              message: data.message,
              timestamp: Date.now()
            }, ws);
          }
          break;
        }

        case "get_player_cards": {
          const targetPlayerId = data.playerId;
          const allConnections = [...allPlayers, host];
          const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId && p.readyState === WebSocket.OPEN);
          if (targetPlayer && targetPlayer.characteristics) {
            sendResponse({
              type: "player_cards",
              playerId: targetPlayerId,
              playerName: targetPlayer.name,
              cards: targetPlayer.characteristics
            });
          } else {
            sendResponse({ type: "error", message: "Карты игрока не найдены" });
          }
          break;
        }

        case "reveal_characteristic": {
          const targetPlayerId = data.playerId;
          const characteristicType = data.characteristicType;
          const allConnections = [...allPlayers, host];
          const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId && p.readyState === WebSocket.OPEN);
          if (targetPlayer && targetPlayer.characteristics && targetPlayer.characteristics[characteristicType]) {
            targetPlayer.characteristics[characteristicType].revealed = true;
            broadcast({
              type: "characteristic_revealed",
              playerId: targetPlayerId,
              playerName: targetPlayer.name,
              characteristicType: characteristicType,
              characteristic: targetPlayer.characteristics[characteristicType]
            });
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Характеристика не найдена" });
          }
          break;
        }

        case "execute_action_card": {
          const actionType = data.actionType;
          const parameters = data.parameters;
          const allConnections = [...allPlayers, host];
          console.log(`⚡ Выполняется карта действия: ${actionType}`);
          handleActionCard(actionType, parameters, allConnections);
          break;
        }

        case "toggle_ban_player": {
          if (ws.role === "host") {
            const targetPlayerId = data.playerId;
            const allConnections = [...allPlayers, host];
            const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);
            if (targetPlayer && bannedPlayers.has(targetPlayerId)) {
              bannedPlayers.delete(targetPlayerId);
              console.log(`✅ Игрок ${targetPlayer.name} возвращен в игру`);
            } else if (targetPlayer) {
              bannedPlayers.add(targetPlayerId);
              console.log(`🚫 Игрок ${targetPlayer.name} изгнан`);
            }
            broadcast({
              type: "player_banned",
              playerId: targetPlayerId,
              banned: bannedPlayers.has(targetPlayerId)
            });
            sendPlayersUpdate();
          }
          break;
        }

        case "kick_player": {
          if (ws.role === "admin_panel" || ws.role === "host") {
            const targetPlayerId = data.playerId;
            const allConnections = [...allPlayers, host].filter(Boolean);
            const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);
            if (!targetPlayer) {
              sendResponse({ type: "error", message: "Игрок не найден" });
              break;
            }
            if (targetPlayer.role === "host") {
              sendResponse({ type: "error", message: "Нельзя кикнуть ведущего" });
              break;
            }
            try {
              if (targetPlayer.readyState === WebSocket.OPEN) {
                targetPlayer.send(JSON.stringify({ type: "kicked", message: "Вы были кикнуты администратором. Вы можете переподключиться." }));
              }
            } catch (e) {
              console.warn("⚠️ Не удалось отправить уведомление о кике:", e);
            }
            try {
              targetPlayer.close(4000, "Kicked by admin");
            } catch (_) {}
            broadcast({
              type: "player_kicked",
              playerId: targetPlayerId,
              playerName: targetPlayer.name
            });
            sendPlayersUpdate();
          }
          break;
        }

        case "set_mirror_camera": {
          if (!ws.name) {
            sendResponse({ type: "error", message: "Сначала введите никнейм" });
            return;
          }
          ws.mirrorCamera = data.mirror || false;
          console.log(`🪞 ${ws.name}: зеркалирование ${ws.mirrorCamera ? 'включено' : 'выключено'}`);
          sendPlayersUpdate();
          break;
        }

        case "game_ready": {
          if (ws.role === "host") {
            console.log("✅ Админ нажал 'Начать', игра готова!");
            gameState.ready = true;
            broadcast({ type: "game_ready", message: "Игра готова к началу" });
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может начать игру" });
          }
          break;
        }

        case "set_total_rounds": {
          if (ws.role === "host" || ws.role === "admin_panel") {
            const newTotalRounds = parseInt(data.totalRounds) || 5;
            if (newTotalRounds < 1) {
              sendResponse({ type: "error", message: "Количество раундов должно быть больше 0" });
              return;
            }
            gameState.totalRounds = newTotalRounds;
            console.log(`🎯 Количество раундов установлено: ${newTotalRounds}`);
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий или админ-панель могут устанавливать количество раундов" });
          }
          break;
        }

        case "change_round": {
          if (ws.role === "host" || ws.role === "admin_panel") {
            const newRound = parseInt(data.round) || 1;
            if (newRound < 1 || newRound > gameState.totalRounds) {
              sendResponse({ type: "error", message: `Раунд должен быть от 1 до ${gameState.totalRounds}` });
              return;
            }
            gameState.currentRound = newRound;
            console.log(`🔄 Раунд изменен на: ${newRound}`);
            if (highlightedPlayerId) {
              highlightedPlayerId = null;
              console.log(`🔄 Зеленая рамка сброшена при смене раунда`);
            }
            if (votingState.phase !== null) {
              votingState.phase = null;
              votingState.candidates.clear();
              votingState.votes.clear();
              votingState.voteCounts = {};
              console.log(`🔄 Голосование сброшено при смене раунда`);
            }
            console.log(`📤 Отправляем round_changed всем клиентам: раунд ${newRound}`);
            broadcast({
              type: "round_changed",
              round: newRound,
              totalRounds: gameState.totalRounds
            });
            console.log(`✅ round_changed отправлен`);
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий или админ-панель могут переключать раунд" });
          }
          break;
        }

        case "start_voting_selection": {
          if (ws.role === "host") {
            if (votingState.phase !== null) {
              sendResponse({ type: "error", message: "Голосование уже активно" });
              return;
            }
            const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN && p.role !== "host" && !bannedPlayers.has(p.id));
            if (activePlayers.length < 2) {
              sendResponse({ type: "error", message: "Для голосования нужно минимум 2 игрока" });
              return;
            }
            votingState.phase = "selection";
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            console.log(`🗳️ Начался этап выбора кандидатов для голосования`);
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может начать выбор кандидатов" });
          }
          break;
        }

        case "set_voting_candidates": {
          if (ws.role === "host") {
            if (votingState.phase !== "selection") {
              sendResponse({ type: "error", message: "Этап выбора кандидатов не активен" });
              return;
            }
            const candidates = data.candidates || [];
            if (!Array.isArray(candidates)) {
              sendResponse({ type: "error", message: "Неверный формат списка кандидатов" });
              return;
            }
            const allConnections = [...allPlayers, host];
            const validCandidates = candidates.filter(candidateId => {
              const player = allConnections.find(p => p && p.id === candidateId);
              return player && player.role !== "host" && !bannedPlayers.has(candidateId);
            });
            votingState.candidates = new Set(validCandidates);
            console.log(`🗳️ Хост выбрал ${validCandidates.length} кандидатов для голосования`);
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может выбрать кандидатов" });
          }
          break;
        }

        case "confirm_voting_candidates": {
          if (ws.role === "host") {
            if (votingState.phase !== "selection") {
              sendResponse({ type: "error", message: "Этап выбора кандидатов не активен" });
              return;
            }
            if (votingState.candidates.size < 1) {
              sendResponse({ type: "error", message: "Выберите хотя бы одного кандидата" });
              return;
            }
            votingState.phase = "voting";
            votingState.votes.clear();
            votingState.voteCounts = {};
            console.log(`🗳️ Голосование началось с ${votingState.candidates.size} кандидатами`);
            broadcast({
              type: "voting_started",
              message: "Началось голосование на вылет",
              candidates: Array.from(votingState.candidates)
            });
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может подтвердить кандидатов" });
          }
          break;
        }

        case "cancel_voting": {
          if (ws.role === "host") {
            if (votingState.phase === null) {
              sendResponse({ type: "error", message: "Голосование не активно" });
              return;
            }
            votingState.phase = null;
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            console.log(`🗳️ Голосование на вылет отменено`);
            broadcast({ type: "voting_cancelled", message: "Голосование на вылет отменено ведущим" });
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может отменить голосование" });
          }
          break;
        }

        case "vote_to_kick": {
          if (votingState.phase !== "voting") {
            sendResponse({ type: "error", message: "Голосование не активно" });
            return;
          }
          if (ws.role === "host") {
            sendResponse({ type: "error", message: "Хост не может голосовать" });
            return;
          }
          if (bannedPlayers.has(ws.id)) {
            sendResponse({ type: "error", message: "Изгнанные игроки не могут голосовать" });
            return;
          }
          const targetPlayerId = data.targetPlayerId;
          if (!targetPlayerId) {
            sendResponse({ type: "error", message: "Не указан ID игрока" });
            return;
          }
          if (!votingState.candidates.has(targetPlayerId)) {
            sendResponse({ type: "error", message: "Этот игрок не выставлен на голосование" });
            return;
          }
          if (votingState.votes.has(ws.id)) {
            sendResponse({ type: "error", message: "Вы уже проголосовали" });
            return;
          }
          const allConnections = [...allPlayers, host];
          const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);
          if (!targetPlayer || bannedPlayers.has(targetPlayerId)) {
            sendResponse({ type: "error", message: "Неверный игрок для голосования" });
            return;
          }
          votingState.votes.set(ws.id, targetPlayerId);
          if (!votingState.voteCounts[targetPlayerId]) {
            votingState.voteCounts[targetPlayerId] = 0;
          }
          votingState.voteCounts[targetPlayerId]++;
          console.log(`🗳️ ${ws.name} проголосовал за вылет ${targetPlayer.name}`);
          sendPlayersUpdate();
          checkVotingComplete();
          break;
        }

        case "toggle_player_highlight": {
          if (ws.role === "host") {
            const targetPlayerId = data.playerId;
            if (!targetPlayerId) {
              sendResponse({ type: "error", message: "Не указан ID игрока" });
              return;
            }
            if (highlightedPlayerId === targetPlayerId) {
              highlightedPlayerId = null;
              console.log(`🟢 Зеленая рамка сброшена для игрока ${targetPlayerId}`);
            } else {
              highlightedPlayerId = targetPlayerId;
              console.log(`🟢 Зеленая рамка установлена для игрока ${targetPlayerId}`);
            }
            sendPlayersUpdate();
          } else {
            sendResponse({ type: "error", message: "Только ведущий может управлять выделением игроков" });
          }
          break;
        }

        case "reset_game": {
          if (ws.role === "admin_panel" || ws.role === "host") {
            console.log("🔄 Админ сбрасывает игру...");
            gameState.started = false;
            gameState.startTime = null;
            gameState.ready = false;
            gameState.currentRound = 0;
            highlightedPlayerId = null;
            votingState.phase = null;
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            votingHistory = [];
            allPlayers.forEach(p => {
              p.ready = false;
              p.characteristics = null;
            });
            if (host) {
              host.ready = false;
              host.characteristics = null;
            }
            disconnectedPlayers.clear();
            console.log("🗑️ Данные отключенных игроков очищены");
            usedCards = {};
            console.log("🗑️ Список использованных карт очищен");
            broadcast({
              type: "game_reset",
              message: "Игра сброшена, все карты очищены"
            });
            sendPlayersUpdate();
            console.log("✅ Игра успешно сброшена");
          }
          break;
        }
        
        default:
          sendResponse({ type: "error", message: "Неизвестная команда" });
      }
    } catch (error) {
      logError("❌ Ошибка обработки сообщения:", error);
      ws.send(JSON.stringify({ type: "error", message: "Ошибка сервера" }));
    }
  });

  ws.on("close", () => {
    log(`❌ Отключился: ${ws.name || 'Unknown'} (${ws.role})`);
    
    // Закрываем все mediasoup соединения
    const clientData = clientMediasoup.get(ws.id);
    if (clientData) {
      if (clientData.producer) {
        clientData.producer.close();
        // Удаляем из комнаты
        const room = rooms.get('default');
        if (room) {
          room.producers.delete(ws.id);
        }
      }
      clientData.consumers.forEach(consumer => consumer.close());
      clientData.consumers.clear();
      clientData.transports.forEach(transport => transport.close());
      clientMediasoup.delete(ws.id);
    }
    
    // Сохраняем данные игрока для переподключения
    if (ws.name && gameState.started && ws.role !== "admin_panel") {
      disconnectedPlayers.set(ws.name.toLowerCase(), {
        characteristics: ws.characteristics ? JSON.parse(JSON.stringify(ws.characteristics)) : null,
        ready: ws.ready || false,
        role: ws.role || "player",
        id: ws.id,
        mirrorCamera: ws.mirrorCamera || false,
        disconnectedAt: Date.now()
      });
      console.log(`💾 Данные игрока ${ws.name} сохранены для возможного переподключения`);
    }
    
    if (ws.role === "player") {
      allPlayers = allPlayers.filter((p) => p !== ws);
    } else if (ws.role === "host") {
      host = null;
      broadcast({ 
        type: "host_left",
        message: "Ведущий вышел из игры"
      });
    } else if (ws.role === "admin_panel") {
      adminPanel = null;
      console.log(`🎛️ Админ-панель освобождена`);
    }

    if (ws.role !== "admin_panel") {
      broadcast({
        type: "player_left",
        playerId: ws.id,
        playerName: ws.name
      });
      sendPlayersUpdate();
    }
  });

  ws.on("error", (error) => {
    logError(`💥 Ошибка: ${ws.name || ws.id}`, error);
  });
});

// Инициализация
createWorkers().then(() => {
  console.log("🚀 Mediasoup SFU готов!");
  console.log("🚀 Сервер 'Бункер' готов для 8 игроков с SFU!");
});

console.log("⏳ Инициализация Mediasoup...");

