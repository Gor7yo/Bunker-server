// Скрипт для проверки mediasoup worker на Render.com
// Mediasoup автоматически скачивает prebuilt worker при установке,
// поэтому ручная сборка не нужна

const fs = require('fs');
const path = require('path');

console.log('🔍 Проверяем наличие mediasoup worker...');

// Пробуем найти mediasoup в разных местах (для pnpm и npm)
const possiblePaths = [
  path.join(__dirname, 'node_modules', 'mediasoup'),
  ...(fs.existsSync(path.join(__dirname, 'node_modules', '.pnpm')) 
    ? fs.readdirSync(path.join(__dirname, 'node_modules', '.pnpm'))
        .filter(dir => dir.startsWith('mediasoup@'))
        .map(dir => path.join(__dirname, 'node_modules', '.pnpm', dir, 'node_modules', 'mediasoup'))
    : [])
];

let mediasoupPath = null;
for (const testPath of possiblePaths) {
  if (fs.existsSync(testPath)) {
    mediasoupPath = testPath;
    console.log(`📦 Найден mediasoup в: ${testPath}`);
    break;
  }
}

if (!mediasoupPath) {
  console.log('⚠️ Mediasoup не найден');
  process.exit(0);
}

// Проверяем наличие worker
const workerPath = path.join(mediasoupPath, 'worker', 'out', 'Release', 'mediasoup-worker');
if (fs.existsSync(workerPath)) {
  console.log('✅ Mediasoup worker найден (prebuilt)');
  process.exit(0);
} else {
  console.log('⚠️ Mediasoup worker не найден, но он будет скачан автоматически при первом запуске');
  console.log('ℹ️ Mediasoup использует prebuilt worker, ручная сборка не требуется');
  process.exit(0);
}

