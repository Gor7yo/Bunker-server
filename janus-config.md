# Инструкция по установке Janus SFU сервера

## Вариант 1: Docker (рекомендуется)

### 1. Установите Docker Desktop
Скачайте с https://www.docker.com/products/docker-desktop

### 2. Запустите Janus сервер

```bash
docker run -d \
  --name janus \
  -p 8088:8088 \
  -p 8089:8089 \
  -p 8188:8188 \
  -p 8189:8189 \
  -p 20000-20050:20000-20050/udp \
  canyan/janus
```

### 3. Проверьте работу
Откройте в браузере: http://localhost:8088/janus/info

## Вариант 2: Установка из исходников

Требуется компиляция, сложнее. Рекомендую Docker.

## После установки

Janus будет доступен на:
- HTTP API: http://localhost:8088
- WebSocket: ws://localhost:8188
- STUN/TURN: порты 20000-20050

