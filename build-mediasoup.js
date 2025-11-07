// Скрипт для сборки mediasoup worker на Render.com
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Начинаем сборку mediasoup worker...');

// Пробуем найти mediasoup в разных местах (для pnpm и npm)
const possiblePaths = [
  path.join(__dirname, 'node_modules', 'mediasoup'),
  ...fs.readdirSync(path.join(__dirname, 'node_modules', '.pnpm'))
    .filter(dir => dir.startsWith('mediasoup@'))
    .map(dir => path.join(__dirname, 'node_modules', '.pnpm', dir, 'node_modules', 'mediasoup'))
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
  console.log('⚠️ Mediasoup не найден, пропускаем сборку');
  process.exit(0);
}

try {
  process.chdir(mediasoupPath);
  
  // Пробуем собрать worker
  try {
    execSync('npm run build:worker', { stdio: 'inherit' });
    console.log('✅ Worker собран успешно через build:worker!');
    process.exit(0);
  } catch (err) {
    console.log('⚠️ build:worker не найден, пробуем собрать вручную...');
    
    const workerPath = path.join(mediasoupPath, 'worker');
    if (fs.existsSync(workerPath)) {
      process.chdir(workerPath);
      execSync('npm install', { stdio: 'inherit' });
      execSync('npm run build', { stdio: 'inherit' });
      console.log('✅ Worker собран вручную!');
      process.exit(0);
    }
  }
} catch (error) {
  console.log('⚠️ Не удалось собрать worker:', error.message);
  console.log('⚠️ Worker будет собран при первом запуске (если возможно)');
  process.exit(0);
}

