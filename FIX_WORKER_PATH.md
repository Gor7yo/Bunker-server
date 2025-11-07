# 🔧 Исправление пути к mediasoup worker

## ❌ Проблема:
```
spawn /opt/bunker-server/node_modules/.pnpm/mediasoup@3.19.7/node_modules/mediasoup/worker/out/Release/mediasoup-worker ENOENT
```

Worker не найден по указанному пути.

## ✅ Решение:

### ШАГ 1: Проверь структуру проекта

```bash
# Подключись к серверу
ssh root@195.80.51.69

# Проверь где находится проект
ls -la /opt/bunker-server/
ls -la /opt/bunker-server/server/

# Проверь где находится mediasoup
find /opt/bunker-server -name "mediasoup" -type d 2>/dev/null
```

### ШАГ 2: Проверь наличие worker

```bash
# Проверь стандартный путь
ls -la /opt/bunker-server/node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker/out/Release/mediasoup-worker

# Или если проект в server/
ls -la /opt/bunker-server/server/node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker/out/Release/mediasoup-worker

# Или через npm структуру
ls -la /opt/bunker-server/node_modules/mediasoup/worker/out/Release/mediasoup-worker
```

### ШАГ 3: Если worker не найден - собери его

```bash
# Перейди в директорию проекта
cd /opt/bunker-server/server
# или
cd /opt/bunker-server

# Запусти скрипт сборки
npm run build:mediasoup

# Или вручную
cd node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker
npm install
```

### ШАГ 4: Проверь что worker собран

```bash
# Найди worker
find /opt/bunker-server -name "mediasoup-worker" -type f 2>/dev/null

# Проверь права доступа
chmod +x /opt/bunker-server/node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker/out/Release/mediasoup-worker
```

### ШАГ 5: Перезапусти сервер

```bash
pm2 restart bunker-server
pm2 logs bunker-server
```

## 🔍 Альтернативное решение: Использовать правильный путь

Если worker находится в другом месте, нужно обновить код инициализации mediasoup, чтобы он искал worker в правильном месте.

Проверь где находится worker и сообщи - я обновлю код.

