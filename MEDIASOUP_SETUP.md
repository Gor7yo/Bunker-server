# Настройка Mediasoup на сервере Selectel (Ubuntu)

## 1. Требования

- Ubuntu сервер на Selectel
- Node.js (рекомендуется v18+)
- Открытые порты для медиа-трафика

## 2. Настройка портов

Mediasoup использует UDP порты для RTP/RTCP трафика. Нужно открыть диапазон портов:

```bash
# Открыть порты 40000-49999 для UDP
sudo ufw allow 40000:49999/udp
sudo ufw allow 5000/tcp  # WebSocket порт
```

## 3. Переменные окружения

Создайте файл `.env` в папке `server/`:

```env
PORT=5000
NODE_ENV=production
MEDIASOUP_ANNOUNCED_IP=ВАШ_ВНЕШНИЙ_IP_СЕРВЕРА
```

**Важно:** `MEDIASOUP_ANNOUNCED_IP` должен быть внешним IP адресом вашего сервера Selectel. 
Узнать IP можно командой:
```bash
curl ifconfig.me
```

## 4. Установка зависимостей

```bash
cd server
pnpm install
# или
npm install
```

## 5. Запуск сервера

```bash
# С PM2 (рекомендуется)
pm2 start websocket.js --name bunker-server

# Или напрямую
node websocket.js
```

## 6. Проверка работы

1. Проверьте логи сервера - должно быть сообщение "✅ Mediasoup инициализирован"
2. Проверьте, что порты открыты: `sudo ufw status`
3. Проверьте подключение клиентов

## 7. Troubleshooting

### Проблема: "Transport connection failed"
- Проверьте, что `MEDIASOUP_ANNOUNCED_IP` установлен правильно
- Проверьте, что порты открыты в firewall
- Проверьте, что сервер доступен извне

### Проблема: "Worker died"
- Проверьте логи сервера
- Убедитесь, что порты не заняты другими процессами
- Проверьте доступную память: `free -h`

### Проблема: Нет видео/аудио
- Проверьте, что клиент использует `useMediasoup` вместо `useWebRTC`
- Проверьте консоль браузера на ошибки
- Убедитесь, что разрешения камеры/микрофона выданы

## 8. Мониторинг

Для мониторинга производительности можно использовать:

```bash
# PM2 мониторинг
pm2 monit

# Логи
pm2 logs bunker-server
```

## 9. Оптимизация

Для лучшей производительности на сервере Selectel:

1. Увеличьте лимиты файловых дескрипторов:
```bash
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
```

2. Настройте sysctl для лучшей работы с сетью:
```bash
sudo sysctl -w net.core.rmem_max=16777216
sudo sysctl -w net.core.wmem_max=16777216
```

