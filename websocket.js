// server.js
const WebSocket = require("ws");
const propertiesData = require("./properties.json");

const wss = new WebSocket.Server({ port: 5000 }, () =>
  console.log("✅ Сервер запущен на порту 5000")
);

const MAX_PLAYERS = 8; // Увеличил до 8
let allPlayers = [];
let host = null;
let adminPanel = null; // Отдельное подключение для админ-панели
let gameState = { 
  started: false, 
  startTime: null, 
  ready: false, // ready - админ нажал "Начать"
  currentRound: 0,
  totalRounds: 5 // По умолчанию 5 раундов
};
let bannedPlayers = new Set(); // Set из ID изгнанных игроков
let highlightedPlayerId = null; // ID игрока с зеленой рамкой (может быть только один)
let disconnectedPlayers = new Map(); // Map: nickname -> {characteristics, id, role}
let usedCards = {}; // Map: category -> Set of used card values (для отслеживания уникальных карт)
let votingState = {
  phase: null, // null | "selection" | "voting" - этап голосования
  candidates: new Set(), // Set из ID игроков, выставленных на голосование
  votes: new Map(), // Map: voterId -> targetPlayerId (кто за кого проголосовал)
  voteCounts: {} // Объект: targetPlayerId -> количество голосов
};
let votingHistory = []; // История голосований: [{timestamp, results: [{playerId, name, votes}]}]

// ============================
// 🎲 Генерация случайных характеристик игрока (без повторений)
// ============================
function generatePlayerCharacteristics() {
  const characteristics = {};
  
  // Список категорий для генерации
  const categories = ['bandage', 'actions', 'fact', 'fobia', 'health', 'hobbie', 'age', 'proffesion'];
  
  categories.forEach(category => {
    const categoryData = propertiesData.propertiesCategory.find(cat => cat.category === category);
    if (categoryData && categoryData.items.length > 0) {
      // Инициализируем Set для категории, если его еще нет
      if (!usedCards[category]) {
        usedCards[category] = new Set();
      }
      
      // Получаем доступные карты (неиспользованные)
      const availableItems = categoryData.items.filter(item => !usedCards[category].has(item.value));
      
      if (availableItems.length === 0) {
        // Если все карты использованы, логируем предупреждение и сбрасываем счетчик для этой категории
        console.warn(`⚠️ Все карты категории ${category} использованы! Сбрасываем...`);
        usedCards[category] = new Set();
        // Используем все доступные карты заново
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
        // Выбираем случайную карту из доступных
        const randomIndex = Math.floor(Math.random() * availableItems.length);
        const selectedItem = availableItems[randomIndex];
        
        // Помечаем карту как использованную
        usedCards[category].add(selectedItem.value);
        
        characteristics[category] = {
          value: selectedItem.value,
          description: selectedItem.description || null,
          experience: selectedItem.experience || null,
          revealed: false // По умолчанию все характеристики скрыты
        };
      }
    }
  });
  
  return characteristics;
}

// ============================
// 📝 Помечает карты игрока как использованные
// ============================
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

// ============================
// 🎯 Генерация карт для всех игроков при старте игры
// ============================
function generateAllPlayerCards() {
  console.log("🎲 Генерируем карты для всех игроков...");
  
  // Сбрасываем список использованных карт перед новой генерацией
  usedCards = {};
  
  // Генерируем карты для обычных игроков
  allPlayers.forEach(player => {
    if (player.readyState === WebSocket.OPEN && !player.characteristics) {
      player.characteristics = generatePlayerCharacteristics();
      console.log(`📋 Карты для ${player.name}:`, Object.keys(player.characteristics));
    } else if (player.characteristics) {
      // Если у игрока уже есть карты (при переподключении), помечаем их как использованные
      markPlayerCardsAsUsed(player.characteristics);
    }
  });
  
  // Генерируем карты для ведущего
  if (host && host.readyState === WebSocket.OPEN) {
    if (!host.characteristics) {
      host.characteristics = generatePlayerCharacteristics();
      console.log(`📋 Карты для ведущего ${host.name}:`, Object.keys(host.characteristics));
    } else {
      // Если у хоста уже есть карты (при переподключении), помечаем их как использованные
      markPlayerCardsAsUsed(host.characteristics);
    }
  }
}

// ============================
// ⚡ Обработка карт действий
// ============================
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

// Обмен судьбами - меняются все открытые характеристики
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
  
  // Меняем только открытые характеристики
  const categories = ['bandage', 'actions', 'fact', 'fobia', 'health', 'hobbie', 'age', 'proffesion'];
  
  categories.forEach(category => {
    const char1 = player1.characteristics[category];
    const char2 = player2.characteristics[category];
    
    if (char1 && char2 && char1.revealed && char2.revealed) {
      // Обмен значениями
      const tempValue = char1.value;
      char1.value = char2.value;
      char2.value = tempValue;
      
      console.log(`🔄 Обмен ${category}: ${char2.value} <-> ${char1.value}`);
    }
  });
  
  // Отправляем обновление всем клиентам
  sendPlayersUpdate();
}

// Сброс здоровья - всем игрокам нужно вытянуть новое здоровье
function handleHealthReset(allConnections) {
  allConnections.forEach(player => {
    if (player && player.characteristics && player.characteristics.health) {
      // Получаем новое случайное здоровье
      const healthData = propertiesData.propertiesCategory.find(cat => cat.category === 'health');
      
      if (healthData && healthData.items.length > 0) {
        const randomIndex = Math.floor(Math.random() * healthData.items.length);
        const selectedHealth = healthData.items[randomIndex];
        
        // Сохраняем статус revealed
        const wasRevealed = player.characteristics.health.revealed;
        
        player.characteristics.health = {
          value: selectedHealth.value,
          description: selectedHealth.description || null,
          experience: selectedHealth.experience || null,
          revealed: wasRevealed // Сохраняем статус раскрытия
        };
        
        console.log(`🏥 Новое здоровье для ${player.name}: ${selectedHealth.value} (раскрыто: ${wasRevealed})`);
      }
    }
  });
  
  // Отправляем обновление всем клиентам
  sendPlayersUpdate();
}

