# Исправление ошибки mediasoup-worker ENOENT

## Проблема
Ошибка `spawn /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker ENOENT` означает, что mediasoup не может найти worker executable.

## Решение

Код теперь автоматически ищет worker в нескольких местах и устанавливает переменную окружения `MEDIASOUP_WORKER_BIN`.

### 1. Убедитесь, что worker собран

```bash
cd /opt/bunker-server
find . -name "mediasoup-worker" -type f 2>/dev/null
```

Если worker не найден, соберите его:

```bash
cd /opt/bunker-server
cd node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker
npm install
```

Или используйте скрипт:

```bash
cd /opt/bunker-server
npm run build:mediasoup
```

### 2. Проверьте права на выполнение

```bash
chmod +x /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker
```

### 3. Перезапустите сервер

```bash
pm2 restart bunker-server
pm2 logs bunker-server
```

### 4. Проверьте логи

В логах должно появиться:
```
✅ Найден mediasoup worker: /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker
📦 Установлена переменная окружения MEDIASOUP_WORKER_BIN: ...
✅ Mediasoup инициализирован
```

## Альтернативное решение (если автоматический поиск не работает)

Если автоматический поиск не работает, можно явно установить переменную окружения в `ecosystem.config.js`:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 5000,
  USE_MEDIASOUP: 'true',
  MEDIASOUP_WORKER_BIN: '/opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker'
}
```

Затем перезапустите:

```bash
pm2 delete bunker-server
pm2 start ecosystem.config.js
pm2 save
```

## Проверка

После перезапуска проверьте логи:

```bash
pm2 logs bunker-server --lines 50
```

Должно быть:
- ✅ Найден mediasoup worker
- ✅ Mediasoup инициализирован
- ✅ Mediasoup активен - медиа-функции доступны

Если ошибка сохраняется, проверьте:
1. Существует ли файл worker по указанному пути
2. Есть ли права на выполнение (chmod +x)
3. Правильно ли указан путь в логах

