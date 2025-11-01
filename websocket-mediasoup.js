// websocket-mediasoup.js
// Интеграция Mediasoup в websocket.js
// Добавьте этот код в начало websocket.js после строки 34

const MediasoupHandler = require("./mediasoup-server");

// Инициализация Mediasoup (опционально)
const USE_MEDIASOUP = process.env.USE_MEDIASOUP === 'true';
let mediasoupHandler = null;

if (USE_MEDIASOUP) {
  try {
    // Определяем IP адрес для Mediasoup
    // Если Mediasoup на том же сервере - используем localhost
    // Если на Selectel - нужно указать внешний IP
    const mediasoupOptions = {
      announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined
    };
    
    mediasoupHandler = new MediasoupHandler(mediasoupOptions);
    console.log("✅ Mediasoup Handler инициализирован (используется Mediasoup Media Server)");
  } catch (error) {
    console.error("⚠️ Не удалось инициализировать Mediasoup, используем P2P режим:", error.message);
    mediasoupHandler = null;
  }
} else {
  console.log("ℹ️ Mediasoup отключен, используется P2P режим. Для включения установите USE_MEDIASOUP=true");
}