// Выборочный обмен - обменяй одну характеристику с любым игроком
function handleSelectiveExchange(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 2 || !characteristic) {
    console.error("❌ Выборочный обмен требует двух игроков и характеристику");
    return;
  }
  
  const [player1Id, player2Id] = playerIds;
  const player1 = allConnections.find(p => p && p.id === player1Id);
  const player2 = allConnections.find(p => p && p.id === player2Id);
  
  if (!player1 || !player2 || !player1.characteristics || !player2.characteristics) {
    return;
  }
  
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

// Подозрение - один игрок раскрывает случайную закрытую характеристику
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

// Проверка досье - посмотреть одну закрытую характеристику
function handleDossierCheck(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 1 || !characteristic) return;
  console.log(`📋 Проверка досье игрока ${playerIds[0]}, характеристика: ${characteristic}`);
  sendPlayersUpdate();
}

// Атака на репутацию - игрок теряет право говорить
function handleReputationAttack(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  
  player.muted = true;
  console.log(`🔇 Игрок ${player.name} потерял право говорить`);
  
  sendPlayersUpdate();
}

// Реинкарнация - изменить возраст
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

// Переквалификация - заменить профессию
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

// Фобия исчезла - избавиться от фобии
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

// Второй шанс - вернуть изгнанного игрока
function handleSecondChance(playerIds, allConnections) {
  console.log(`🔄 Второй шанс используется`);
  sendPlayersUpdate();
}

// Иммунитет - нельзя быть изгнанным
function handleImmunity(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  
  player.immune = true;
  console.log(`🛡️ Игрок ${player.name} получил иммунитет`);
  
  sendPlayersUpdate();
}

// Тайное знание - посмотреть одну характеристику
function handleSecretKnowledge(playerIds, characteristic, allConnections) {
  console.log(`🔮 Тайное знание`);
  sendPlayersUpdate();
}

// Перезапуск - каждый игрок сбрасывает одну открытую характеристику
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

// Исповедь - игрок сам раскрывает характеристику
function handleConfession(playerIds, characteristic, allConnections) {
  if (!playerIds || playerIds.length !== 1 || !characteristic) return;
  
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player || !player.characteristics || !player.characteristics[characteristic]) return;
  
  player.characteristics[characteristic].revealed = true;
  console.log(`📖 Исповедь: раскрыта ${characteristic}`);
  
  sendPlayersUpdate();
}

// Генная терапия - поменять здоровье или фобию
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

// Наследие - профессия переходит к игроку справа
function handleLegacy(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  console.log(`🏛️ Наследие установлено`);
  sendPlayersUpdate();
}

// Религиозный фанатизм - можно отменить одно решение голосования
function handleReligiousFanaticism(playerIds, allConnections) {
  if (!playerIds || playerIds.length !== 1) return;
  
  const player = allConnections.find(p => p && p.id === playerIds[0]);
  if (!player) return;
  
  player.hasProphetPower = true;
  console.log(`✝️ Религиозный фанатизм активирован`);
  
  sendPlayersUpdate();
}

// Экспериментальное лечение
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

// ============================
// 📡 Функция отправки всем клиентам
// ============================
function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  const clients = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
  
  clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch (error) {
        console.error("❌ Ошибка отправки:", error);
      }
    }
  });
}

// ============================
// 🔁 Отправка актуального списка игроков всем
// ============================
function sendPlayersUpdate() {
  const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
  const activeHost = host && host.readyState === WebSocket.OPEN ? host : null;

  const playersList = [...activePlayers];
  if (activeHost) {
    playersList.push(activeHost);
  }

  const readyCount = playersList.filter((p) => p.ready).length;
  const totalPlayers = playersList.length;

  console.log("📤 Игроков онлайн:", activePlayers.length, "Готовых:", readyCount);

  // Отправляем обновление всем: игрокам, ведущему и админ-панели (если подключена)
  const allConnections = [...playersList];
  if (adminPanel && adminPanel.readyState === WebSocket.OPEN) {
    adminPanel.send(JSON.stringify({
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
      votingPhase: votingState.phase, // "selection" | "voting" | null
      votingCandidates: Array.from(votingState.candidates), // Массив ID кандидатов
      votedPlayers: Array.from(votingState.votes.keys()), // Список ID проголосовавших игроков
      voteCounts: votingState.voteCounts // Результаты голосования
    }));
  }

  broadcast({
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
      votingPhase: votingState.phase, // "selection" | "voting" | null
      votingCandidates: Array.from(votingState.candidates), // Массив ID кандидатов
      votedPlayers: Array.from(votingState.votes.keys()), // Список ID проголосовавших игроков
      voteCounts: votingState.voteCounts // Результаты голосования
  });
}

