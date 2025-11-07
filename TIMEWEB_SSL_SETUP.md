# 🔒 Настройка SSL (WSS) для bunker-server.ru

## 📋 Требования
- Домен: `api.bunker-server.ru` (поддомен, который уже пингуется)
- Сервер: `195.80.51.69`
- Nginx установлен

## 🔧 ШАГ 1: Проверка DNS

Проверь что поддомен пингуется:
```bash
ping api.bunker-server.ru
# Должен показать IP: 195.80.51.69
```

Если `api.bunker-server.ru` уже пингуется - отлично! Можно продолжать.

**Примечание:** Если корневой домен `bunker-server.ru` не пингуется, это нормально - DNS для корневого домена может обновляться дольше (до 24-48 часов). Используем поддомен `api.bunker-server.ru` который уже работает.

---

## 📦 ШАГ 2: Установка Nginx и Certbot

На сервере выполни:

```bash
# Обновляем систему
apt update

# Устанавливаем Nginx
apt install -y nginx

# Устанавливаем Certbot для SSL сертификатов
apt install -y certbot python3-certbot-nginx

# Проверяем что Nginx запущен
systemctl status nginx
```

---

## ⚙️ ШАГ 3: Настройка Nginx

### 3.1. Создаем конфигурацию

```bash
nano /etc/nginx/sites-available/bunker-server
```

Вставь следующую конфигурацию:

```nginx
server {
    listen 80;
    server_name api.bunker-server.ru;

    # Временная конфигурация для получения SSL
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

Сохрани: `Ctrl+O`, `Enter`, `Ctrl+X`

### 3.2. Активируем конфигурацию

```bash
# Создаем симлинк
ln -s /etc/nginx/sites-available/bunker-server /etc/nginx/sites-enabled/

# Удаляем дефолтный конфиг (если есть)
rm -f /etc/nginx/sites-enabled/default

# Проверяем конфигурацию
nginx -t

# Перезагружаем Nginx
systemctl reload nginx
```

---

## 🔐 ШАГ 4: Получение SSL сертификата

```bash
# Получаем SSL сертификат от Let's Encrypt для поддомена
certbot --nginx -d api.bunker-server.ru
```

**Во время установки:**
1. Введи email (для уведомлений о продлении)
2. Согласись с условиями (A)
3. Выбери редирект на HTTPS (2)

Certbot автоматически обновит конфигурацию Nginx!

---

## ✅ ШАГ 5: Проверка конфигурации

После получения SSL, конфигурация будет автоматически обновлена. Проверь:

```bash
# Проверяем конфигурацию
nginx -t

# Перезагружаем Nginx
systemctl reload nginx

# Проверяем статус
systemctl status nginx
```

### 5.1. Проверка в браузере

Открой в браузере:
- `https://api.bunker-server.ru` - должен показать ошибку WebSocket (это нормально, нужен клиент)
- Проверь что есть замочек 🔒 (SSL активен)

---

## 🔄 ШАГ 6: Автопродление SSL

Certbot автоматически настроит автопродление, но проверим:

```bash
# Тестируем автопродление
certbot renew --dry-run

# Если все ок - сертификат будет продлеваться автоматически
```

---

## 🚀 ШАГ 7: Обновление клиента

После настройки SSL, обнови клиент:

**`client/src/pages/JoinRoom/JoinRoom.jsx`:**
```javascript
const socket = new WebSocket("wss://api.bunker-server.ru");
```

**`client/src/pages/AdminPanel/AdminPanel.jsx`:**
```javascript
const wsUrl = 'wss://api.bunker-server.ru';
```

**Примечание:** Клиент уже обновлен на `api.bunker-server.ru` ✅

---

## 🆘 Решение проблем

### ❌ Ошибка: "Timeout during connect (likely firewall problem)"

Эта ошибка означает, что порт 80 заблокирован. Решение:

#### 1. Открой порты в UFW на сервере:
```bash
# Открой порты HTTP и HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Проверь статус
ufw status
```

#### 2. Открой порты в панели TimeWeb:
1. Зайди в панель управления TimeWeb
2. Найди свой VPS сервер
3. Открой раздел "Firewall" или "Брандмауэр"
4. Добавь правила:
   - Порт `80` (HTTP) - разрешить
   - Порт `443` (HTTPS) - разрешить
5. Сохрани изменения

#### 3. Проверь что Nginx слушает порт 80:
```bash
# Проверь что Nginx запущен
systemctl status nginx

# Проверь что порт 80 слушается
ss -tulpn | grep :80
# Должно показать: nginx слушает на 0.0.0.0:80

# Если не слушает - перезапусти Nginx
systemctl restart nginx
```

#### 4. Проверь доступность извне:
```bash
# С другого компьютера или через онлайн-сервис проверь:
# http://api.bunker-server.ru
# Должен показать ответ от сервера (даже если ошибка)
```

#### 5. Повтори получение SSL:
```bash
certbot --nginx -d api.bunker-server.ru
```

### DNS не обновился
```bash
# Проверь DNS
nslookup api.bunker-server.ru
dig api.bunker-server.ru

# Если не показывает правильный IP - подожди еще
```

### WebSocket не работает через Nginx
Убедись что в конфигурации есть:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Проверка логов
```bash
# Логи Nginx
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log

# Логи сервера
pm2 logs bunker-server
```

---

## 📝 Финальная конфигурация Nginx (после SSL)

После получения SSL, конфигурация будет примерно такой:

```nginx
server {
    listen 80;
    server_name api.bunker-server.ru;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.bunker-server.ru;

    ssl_certificate /etc/letsencrypt/live/api.bunker-server.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.bunker-server.ru/privkey.pem;
    
    # SSL настройки (Certbot добавит автоматически)
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Таймауты для WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

---

## ✅ Готово!

После настройки:
- ✅ Домен работает через HTTPS
- ✅ WebSocket работает через WSS
- ✅ Клиент может подключаться безопасно
- ✅ SSL автоматически продлевается

**Обнови клиент на `wss://bunker-server.ru` и протестируй!**

