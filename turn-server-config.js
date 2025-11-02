// Конфигурация для получения TURN серверов
// Этот файл поможет вам настроить TURN сервер на Selectel

// ВАРИАНТ 1: Использование готового TURN сервера (coturn)
// Установите на сервере Selectel пакет coturn и используйте эту конфигурацию

/*
Пример конфигурации для coturn (файл /etc/turnserver.conf):

listening-port=3478
listening-ip=0.0.0.0
external-ip=YOUR_SELECTEL_IP
relay-ip=YOUR_SELECTEL_IP
min-port=49152
max-port=65535
realm=bunker-game
server-name=bunker-game-turn
user=bunker:YOUR_SECURE_PASSWORD
lt-cred-mech

# Логирование
log-file=/var/log/turnserver.log
verbose
*/

// ВАРИАНТ 2: Использование облачного TURN сервиса
// Альтернатива - использовать готовые TURN сервисы:
// - Twilio STUN/TURN: https://www.twilio.com/stun-turn
// - Metered TURN: https://www.metered.ca/tools/openrelay/
// - Xirsys: https://xirsys.com/

// Функция для получения списка ICE серверов
function getIceServers(turnConfig = {}) {
  const { 
    turnUrl = null, 
    turnUsername = null, 
    turnCredential = null,
    usePublicStun = true 
  } = turnConfig;

  const iceServers = [];

  // Добавляем публичные STUN серверы (для определения внешнего IP)
  if (usePublicStun) {
    iceServers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    );
  }

  // Добавляем TURN сервер, если настроен
  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential
    });
  }

  return iceServers;
}

// Пример использования для экспорта в веб-сокет сервер
module.exports = {
  getIceServers,
  // Пример конфигурации для Selectel сервера
  exampleConfig: {
    turnUrl: 'turn:YOUR_SELECTEL_IP:3478',
    turnUsername: 'bunker',
    turnCredential: 'YOUR_SECURE_PASSWORD'
  }
};