// ============================
// 🗳️ Проверка завершения голосования
// ============================
function checkVotingComplete() {
  if (votingState.phase !== "voting") return;
  
  const activePlayers = allPlayers.filter(p => 
    p.readyState === WebSocket.OPEN && 
    p.role !== "host" &&
    p.ready &&
    !bannedPlayers.has(p.id) // Исключаем изгнанных игроков
  );
  
  // Если только один кандидат, исключаем его из списка тех, кто должен голосовать
  // (так как его голос не учитывается)
  const votersToCheck = votingState.candidates.size === 1
    ? activePlayers.filter(p => !votingState.candidates.has(p.id))
    : activePlayers;
  
  // Все активные игроки (кроме единственного кандидата, если он один) проголосовали
  const allVoted = votersToCheck.length > 0 && 
    votersToCheck.every(p => votingState.votes.has(p.id));
  
  if (allVoted && votersToCheck.length > 0) {
    console.log(`🗳️ Все игроки проголосовали. Подсчитываем результаты...`);
    
    // Находим максимальное количество голосов (только среди кандидатов)
    const candidateVotes = Object.entries(votingState.voteCounts)
      .filter(([playerId]) => votingState.candidates.has(playerId));
    const maxVotes = candidateVotes.length > 0 
      ? Math.max(...candidateVotes.map(([, count]) => count), 0)
      : 0;
    
    // Если только один кандидат, проверяем, был ли он автоматически изгнан
    const isSingleCandidate = votingState.candidates.size === 1;
    
    if (maxVotes === 0 || (isSingleCandidate && maxVotes > 0)) {
      // Никто не получил голосов ИЛИ один кандидат получил голоса (но его голос не учитывался)
      // В случае одного кандидата - переходим к следующему этапу (хост решает)
      if (isSingleCandidate && maxVotes > 0) {
        // Находим единственного кандидата
        const candidateId = Array.from(votingState.candidates)[0];
        const allConnections = [...allPlayers, host];
        const candidate = allConnections.find(p => p && p.id === candidateId);
        
        if (candidate) {
          const candidates = [{
            id: candidateId,
            name: candidate.name,
            votes: maxVotes
          }];
          
          // Собираем полные результаты
          const allVotingResults = candidates.map(c => ({
            id: c.id,
            name: c.name,
            votes: c.votes
          }));
          
          // Сохраняем в историю
          const historyEntry = {
            timestamp: Date.now(),
            results: allVotingResults,
            candidates: candidates
          };
          votingHistory.push(historyEntry);
          
          votingState.phase = null;
          const candidatesList = Array.from(votingState.candidates);
          votingState.candidates.clear();
          
          // Отправляем результаты хосту для принятия решения
          const hostConnection = allPlayers.find(p => p.role === "host" && p.readyState === WebSocket.OPEN) || host;
          if (hostConnection) {
            hostConnection.send(JSON.stringify({
              type: "voting_tie",
              message: `Голосование завершено. Кандидат: ${candidate.name} (${maxVotes} голос(ов)). Ваш голос не учитывался.`,
              candidates: candidates,
              allResults: allVotingResults
            }));
          }
          
          broadcast({
            type: "voting_completed",
            message: `Голосование на вылет завершено. Кандидат: ${candidate.name} (${maxVotes} голос(ов)).`,
            candidates: candidates,
            allResults: allVotingResults
          });
          
          // Сбрасываем голосование
          votingState.votes.clear();
          votingState.voteCounts = {};
          sendPlayersUpdate();
          return;
        }
      }
      
      // Никто не получил голосов
      votingState.phase = null;
      votingState.candidates.clear();
      
      // Собираем полные результаты голосования (только кандидаты)
      const allConnections = [...allPlayers, host];
      const allVotingResults = Array.from(votingState.candidates)
        .map(candidateId => {
          const player = allConnections.find(p => p && p.id === candidateId);
          return player ? {
            id: candidateId,
            name: player.name,
            votes: 0
          } : null;
        })
        .filter(p => p !== null)
        .sort((a, b) => b.votes - a.votes);
      
      // Сохраняем в историю
      const historyEntry = {
        timestamp: Date.now(),
        results: allVotingResults,
        candidates: []
      };
      votingHistory.push(historyEntry);
      
      broadcast({
        type: "voting_completed",
        message: "Голосование на вылет завершено. Никто не получил голосов.",
        candidates: [],
        allResults: allVotingResults
      });
    } else {
      // Находим всех игроков с максимальным количеством голосов (только среди кандидатов)
      const candidates = Object.entries(votingState.voteCounts)
        .filter(([playerId, count]) => count === maxVotes && votingState.candidates.has(playerId))
        .map(([playerId]) => {
          const allConnections = [...allPlayers, host];
          const player = allConnections.find(p => p && p.id === playerId);
          return player ? { id: playerId, name: player.name, votes: maxVotes } : null;
        })
        .filter(p => p !== null);
      
      // Сохраняем список кандидатов до очистки
      const candidatesList = Array.from(votingState.candidates);
      
      votingState.phase = null;
      votingState.candidates.clear();
      
      console.log(`🗳️ Результаты голосования: ${candidates.length} кандидат(ов) с ${maxVotes} голос(ами)`);
      
      // Собираем полные результаты голосования (только кандидаты)
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
      
      // Сохраняем в историю
      const historyEntry = {
        timestamp: Date.now(),
        results: allVotingResults,
        candidates: candidates
      };
      votingHistory.push(historyEntry);
      
      // Формируем сообщение о результатах
      let resultMessage = "Голосование на вылет завершено. ";
      if (maxVotes === 0) {
        resultMessage += "Никто не получил голосов.";
      } else if (candidates.length === 1) {
        resultMessage += `Кандидат на вылет: ${candidates[0].name} (${maxVotes} голос(ов)).`;
      } else if (candidates.length > 1) {
        resultMessage += `Кандидаты на вылет: ${candidates.map(c => `${c.name} (${c.votes} голос(ов))`).join(', ')}.`;
      }
      
      // Отправляем результаты всем
      broadcast({
        type: "voting_completed",
        message: resultMessage,
        candidates: candidates,
        allResults: allVotingResults
      });
      
      // Если несколько кандидатов - хост должен выбрать
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
        // Если один кандидат - автоматически изгоняем
        bannedPlayers.add(candidates[0].id);
        console.log(`🚪 Игрок ${candidates[0].name} изгнан по результатам голосования`);
        sendPlayersUpdate();
      }
    }
    
    // Сбрасываем голосование
    votingState.votes.clear();
    votingState.voteCounts = {};
    sendPlayersUpdate();
  }
}

