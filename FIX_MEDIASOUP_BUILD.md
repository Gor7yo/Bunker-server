# 🔧 Исправление проблем сборки Mediasoup

## ❌ Проблемы:

1. **Node.js версия**: mediasoup@3.19.7 требует Node.js >=22, а установлен v20.19.5
2. **Python pip**: отсутствует модуль pip для python3

## ✅ Решение:

### ШАГ 1: Обновить Node.js до версии 22

```bash
# Установи Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Проверь версию
node -v
# Должно быть: v22.x.x

npm -v
```

### ШАГ 2: Установить Python pip

```bash
# Установи python3-pip
apt update
apt install -y python3-pip

# Проверь установку
python3 -m pip --version
```

### ШАГ 3: Переустановить mediasoup

```bash
cd /opt/bunker-server/server

# Удали старую версию mediasoup
rm -rf node_modules/.pnpm/mediasoup@*

# Переустанови зависимости
pnpm install
# или
npm install
```

### ШАГ 4: Собери worker

```bash
# Запусти скрипт сборки
npm run build:mediasoup

# Или вручную:
cd node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker
npm install
```

### ШАГ 5: Перезапусти сервер

```bash
pm2 restart bunker-server
pm2 logs bunker-server
```

---

## 🚀 Быстрое решение (все команды вместе):

```bash
# 1. Обнови Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 2. Установи Python pip
apt install -y python3-pip

# 3. Переустанови mediasoup
cd /opt/bunker-server/server
rm -rf node_modules/.pnpm/mediasoup@*
pnpm install

# 4. Собери worker
npm run build:mediasoup

# 5. Перезапусти
pm2 restart bunker-server
pm2 logs bunker-server
```

---

## 📝 Альтернативное решение: Использовать prebuilt worker

Если сборка все еще не работает, mediasoup уже скачал prebuilt worker. Проверь:

```bash
# Проверь наличие prebuilt worker
ls -la /opt/bunker-server/node_modules/.pnpm/mediasoup@*/node_modules/mediasoup/worker/out/Release/mediasoup-worker

# Если файл существует - можно использовать его напрямую
# Просто перезапусти сервер
pm2 restart bunker-server
```

---

## ⚠️ Важно:

После обновления Node.js до версии 22, убедись что:
- PM2 использует правильную версию Node.js
- Все зависимости переустановлены

```bash
# Проверь версию Node.js в PM2
pm2 restart bunker-server
pm2 logs bunker-server
```

