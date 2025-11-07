# 🚨 СРОЧНОЕ ИСПРАВЛЕНИЕ: Mediasoup Worker не найден

## ❌ Ошибка:
```
spawn /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker ENOENT
```

## ✅ Быстрое решение:

### На сервере выполни:

```bash
# 1. Подключись
ssh root@195.80.51.69

# 2. Перейди в директорию проекта
cd /opt/bunker-server/server
# ИЛИ если проект в корне:
cd /opt/bunker-server

# 3. Проверь где находится mediasoup
find . -name "mediasoup" -type d 2>/dev/null | head -5

# 4. Найди worker (если есть)
find . -name "mediasoup-worker" -type f 2>/dev/null

# 5. Если worker не найден - собери его
npm run build:mediasoup

# ИЛИ вручную:
cd node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker
npm install

# 6. Проверь что worker собран
ls -la out/Release/mediasoup-worker

# 7. Если файл есть - дай права на выполнение
chmod +x out/Release/mediasoup-worker

# 8. Перезапусти сервер
pm2 restart bunker-server
pm2 logs bunker-server
```

## 🔍 Если worker все еще не найден:

### Вариант 1: Проверь структуру проекта

```bash
# Проверь где находится websocket.js
find /opt/bunker-server -name "websocket.js" 2>/dev/null

# Проверь где находятся node_modules
find /opt/bunker-server -name "node_modules" -type d 2>/dev/null | head -3
```

### Вариант 2: Переустанови mediasoup

```bash
cd /opt/bunker-server/server
# или
cd /opt/bunker-server

# Удали mediasoup
rm -rf node_modules/.pnpm/mediasoup@*

# Переустанови
pnpm install mediasoup@3.19.7

# Собери worker
npm run build:mediasoup
```

### Вариант 3: Используй prebuilt worker

Mediasoup автоматически скачивает prebuilt worker при установке. Проверь:

```bash
# Ищи prebuilt worker
find /opt/bunker-server -path "*/mediasoup/worker/prebuild/*/mediasoup-worker" 2>/dev/null

# Или в out/Release
find /opt/bunker-server -path "*/mediasoup/worker/out/Release/mediasoup-worker" 2>/dev/null
```

## 📝 После исправления:

Проверь логи:
```bash
pm2 logs bunker-server
```

Должно быть:
```
✅ Mediasoup инициализирован
📡 Router RTP capabilities: {...}
```

Если все еще ошибка - пришли результат команд выше, и я помогу найти правильный путь.

