// server.js
const WebSocket = require("ws");
const propertiesData = require("./properties.json");

const wss = new WebSocket.Server({ port: 5000 }, () =>
  console.log("✅ Сервер запущен на порту 5000")
);

const MAX_PLAYERS = 5; // Увеличил до 8
let allPlayers = [];
let host = null;
let gameState = { started: false };
let bannedPlayers = new Set(); // Set из ID изгнанных игроков

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
  console.log(`⚡ Обработка карты: ${actionType}`);
  // Здесь будет детальная логика для каждой карты
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

          // Проверка на дубликаты имен
          const activePlayers = [...allPlayers, host].filter(p => p && p.readyState === WebSocket.OPEN);
          const existingPlayer = activePlayers.find(p => p.name && p.name.toLowerCase() === nickname.toLowerCase());
          
          if (existingPlayer) {
            ws.send(JSON.stringify({ type: "error", message: "Никнейм уже занят" }));
            return;
          }

          ws.name = nickname;

          // 🎙 Ведущий
          if (["millisana", "admin", "host", "ведущий"].includes(nickname.toLowerCase())) {
            if (host && host.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", message: "Ведущий уже есть" }));
              return;
            }
            
            ws.role = "host";
            host = ws;
            console.log(`🎙 Ведущий: ${ws.name}`);
            
            ws.send(JSON.stringify({ 
              type: "joined_as_host", 
              id: ws.id 
            }));
            
          } else {
            // 👤 Обычный игрок
            const activeRegularPlayers = allPlayers.filter(p => p.readyState === WebSocket.OPEN);
            
            if (activeRegularPlayers.length >= MAX_PLAYERS) {
              ws.send(JSON.stringify({ 
                type: "error", 
                message: `Лобби заполнено (максимум ${MAX_PLAYERS} игроков)` 
              }));
              return;
            }

            allPlayers.push(ws);
            console.log(`👤 Игрок: ${ws.name}`);
            
            ws.send(JSON.stringify({ 
              type: "joined_as_player", 
              id: ws.id 
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
          if (ws.role === "host") {
            gameState.started = false;
            allPlayers.forEach(p => {
              p.ready = false;
              p.characteristics = null;
            });
            if (host) {
              host.ready = false;
              host.characteristics = null;
            }
            
            broadcast({
              type: "game_reset",
              message: "Игра сброшена, все карты очищены"
            });
            
            sendPlayersUpdate();
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
    
    if (ws.role === "player") {
      allPlayers = allPlayers.filter((p) => p !== ws);
    } else if (ws.role === "host") {
      host = null;
      broadcast({ 
        type: "host_left",
        message: "Ведущий вышел из игры"
      });
    }

    // Уведомляем об отключении игрока
    broadcast({
      type: "player_left",
      playerId: ws.id,
      playerName: ws.name
    });

    sendPlayersUpdate();
  });

  ws.on("error", (error) => {
    console.error(`💥 Ошибка: ${ws.name || ws.id}`, error);
  });
});

console.log("🚀 Сервер 'Бункер' готов для 8 игроков!");
