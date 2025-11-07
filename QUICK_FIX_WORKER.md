# Быстрое исправление mediasoup-worker ENOENT

## Проблема
Ошибка `spawn .../mediasoup-worker ENOENT` - mediasoup не может найти worker.

## Быстрое решение (1 команда)

```bash
cd /opt/bunker-server && pm2 restart bunker-server && pm2 logs bunker-server --lines 30
```

Код теперь автоматически ищет worker и устанавливает путь.

## Если не помогло

### 1. Проверьте, что worker существует:
```bash
find /opt/bunker-server -name "mediasoup-worker" -type f 2>/dev/null
```

### 2. Если worker не найден, соберите его:
```bash
cd /opt/bunker-server
npm run build:mediasoup
```

### 3. Установите права на выполнение:
```bash
chmod +x /opt/bunker-server/node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker/out/Release/mediasoup-worker
```

### 4. Перезапустите:
```bash
pm2 restart bunker-server
pm2 logs bunker-server
```

## Что должно быть в логах после исправления:

```
✅ Найден mediasoup worker: /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker
📦 Установлена переменная окружения MEDIASOUP_WORKER_BIN: ...
✅ Mediasoup инициализирован
🚀 Сервер 'Бункер' готов для 8 игроков!
✅ Mediasoup активен - медиа-функции доступны
```

Если видите эти сообщения - всё работает! ✅

