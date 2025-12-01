> Руководство: как подключить Janus SFU для одной комнаты (до 8 человек)

## 1. Сервер и домен

1. **Аренда VPS.** Выбери любого провайдера (Hetzner, OVH, DigitalOcean, Timeweb Cloud и т.д.) и создай инстанс с Ubuntu 22.04 LTS. Для 1 комнаты / 8 участников достаточно 1 vCPU и 1–2 ГБ RAM. Во время заказа привяжи свой SSH‑ключ (если есть), чтобы не возиться с паролями.
2. **Порты и firewall.** После первого входа (SSH `ssh root@IP`) проверь настройки firewall.  
   - Оставь открытыми TCP 22 (SSH), 80 и 443 (HTTP/HTTPS для Nginx/certbot).  
   - Разреши UDP диапазон 10000–10200 (Janus по умолчанию использует его для медиа).  
   - На Ubuntu можно воспользоваться `ufw`:
     ```bash
     ufw allow 22/tcp
     ufw allow 80/tcp
     ufw allow 443/tcp
     ufw allow 10000:10200/udp
     ufw enable
     ```
   - Если провайдер использует собственные security groups (AWS, GCP, etc.) — открой тот же набор портов там.
3. **DNS‑запись.** В панели домена (у регистратора или в Cloudflare) создай A‑запись:
   - Имя: `janus` (или любое)  
   - Значение: публичный IP VPS (например `203.0.113.10`)  
   - TTL можно оставить стандартный (300 секунд).  
   После сохранения подожди 5–30 минут, пока запись распространится. Проверить можно командой `nslookup janus.<твой_домен>` или `dig janus.<твой_домен>`.

## 2. Установка Janus

### Вариант A: Docker (рекомендовано)
```bash
ssh root@YOUR_IP
apt update && apt install -y ca-certificates curl gnupg
# Установка Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

mkdir -p /opt/janus/conf /opt/janus/logs
cat > /opt/janus/docker-compose.yml <<'EOF'
version: "3.8"
services:
  janus:
    image: candango/janus-gateway:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./conf:/usr/local/etc/janus
      - ./logs:/var/log/janus
EOF

cd /opt/janus
docker compose up -d
docker compose logs -f
```

### Вариант B: Сборка из исходников
```bash
apt install -y build-essential automake libtool pkg-config \
  libmicrohttpd-dev libjansson-dev libssl-dev libsrtp2-dev \
  libnice-dev libsofia-sip-ua-dev libglib2.0-dev libopus-dev \
  libogg-dev libcurl4-openssl-dev liblua5.3-dev libconfig-dev \
  libwebsockets-dev git cmake

cd /opt
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus --enable-rest --enable-websockets --enable-data-channels
make && make install && make configs
/opt/janus/bin/janus   # запуск
```

## 3. SSL и Nginx (reverse proxy)

1. Установи nginx и certbot:
```bash
apt install -y nginx certbot python3-certbot-nginx
certbot --nginx -d janus.<твой_домен>
```

2. Создай `/etc/nginx/sites-available/janus.conf`:
```nginx
server {
    listen 80;
    server_name janus.<твой_домен>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name janus.<твой_домен>;

    ssl_certificate     /etc/letsencrypt/live/janus.<твой_домен>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/janus.<твой_домен>/privkey.pem;

    location /janus {
        proxy_pass http://127.0.0.1:8088/janus;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```
3. Активируй конфиг:
```bash
ln -s /etc/nginx/sites-available/janus.conf /etc/nginx/sites-enabled/janus.conf
nginx -t && systemctl reload nginx
```

## 4. Конфигурация Janus

- Основной файл `janus.jcfg`:
  - Включи `http` (порт 8088, `interface = "127.0.0.1"`).
  - Включи `websockets` (порт 8188, `interface = "127.0.0.1"`, TLS не нужен — делает Nginx).
  - Если нужен 1:1 NAT — в секции `nat` пропиши `nat_1_1_mapping = "<публичный_IP>"`.

- Файл `janus.plugin.videoroom.jcfg`:
```cfg
rooms = [
  {
    room = 1234
    description = "Bunker main room"
    publishers = 8
    bitrate = 512000
    fir_freq = 10
  }
]
```

Перезапусти Janus (`docker compose restart` или `pkill janus && /opt/janus/bin/janus`).

## 5. Smoke‑тест

- Открой демо `videoroomtest.html` (из `/usr/local/share/janus/demos`).
- Зайди по адресу `https://janus.<домен>/demos/videoroomtest.html`.
- Укажи `Server = https://janus.<домен>/janus`, Room=`1234`.
- Зайди двумя вкладками → должен появиться видео‑чат.

## 6. Интеграция с фронтендом

### Подключение `janus.js`
- Добавь в `public/` файл `janus.js` (взять из `/usr/local/share/janus/demos/janus.js`) или подключи CDN.
- В `index.html`: `<script src="/janus.js"></script>`.

### Базовый хук `useJanus` (идея)

1. `Janus.init({ debug: true, dependencies: Janus.useDefaultDependencies() })`.
2. Создай `janus = new Janus({ server: "https://janus.<домен>/janus", success, error })`.
3. В `success` → `janus.attach({ plugin: "janus.plugin.videoroom", ... })`.
4. После `join` → `createOffer` и `publish` (локальная камера).
5. Обрабатывай `onmessage` → `new_publisher` → создавай `newRemoteFeed`.
6. В `onlocalstream`/`onremotestream` вешай `<video>` (как в `useWebRTC`).

## 7. Взаимодействие с существующим бэкендом

- Твой `websocket.js` (игровая логика) остаётся без изменений.
- Клиент: при входе в лобби / игру → одновременно подключается к Janus и к твоему WebSocket.
- RoomID (`1234`) можно зашить в конфиг клиента.

## 8. Дополнительно

- Настрой порты/Firewall (UDP 10000–10200).
- Мониторинг: смотри `docker compose logs` или `/var/log/janus/`.
- Настройки качества: в `janus.plugin.videoroom.jcfg` можно менять `bitrate`, `video_codec`.
- Отключение камеры: `pluginHandle.send({ message: { request: "configure", video: false } })`.

После прохождения шагов у тебя будет рабочий Janus SFU с HTTPS/WSS, и ты сможешь интегрировать его в текущий React‑клиент вместо `useWebRTC`.