// ============================
// ✅ Проверяем: все ли готовы, и можно ли стартовать
// ============================
function checkAllReady() {
  const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
  const activeHost = host && host.readyState === WebSocket.OPEN ? host : null;

  if (!activeHost || !activeHost.ready) {
    if (gameState.started) {
      gameState.started = false;
      gameState.startTime = null; // Сбрасываем время если игра была остановлена
      gameState.ready = false; // Сбрасываем готовность
    }
    return;
  }

  const playersList = [...activePlayers, activeHost];
  const allReady = playersList.length > 1 && playersList.every((p) => p.ready);

  if (allReady && !gameState.started) {
    gameState.started = true;
    gameState.startTime = Date.now(); // Запоминаем время начала игры
    gameState.ready = false; // Сбрасываем готовность (админ еще не нажал "Начать")
    gameState.currentRound = 0; // Сбрасываем раунд при начале игры
    console.log("🎮 Игра началась! Генерируем карты и устанавливаем WebRTC соединения...");
    
    // Генерируем карты для всех игроков
    generateAllPlayerCards();
    
    broadcast({ 
      type: "game_started",
      message: "Игра начинается! Карты сгенерированы, устанавливаем видеосвязь..."
    });
    
    // Отправляем обновленные данные игроков с характеристиками
    sendPlayersUpdate();
    
    // Даем время на установку WebRTC соединений
    setTimeout(() => {
      broadcast({
        type: "game_message", 
        message: "Проверьте видео и аудио соединения"
      });
    }, 3000);
  }
}

// ============================
// 🎯 Отправка сообщения конкретному игроку
// ============================
function sendToPlayer(playerId, data) {
  const allConnections = [...allPlayers, host];
  const targetPlayer = allConnections.find(p => p && p.id === playerId && p.readyState === WebSocket.OPEN);
  
  if (targetPlayer) {
    try {
      targetPlayer.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`❌ Ошибка отправки игроку ${playerId}:`, error);
      return false;
    }
  }
  return false;
}

