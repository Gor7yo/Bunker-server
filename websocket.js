// server.js
const WebSocket = require("ws");
const propertiesData = require("./properties.json");

const wss = new WebSocket.Server({ port: 5000 }, () =>
  console.log("✅ Сервер запущен на порту 5000")
);

const MAX_PLAYERS = 5; // Увеличил до 8
let allPlayers = [];
let host = null;
let adminPanel = null; // Отдельное подключение для админ-панели
let gameState = { started: false };
let bannedPlayers = new Set(); // Set из ID изгнанных игроков
let disconnectedPlayers = new Map(); // Map: nickname -> {characteristics, id, role}

// ============================
// 🎲 Генерация случайных характеристик игрока
// ============================
function generatePlayerCharacteristics() {
  const characteristics = {};
  
  // Список категорий для генерации
  const categories = ['bandage', 'actions', 'fact', 'fobia', 'health', 'hobbie', 'age', 'proffesion'];
  
  categories.forEach(category => {
    const categoryData = propertiesData.propertiesCategory.find(cat => cat.category === category);
    if (categoryData && categoryData.items.length > 0) {
      const randomIndex = Math.floor(Math.random() * categoryData.items.length);
      const selectedItem = categoryData.items[randomIndex];
      
      characteristics[category] = {
        value: selectedItem.value,
        description: selectedItem.description || null,
        experience: selectedItem.experience || null,
        revealed: false // По умолчанию все характеристики скрыты
      };
    }
  });
  
  return characteristics;
}

// ============================
// 🎯 Генерация карт для всех игроков при старте игры
// ============================
function generateAllPlayerCards() {
  console.log("🎲 Генерируем карты для всех игроков...");
  
  // Генерируем карты для обычных игроков
  allPlayers.forEach(player => {
    if (player.readyState === WebSocket.OPEN) {
      player.characteristics = generatePlayerCharacteristics();
      console.log(`📋 Карты для ${player.name}:`, Object.keys(player.characteristics));
    }
  });
  
  // Генерируем карты для ведущего
  if (host && host.readyState === WebSocket.OPEN) {
    host.characteristics = generatePlayerCharacteristics();
    console.log(`📋 Карты для ведущего ${host.name}:`, Object.keys(host.characteristics));
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
        characteristics: p.characteristics || null
      })),
      readyCount,
      totalPlayers,
      regularPlayers: activePlayers.length,
      maxRegularPlayers: MAX_PLAYERS,
      hostConnected: !!activeHost,
      hostReady: activeHost ? activeHost.ready : false,
      gameStarted: gameState.started
    }));
  }

  broadcast({
    type: "players_update",
    players: playersList.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      role: p.role,
      characteristics: p.characteristics || null
    })),
    readyCount,
    totalPlayers,
    regularPlayers: activePlayers.length,
    maxRegularPlayers: MAX_PLAYERS,
    hostConnected: !!activeHost,
    hostReady: activeHost ? activeHost.ready : false,
    gameStarted: gameState.started
  });
}

// ============================
// ✅ Проверяем: все ли готовы, и можно ли стартовать
// ============================
function checkAllReady() {
  const activePlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
  const activeHost = host && host.readyState === WebSocket.OPEN ? host : null;

  if (!activeHost || !activeHost.ready) {
    gameState.started = false;
    return;
  }

  const playersList = [...activePlayers, activeHost];
  const allReady = playersList.length > 1 && playersList.every((p) => p.ready);

  if (allReady && !gameState.started) {
    gameState.started = true;
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

          // Если у игрока уже есть имя
          if (ws.name) {
            if (ws.name !== nickname) {
              ws.name = nickname;
              sendPlayersUpdate();
            }
            return;
          }

          // Проверка на дубликаты имен среди активных игроков
          const activePlayers = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
          const existingPlayer = activePlayers.find(p => p.name && p.name.toLowerCase() === nickname.toLowerCase());
          
          if (existingPlayer && existingPlayer.id !== ws.id) {
            ws.send(JSON.stringify({ type: "error", message: "Никнейм уже занят" }));
            return;
          }

          // 🔄 ПЕРЕЗАХОД: Проверяем, есть ли сохраненные данные для этого никнейма
          const disconnectedData = disconnectedPlayers.get(nickname.toLowerCase());
          let isReconnecting = false;
          
          if (disconnectedData && gameState.started) {
            // Восстанавливаем данные игрока
            console.log(`🔄 Игрок ${nickname} переподключается, восстанавливаем данные...`);
            isReconnecting = true;
            
            // Сохраняем новый WebSocket, но с восстановленными данными
            ws.name = nickname;
            ws.characteristics = disconnectedData.characteristics ? JSON.parse(JSON.stringify(disconnectedData.characteristics)) : null;
            ws.ready = disconnectedData.ready || false;
            ws.role = disconnectedData.role || "player";
            
            // Удаляем из списка отключенных
            disconnectedPlayers.delete(nickname.toLowerCase());
            
            console.log(`✅ Данные восстановлены для ${nickname}:`, {
              hasCharacteristics: !!ws.characteristics,
              characteristicsCount: ws.characteristics ? Object.keys(ws.characteristics).length : 0
            });
          } else {
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
            
          } else {
            // 👤 Обычный игрок
            // Если игрок не в списке активных, добавляем
            if (!allPlayers.includes(ws)) {
              const activeRegularPlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
              
              if (activeRegularPlayers.length >= MAX_PLAYERS && !isReconnecting) {
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

        // 🔄 Сброс игры (очистка характеристик)
        case "reset_game": {
          // Разрешаем сброс только админу панели или ведущему
          if (ws.role === "admin_panel" || ws.role === "host") {
            console.log("🔄 Админ сбрасывает игру...");
            gameState.started = false;
            
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
