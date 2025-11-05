# Настройка PM2 для сервера Бункер

## 1. Установка PM2

```bash
npm install -g pm2
```

Или если используете pnpm:
```bash
pnpm add -g pm2
```

## 2. Создание директории для логов (опционально)

```bash
mkdir -p logs
```

## 3. Запуск сервера через PM2

```bash
cd server
pm2 start ecosystem.config.js
```

Или если конфиг не используется:
```bash
pm2 start websocket.js --name bunker-server
```

## 4. Полезные команды PM2

### Просмотр статуса
```bash
pm2 status
```

### Просмотр логов
```bash
pm2 logs bunker-server
pm2 logs bunker-server --lines 100  # последние 100 строк
```

### Управление процессом
```bash
pm2 restart bunker-server    # Перезапуск
pm2 stop bunker-server       # Остановка
pm2 delete bunker-server     # Удаление из pm2
```

### Мониторинг
```bash
pm2 monit                    # Интерактивный мониторинг
```

### Сохранение конфигурации для автозапуска
```bash
pm2 save                      # Сохранить текущие процессы
pm2 startup                   # Настроить автозапуск при загрузке системы
```

## 5. Автозапуск при перезагрузке сервера

```bash
# Сохранить текущие процессы
pm2 save

# Настроить автозапуск (выполнить команду, которую выведет pm2)
pm2 startup
# Скопируйте и выполните команду, которую выведет pm2 (что-то вроде):
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u your_username --hp /home/your_username
```

## 6. Проверка работы

После запуска проверьте:
```bash
pm2 status
pm2 logs bunker-server
```

Сервер должен быть доступен на порту 5000.

