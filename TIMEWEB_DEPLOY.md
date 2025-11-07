# 🚀 Деплой на TimeWeb VPS

## 📋 Требования

- VPS с Ubuntu 20.04/22.04 (рекомендуется)
- Минимум: 1 GB RAM, 1 vCPU
- Рекомендуется: 2 GB RAM, 2 vCPU (с запасом)

## 🔧 Шаг 1: Подключение к серверу

```bash
ssh root@your-server-ip
# или
ssh your-username@your-server-ip
```

## 📦 Шаг 2: Установка Node.js и pnpm

```bash
# Обновляем систему
apt update && apt upgrade -y

# Устанавливаем Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Проверяем версию
node -v  # Должно быть v20.x.x
npm -v

# Устанавливаем pnpm глобально
npm install -g pnpm

# Устанавливаем PM2 для управления процессом
npm install -g pm2
```

## 📥 Шаг 3: Загрузка проекта

### Вариант A: Через Git (рекомендуется)

```bash
# Устанавливаем Git
apt install -y git

# Клонируем репозиторий
cd /opt
git clone https://github.com/your-username/your-repo.git bunker-server
cd bunker-server/server
```

### Вариант B: Через SCP (если нет Git)

На локальной машине:
```bash
# Создаем архив
cd "C:\Users\gorce\OneDrive\Desktop\Bunker 2"
tar -czf server.tar.gz server/

# Загружаем на сервер
scp server.tar.gz root@your-server-ip:/opt/

# На сервере распаковываем
ssh root@your-server-ip
cd /opt
tar -xzf server.tar.gz
cd server
```

## 🔨 Шаг 4: Установка зависимостей

```bash
cd /opt/bunker-server/server  # или путь к вашему проекту

# Устанавливаем зависимости
pnpm install

# Если используете npm вместо pnpm:
# npm install
```

## ⚙️ Шаг 5: Настройка переменных окружения

```bash
# Создаем файл .env (опционально, если нужны переменные)
nano .env
```

Добавьте (если нужно):
```
PORT=5000
NODE_ENV=production
```

## 🚀 Шаг 6: Запуск через PM2

```bash
# Создаем директорию для логов
mkdir -p logs

# Запускаем сервер через PM2
pm2 start ecosystem.config.js

# Сохраняем конфигурацию PM2 для автозапуска
pm2 save
pm2 startup

# Проверяем статус
pm2 status
pm2 logs bunker-server
```

## 🔥 Шаг 7: Настройка Firewall

```bash
# Устанавливаем UFW (если не установлен)
apt install -y ufw

# Разрешаем SSH
ufw allow 22/tcp

# Разрешаем порт сервера (5000)
ufw allow 5000/tcp

# Включаем firewall
ufw enable

# Проверяем статус
ufw status
```

## 🌐 Шаг 8: Настройка домена (опционально)

Если у вас есть домен на TimeWeb:

1. В панели TimeWeb добавьте A-запись:
   - Имя: `@` или `bunker`
   - Тип: `A`
   - Значение: IP вашего VPS

2. На сервере установите Nginx для проксирования:

```bash
apt install -y nginx certbot python3-certbot-nginx

# Создаем конфиг Nginx
nano /etc/nginx/sites-available/bunker
```

Добавьте:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Активируем конфиг
ln -s /etc/nginx/sites-available/bunker /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Получаем SSL сертификат (опционально)
certbot --nginx -d your-domain.com
```

## 🔍 Шаг 9: Проверка работы

```bash
# Проверяем, что сервер запущен
pm2 status

# Смотрим логи
pm2 logs bunker-server --lines 50

# Проверяем порт
netstat -tulpn | grep 5000
# или
ss -tulpn | grep 5000
```

## 📝 Полезные команды PM2

```bash
# Перезапуск
pm2 restart bunker-server

# Остановка
pm2 stop bunker-server

# Удаление из PM2
pm2 delete bunker-server

# Мониторинг
pm2 monit

# Просмотр логов
pm2 logs bunker-server
pm2 logs bunker-server --lines 100  # последние 100 строк
```

## 🔄 Обновление сервера

```bash
cd /opt/bunker-server/server

# Если через Git:
git pull
pnpm install
pm2 restart bunker-server

# Если через SCP:
# Загрузите новые файлы и выполните:
pnpm install
pm2 restart bunker-server
```

## ⚠️ Важные замечания

1. **Порт 5000**: Убедитесь, что порт открыт в firewall TimeWeb (если есть панель управления)
2. **Автозапуск**: PM2 автоматически запустит сервер после перезагрузки
3. **Логи**: Логи находятся в `./logs/` или через `pm2 logs`
4. **Мониторинг**: Используйте `pm2 monit` для мониторинга ресурсов

## 🆘 Решение проблем

### Сервер не запускается
```bash
# Проверяем логи
pm2 logs bunker-server --err

# Проверяем, занят ли порт
lsof -i :5000
```

### Недостаточно памяти
```bash
# Проверяем использование
free -h
pm2 monit

# Можно уменьшить max_memory_restart в ecosystem.config.js
```

### Проблемы с зависимостями
```bash
# Очищаем кэш и переустанавливаем
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 📞 Поддержка

Если возникли проблемы:
1. Проверьте логи: `pm2 logs bunker-server`
2. Проверьте статус: `pm2 status`
3. Проверьте порт: `netstat -tulpn | grep 5000`