// ============================
// 🧠 Обработка нового подключения
// ============================
wss.on("connection", (ws) => {
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  ws.name = null;
  ws.role = "player";
  ws.ready = false;

  console.log("🔌 Новое подключение:", ws.id);

  // Приветственное сообщение
  ws.send(JSON.stringify({
    type: "welcome",
    yourId: ws.id,
    message: "Подключение установлено"
  }));

  // Отправляем текущее состояние
  sendPlayersUpdate();

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        // 🎛️ Вход в админ-панель (отдельное подключение, не считается игроком)
        case "join_admin_panel": {
          // Проверяем, занята ли админ-панель
          if (adminPanel && adminPanel.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: "Админ-панель уже занята" 
            }));
            return;
          }
          
          // Устанавливаем роль админа
          ws.role = "admin_panel";
          ws.name = "admin_panel";
          adminPanel = ws;
          
          console.log(`🎛️ Подключение к админ-панели`);
          
          ws.send(JSON.stringify({ 
            type: "joined_as_admin", 
            id: ws.id,
            message: "Подключение к админ-панели установлено"
          }));
          
          // Отправляем текущее состояние игры
          sendPlayersUpdate();
          break;
        }

        // 👋 Игрок вошёл
        case "join": {
          const nickname = (data.name || "").trim();
          
          if (!nickname) {
            ws.send(JSON.stringify({ type: "error", message: "Введите никнейм" }));
            return;
          }

          if (nickname.length > 24) {
            ws.send(JSON.stringify({ type: "error", message: "Никнейм слишком длинный" }));
            return;
          }

          // Если у игрока уже есть имя (изменение никнейма)
          if (ws.name) {
            // Проверяем, не занят ли новый никнейм
            const activePlayers = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
            const existingPlayer = activePlayers.find(p => p.name && p.name.toLowerCase() === nickname.toLowerCase() && p.id !== ws.id);
            
            if (existingPlayer) {
              ws.send(JSON.stringify({ type: "error", message: "Никнейм уже занят" }));
              return;
            }
            
            if (ws.name !== nickname) {
              ws.name = nickname;
              sendPlayersUpdate();
            }
            return;
          }

          // 🔄 СНАЧАЛА: Проверяем переподключение (сохраненные данные)
          const disconnectedData = disconnectedPlayers.get(nickname.toLowerCase());
          let isReconnecting = false;
          
          if (disconnectedData && gameState.started) {
            // Восстанавливаем данные игрока при переподключении
            console.log(`🔄 Игрок ${nickname} переподключается, восстанавливаем данные...`);
            isReconnecting = true;
            
            // Сохраняем новый WebSocket, но с восстановленными данными
            ws.name = nickname;
            ws.characteristics = disconnectedData.characteristics ? JSON.parse(JSON.stringify(disconnectedData.characteristics)) : null;
            ws.ready = disconnectedData.ready || false;
            ws.role = disconnectedData.role || "player";
            ws.mirrorCamera = disconnectedData.mirrorCamera || false;
            
            // Помечаем восстановленные карты как использованные, чтобы они не дублировались
            if (ws.characteristics) {
              markPlayerCardsAsUsed(ws.characteristics);
              console.log(`📝 Карты игрока ${nickname} помечены как использованные`);
            }
            
            // Удаляем из списка отключенных
            disconnectedPlayers.delete(nickname.toLowerCase());
            
            console.log(`✅ Данные восстановлены для ${nickname}:`, {
              hasCharacteristics: !!ws.characteristics,
              characteristicsCount: ws.characteristics ? Object.keys(ws.characteristics).length : 0
            });
          } else {
            // Проверка на дубликаты имен среди активных игроков (только если не переподключение)
            const activePlayers = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
            const existingPlayer = activePlayers.find(p => p.name && p.name.toLowerCase() === nickname.toLowerCase());
            
            if (existingPlayer && existingPlayer.id !== ws.id) {
              ws.send(JSON.stringify({ type: "error", message: "Никнейм уже занят" }));
              return;
            }
            
            // Обычный вход - просто устанавливаем имя
            ws.name = nickname;
          }

          // 🎙 Ведущий (только millisana, host, ведущий - НЕ admin!)
          if (["millisana", "host", "ведущий"].includes(nickname.toLowerCase())) {
            if (host && host.readyState === WebSocket.OPEN && host.id !== ws.id) {
              ws.send(JSON.stringify({ type: "error", message: "Ведущий уже есть" }));
              return;
            }
            
            ws.role = "host";
            host = ws;
            console.log(`🎙 Ведущий: ${ws.name}${isReconnecting ? ' (переподключение)' : ''}`);
            
            ws.send(JSON.stringify({ 
              type: "joined_as_host", 
              id: ws.id,
              isReconnecting: isReconnecting
            }));
            
            // Если игра уже началась, отправляем уведомление и перезаходим
            if (gameState.started) {
              console.log(`🎮 Ведущий заходит в уже начатую игру`);
              
              // Если у хоста нет карточек (например, он вышел и вернулся), генерируем их
              if (!ws.characteristics) {
                console.log(`🎲 Генерируем карты для ведущего (заход во время игры)`);
                ws.characteristics = generatePlayerCharacteristics();
                // Помечаем карты как использованные
                markPlayerCardsAsUsed(ws.characteristics);
              }
              
              ws.send(JSON.stringify({
                type: "game_started",
                message: "Игра уже началась, вы присоединяетесь"
              }));
              // Автоматически устанавливаем готовность для хоста
              ws.ready = true;
              // Отправляем обновление сразу
              sendPlayersUpdate();
            }
            
          } else {
            // 👤 Обычный игрок
            // Если игрок не в списке активных, добавляем
            if (!allPlayers.includes(ws)) {
              const activeRegularPlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
              
              // Проверяем лимит только если игра не началась (во время игры можно заходить для переподключений и новых игроков)
              if (activeRegularPlayers.length >= MAX_PLAYERS && !isReconnecting && !gameState.started) {
                ws.send(JSON.stringify({ 
                  type: "error", 
                  message: `Лобби заполнено (максимум ${MAX_PLAYERS} игроков)` 
                }));
                return;
              }

              allPlayers.push(ws);
            }
            
            console.log(`👤 Игрок: ${ws.name}${isReconnecting ? ' (переподключение)' : ''}`);
            
            ws.send(JSON.stringify({ 
              type: "joined_as_player", 
              id: ws.id,
              isReconnecting: isReconnecting
            }));
            
            // Если игра уже началась, отправляем уведомление
            if (gameState.started) {
              console.log(`🎮 Игрок ${ws.name} заходит в уже начатую игру`);
              
              // Если это не переподключение и у игрока нет карточек (заходит впервые во время игры), генерируем их
              if (!isReconnecting && !ws.characteristics) {
                console.log(`🎲 Генерируем карты для игрока ${ws.name} (заход во время игры)`);
                ws.characteristics = generatePlayerCharacteristics();
                // Помечаем карты как использованные
                markPlayerCardsAsUsed(ws.characteristics);
                // Отправляем обновление сразу
                sendPlayersUpdate();
              }
              
              // Если это переподключение, отправляем обновление чтобы показать восстановленные данные
              if (isReconnecting) {
                sendPlayersUpdate();
              }
              
              // Если игра уже готова (админ нажал "Начать"), не показываем экран "Подключение..."
              if (gameState.ready) {
                ws.send(JSON.stringify({
                  type: "game_ready",
                  message: "Игра уже готова, присоединяйтесь"
                }));
              } else {
                ws.send(JSON.stringify({
                  type: "game_started",
                  message: "Игра уже началась, вы можете присоединиться"
                }));
              }
            }
          }

          sendPlayersUpdate();
          
          // Уведомляем о новом игроке для инициации WebRTC
          broadcast({
            type: "new_player_joined",
            playerId: ws.id,
            playerName: ws.name
          }, ws);
          
          break;
        }

        // ✅ Игрок нажал "готов"
        case "set_ready": {
          if (!ws.name) {
            ws.send(JSON.stringify({ type: "error", message: "Сначала введите никнейм" }));
            return;
          }

          ws.ready = data.ready;
          console.log(`✅ ${ws.name}: ${data.ready ? 'готов' : 'не готов'}`);

          ws.send(JSON.stringify({
            type: "ready_status",
            ready: data.ready
          }));

          // Если игра уже началась и игрок стал готов, сразу отправляем ему состояние игры
          if (data.ready && gameState.started) {
            console.log(`🎮 Игрок ${ws.name} готов и игра уже началась - отправляем состояние`);
            // Если игра уже готова (админ нажал "Начать"), не показываем экран "Подключение..."
            if (gameState.ready) {
              ws.send(JSON.stringify({
                type: "game_ready",
                message: "Игра уже готова"
              }));
            } else {
              ws.send(JSON.stringify({
                type: "game_started",
                message: "Игра уже началась"
              }));
            }
          }

          sendPlayersUpdate();
          checkAllReady();
          break;
        }

        // 📊 Запрос текущего состояния лобби
        case "get_lobby_state": {
          sendPlayersUpdate();
          break;
        }


        // 📡 WebRTC сигналы - УЛУЧШЕННАЯ ВЕРСИЯ
        case "signal": {
          if (!data.targetId || !data.signal) {
            ws.send(JSON.stringify({ type: "error", message: "Неверный сигнал" }));
            return;
          }

          // Находим целевого игрока
          const targetPlayer = [...allPlayers, host].find(p => 
            p && p.id === data.targetId && p.readyState === WebSocket.OPEN
          );
          
          if (!targetPlayer) {
            console.log(`❌ Целевой игрок ${data.targetId} не найден`);
            ws.send(JSON.stringify({ type: "error", message: "Игрок не в сети" }));
            return;
          }

          // Пересылаем сигнал с дополнительной информацией
          const success = sendToPlayer(data.targetId, {
            type: "signal",
            fromId: ws.id,
            fromName: ws.name,
            signal: data.signal,
            timestamp: Date.now()
          });

          if (success) {
            const signalType = data.signal.type || 'ice-candidate';
            console.log(`📡 ${signalType} от ${ws.name} к ${targetPlayer.name}`);
          }
          break;
        }

        // 🔍 Запрос на переустановку WebRTC соединений
        case "refresh_connections": {
          console.log(`🔄 ${ws.name} запросил обновление WebRTC соединений`);
          broadcast({
            type: "refresh_connections_request",
            from: ws.id
          }, ws);
          break;
        }

        // 💬 Чат сообщения
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

        // 🎲 Запрос карт игрока
        case "get_player_cards": {
          const targetPlayerId = data.playerId;
          const allConnections = [...allPlayers, host];
          const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId && p.readyState === WebSocket.OPEN);
          
          if (targetPlayer && targetPlayer.characteristics) {
            ws.send(JSON.stringify({
              type: "player_cards",
              playerId: targetPlayerId,
              playerName: targetPlayer.name,
              cards: targetPlayer.characteristics
            }));
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Карты игрока не найдены" }));
          }
          break;
        }

        // 👁️ Раскрытие характеристики игрока
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
            ws.send(JSON.stringify({ type: "error", message: "Характеристика не найдена" }));
          }
          break;
        }

        // ⚡ Обработка карт действий
        case "execute_action_card": {
          const actionType = data.actionType;
          const parameters = data.parameters;
          const allConnections = [...allPlayers, host];
          
          console.log(`⚡ Выполняется карта действия: ${actionType}`);
          
          // Обработка каждой карты
          handleActionCard(actionType, parameters, allConnections);
          break;
        }

        // 🚫 Изгнание/возврат игрока
        case "toggle_ban_player": {
          if (ws.role === "host") {
            const targetPlayerId = data.playerId;
            const allConnections = [...allPlayers, host];
            const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);
            
            if (targetPlayer && bannedPlayers.has(targetPlayerId)) {
              // Возвращаем игрока
              bannedPlayers.delete(targetPlayerId);
              console.log(`✅ Игрок ${targetPlayer.name} возвращен в игру`);
            } else if (targetPlayer) {
              // Изгоняем игрока
              bannedPlayers.add(targetPlayerId);
              console.log(`🚫 Игрок ${targetPlayer.name} изгнан`);
            }
            
            // Отправляем обновление всем клиентам
            broadcast({
              type: "player_banned",
              playerId: targetPlayerId,
              banned: bannedPlayers.has(targetPlayerId)
            });
            
            sendPlayersUpdate();
          }
          break;
        }

        // 🦵 Кик игрока админом панели (без бана, можно перезаходить)
        case "kick_player": {
          // Разрешаем кик только админ-панели или ведущему
          if (ws.role === "admin_panel" || ws.role === "host") {
            const targetPlayerId = data.playerId;
            const allConnections = [...allPlayers, host].filter(Boolean);
            const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);

            if (!targetPlayer) {
              ws.send(JSON.stringify({ type: "error", message: "Игрок не найден" }));
              break;
            }
            if (targetPlayer.role === "host") {
              ws.send(JSON.stringify({ type: "error", message: "Нельзя кикнуть ведущего" }));
              break;
            }

            try {
              // Уведомляем цель, что её кикнули
              if (targetPlayer.readyState === WebSocket.OPEN) {
                targetPlayer.send(JSON.stringify({ type: "kicked", message: "Вы были кикнуты администратором. Вы можете переподключиться." }));
              }
            } catch (e) {
              console.warn("⚠️ Не удалось отправить уведомление о кике:", e);
            }

            // Закрываем соединение; если игра идёт, onclose сохранит данные для переподключения
            try {
              targetPlayer.close(4000, "Kicked by admin");
            } catch (_) {}

            // Сообщаем всем
            broadcast({
              type: "player_kicked",
              playerId: targetPlayerId,
              playerName: targetPlayer.name
            });
            sendPlayersUpdate();
          }
          break;
        }

        // 🪞 Установка зеркалирования камеры
        case "set_mirror_camera": {
          if (!ws.name) {
            ws.send(JSON.stringify({ type: "error", message: "Сначала введите никнейм" }));
            return;
          }
          
          ws.mirrorCamera = data.mirror || false;
          console.log(`🪞 ${ws.name}: зеркалирование ${ws.mirrorCamera ? 'включено' : 'выключено'}`);
          
          // Отправляем обновление всем игрокам
          sendPlayersUpdate();
          break;
        }

        // ✅ Игра готова к началу (админ нажал "Начать")
        case "game_ready": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            console.log("✅ Админ нажал 'Начать', игра готова!");
            gameState.ready = true;
            
            broadcast({
              type: "game_ready",
              message: "Игра готова к началу"
            });
            
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может начать игру" }));
          }
          break;
        }

        // 🎯 Установка количества раундов
        case "set_total_rounds": {
          // Разрешаем только ведущему или админ-панели
          if (ws.role === "host" || ws.role === "admin_panel") {
            const newTotalRounds = parseInt(data.totalRounds) || 5;
            if (newTotalRounds < 1) {
              ws.send(JSON.stringify({ type: "error", message: "Количество раундов должно быть больше 0" }));
              return;
            }
            gameState.totalRounds = newTotalRounds;
            console.log(`🎯 Количество раундов установлено: ${newTotalRounds}`);
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий или админ-панель могут устанавливать количество раундов" }));
          }
          break;
        }

        // 🔄 Переключение раунда
        case "change_round": {
          // Разрешаем только ведущему или админ-панели
          if (ws.role === "host" || ws.role === "admin_panel") {
            const newRound = parseInt(data.round) || 1;
            if (newRound < 1 || newRound > gameState.totalRounds) {
              ws.send(JSON.stringify({ type: "error", message: `Раунд должен быть от 1 до ${gameState.totalRounds}` }));
              return;
            }
            gameState.currentRound = newRound;
            console.log(`🔄 Раунд изменен на: ${newRound}`);
            
            // Сбрасываем зеленую рамку при смене раунда
            if (highlightedPlayerId) {
              highlightedPlayerId = null;
              console.log(`🔄 Зеленая рамка сброшена при смене раунда`);
            }
            
            // Сбрасываем голосование при смене раунда
            if (votingState.phase !== null) {
              votingState.phase = null;
              votingState.candidates.clear();
              votingState.votes.clear();
              votingState.voteCounts = {};
              console.log(`🔄 Голосование сброшено при смене раунда`);
            }
            
            // Отправляем всем уведомление о смене раунда
            console.log(`📤 Отправляем round_changed всем клиентам: раунд ${newRound}`);
            broadcast({
              type: "round_changed",
              round: newRound,
              totalRounds: gameState.totalRounds
            });
            console.log(`✅ round_changed отправлен`);
            
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий или админ-панель могут переключать раунд" }));
          }
          break;
        }

        // 🗳️ Начало этапа выбора кандидатов на голосование
        case "start_voting_selection": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            if (votingState.phase !== null) {
              ws.send(JSON.stringify({ type: "error", message: "Голосование уже активно" }));
              return;
            }
            
            const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN && p.role !== "host" && !bannedPlayers.has(p.id));
            if (activePlayers.length < 2) {
              ws.send(JSON.stringify({ type: "error", message: "Для голосования нужно минимум 2 игрока" }));
              return;
            }
            
            // Начинаем этап выбора кандидатов
            votingState.phase = "selection";
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            
            console.log(`🗳️ Начался этап выбора кандидатов для голосования`);
            
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может начать выбор кандидатов" }));
          }
          break;
        }

        // 🗳️ Установка списка кандидатов (хост выбирает кандидатов)
        case "set_voting_candidates": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            if (votingState.phase !== "selection") {
              ws.send(JSON.stringify({ type: "error", message: "Этап выбора кандидатов не активен" }));
              return;
            }
            
            const candidates = data.candidates || [];
            if (!Array.isArray(candidates)) {
              ws.send(JSON.stringify({ type: "error", message: "Неверный формат списка кандидатов" }));
              return;
            }
            
            // Проверяем, что все кандидаты существуют и не изгнаны
            const allConnections = [...allPlayers, host];
            const validCandidates = candidates.filter(candidateId => {
              const player = allConnections.find(p => p && p.id === candidateId);
              return player && player.role !== "host" && !bannedPlayers.has(candidateId);
            });
            
            votingState.candidates = new Set(validCandidates);
            
            console.log(`🗳️ Хост выбрал ${validCandidates.length} кандидатов для голосования`);
            
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может выбрать кандидатов" }));
          }
          break;
        }

        // 🗳️ Подтверждение списка кандидатов и начало голосования
        case "confirm_voting_candidates": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            if (votingState.phase !== "selection") {
              ws.send(JSON.stringify({ type: "error", message: "Этап выбора кандидатов не активен" }));
              return;
            }
            
            if (votingState.candidates.size < 1) {
              ws.send(JSON.stringify({ type: "error", message: "Выберите хотя бы одного кандидата" }));
              return;
            }
            
            // Переходим к этапу голосования
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
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может подтвердить кандидатов" }));
          }
          break;
        }

        // 🗳️ Отмена голосования
        case "cancel_voting": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            if (votingState.phase === null) {
              ws.send(JSON.stringify({ type: "error", message: "Голосование не активно" }));
              return;
            }
            
            // Сбрасываем голосование
            votingState.phase = null;
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            
            console.log(`🗳️ Голосование на вылет отменено`);
            
            broadcast({
              type: "voting_cancelled",
              message: "Голосование на вылет отменено ведущим"
            });
            
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может отменить голосование" }));
          }
          break;
        }

        // 🗳️ Голос игрока за вылет другого игрока
        case "vote_to_kick": {
          if (votingState.phase !== "voting") {
            ws.send(JSON.stringify({ type: "error", message: "Голосование не активно" }));
            return;
          }
          
          // Хост не может голосовать
          if (ws.role === "host") {
            ws.send(JSON.stringify({ type: "error", message: "Хост не может голосовать" }));
            return;
          }
          
          // Проверяем, что голосующий игрок не изгнан
          if (bannedPlayers.has(ws.id)) {
            ws.send(JSON.stringify({ type: "error", message: "Изгнанные игроки не могут голосовать" }));
            return;
          }
          
          const targetPlayerId = data.targetPlayerId;
          if (!targetPlayerId) {
            ws.send(JSON.stringify({ type: "error", message: "Не указан ID игрока" }));
            return;
          }
          
          // Проверяем, что цель находится в списке кандидатов
          if (!votingState.candidates.has(targetPlayerId)) {
            ws.send(JSON.stringify({ type: "error", message: "Этот игрок не выставлен на голосование" }));
            return;
          }
          
          // Проверяем, что игрок еще не голосовал
          if (votingState.votes.has(ws.id)) {
            ws.send(JSON.stringify({ type: "error", message: "Вы уже проголосовали" }));
            return;
          }
          
          // Проверяем, что цель существует и не изгнана
          const allConnections = [...allPlayers, host];
          const targetPlayer = allConnections.find(p => p && p.id === targetPlayerId);
          if (!targetPlayer || bannedPlayers.has(targetPlayerId)) {
            ws.send(JSON.stringify({ type: "error", message: "Неверный игрок для голосования" }));
            return;
          }
          
          // Записываем голос
          votingState.votes.set(ws.id, targetPlayerId);
          
          // Если только один кандидат и голосующий - это кандидат, его голос не учитывается
          const isSingleCandidate = votingState.candidates.size === 1;
          const voterIsCandidate = votingState.candidates.has(ws.id);
          
          // Обновляем счетчики голосов (только если голос не от кандидата при одном кандидате)
          if (!(isSingleCandidate && voterIsCandidate)) {
            if (!votingState.voteCounts[targetPlayerId]) {
              votingState.voteCounts[targetPlayerId] = 0;
            }
            votingState.voteCounts[targetPlayerId]++;
            console.log(`🗳️ ${ws.name} проголосовал за вылет ${targetPlayer.name}`);
          } else {
            console.log(`🗳️ ${ws.name} проголосовал за вылет ${targetPlayer.name}, но его голос не учитывается (единственный кандидат)`);
          }
          
          // Отправляем обновление всем
          sendPlayersUpdate();
          
          // Проверяем, закончилось ли голосование (все проголосовали)
          checkVotingComplete();
          break;
        }

        // 🟢 Переключение зеленой рамки игрока
        case "toggle_player_highlight": {
          // Разрешаем только ведущему
          if (ws.role === "host") {
            const targetPlayerId = data.playerId;
            
            if (!targetPlayerId) {
              ws.send(JSON.stringify({ type: "error", message: "Не указан ID игрока" }));
              return;
            }
            
            // Если нажимаем на того же игрока - сбрасываем
            if (highlightedPlayerId === targetPlayerId) {
              highlightedPlayerId = null;
              console.log(`🟢 Зеленая рамка сброшена для игрока ${targetPlayerId}`);
            } else {
              // Иначе устанавливаем новому игроку (предыдущий автоматически сбросится)
              highlightedPlayerId = targetPlayerId;
              console.log(`🟢 Зеленая рамка установлена для игрока ${targetPlayerId}`);
            }
            
            // Отправляем обновление всем
            sendPlayersUpdate();
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Только ведущий может управлять выделением игроков" }));
          }
          break;
        }

        // 🔄 Сброс игры (очистка характеристик)
        case "reset_game": {
          // Разрешаем сброс только админу панели или ведущему
          if (ws.role === "admin_panel" || ws.role === "host") {
            console.log("🔄 Админ сбрасывает игру...");
            gameState.started = false;
            gameState.startTime = null; // Сбрасываем время начала игры
            gameState.ready = false; // Сбрасываем готовность игры
            gameState.currentRound = 0; // Сбрасываем раунд
            highlightedPlayerId = null; // Сбрасываем зеленую рамку
            // Сбрасываем голосование
            votingState.phase = null;
            votingState.candidates.clear();
            votingState.votes.clear();
            votingState.voteCounts = {};
            votingHistory = []; // Сбрасываем историю голосований
            
            // Сбрасываем состояние всех активных игроков
            allPlayers.forEach(p => {
              p.ready = false;
              p.characteristics = null;
            });
            if (host) {
              host.ready = false;
              host.characteristics = null;
            }
            
            // Очищаем данные отключенных игроков
            disconnectedPlayers.clear();
            console.log("🗑️ Данные отключенных игроков очищены");
            
            // Очищаем список использованных карт
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
          ws.send(JSON.stringify({ type: "error", message: "Неизвестная команда" }));
      }
    } catch (error) {
      console.error("❌ Ошибка обработки сообщения:", error);
      ws.send(JSON.stringify({ type: "error", message: "Ошибка сервера" }));
    }
  });

  // ❌ Отключение клиента
  ws.on("close", () => {
    console.log(`❌ Отключился: ${ws.name || 'Unknown'} (${ws.role})`);
    
    // 💾 Сохраняем данные игрока перед отключением (если игра началась)
    // НЕ сохраняем для админ-панели
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
      // НЕ отправляем уведомления игрокам, т.к. это не влияет на игру
    }

    // Уведомляем об отключении игрока (только если это не админ-панель)
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
    console.error(`💥 Ошибка: ${ws.name || ws.id}`, error);
  });
});

console.log("🚀 Сервер 'Бункер' готов для 8 игроков!");
