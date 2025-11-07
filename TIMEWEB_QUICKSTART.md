# ⚡ Быстрый старт на TimeWeb VPS

## 🎯 Минимальные шаги для запуска

### 1. Подключение к серверу
```bash
ssh root@your-server-ip
```

### 2. Установка необходимого ПО
```bash
# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2
npm install -g pm2

# pnpm (опционально)
npm install -g pnpm
```

### 3. Загрузка проекта
```bash
cd /opt
# Вариант A: Git
git clone your-repo-url bunker-server
cd bunker-server/server

# Вариант B: SCP (с локальной машины)
# scp -r server root@your-server-ip:/opt/bunker-server/
```

### 4. Установка и запуск
```bash
# Установка зависимостей
pnpm install  # или npm install

# Создание директории для логов
mkdir -p logs

# Запуск через PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Проверка
pm2 status
pm2 logs bunker-server
```

### 5. Открытие порта
```bash
ufw allow 5000/tcp
ufw enable
```

## 🔗 Обновление клиента

После получения IP/домена сервера, обновите в клиенте:

**`client/src/pages/JoinRoom/JoinRoom.jsx`** (строка 28):
```javascript
const socket = new WebSocket("ws://your-server-ip:5000");
// или с SSL:
const socket = new WebSocket("wss://your-domain.com");
```

**`client/src/pages/AdminPanel/AdminPanel.jsx`** (строка 24):
```javascript
const wsUrl = 'ws://your-server-ip:5000';
// или с SSL:
const wsUrl = 'wss://your-domain.com';
```

## 📋 Чеклист

- [ ] Node.js 20.x установлен
- [ ] PM2 установлен
- [ ] Проект загружен на сервер
- [ ] Зависимости установлены (`pnpm install`)
- [ ] Сервер запущен через PM2
- [ ] Порт 5000 открыт в firewall
- [ ] Клиент обновлен с новым адресом сервера
- [ ] Сервер работает (проверено через `pm2 logs`)

## 🆘 Быстрая диагностика

```bash
# Проверка статуса
pm2 status

# Просмотр логов
pm2 logs bunker-server --lines 50

# Проверка порта
ss -tulpn | grep 5000

# Перезапуск
pm2 restart bunker-server
```

## 📖 Полная инструкция

См. `TIMEWEB_DEPLOY.md` для подробной инструкции.


