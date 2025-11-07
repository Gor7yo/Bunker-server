// Скрипт для сборки mediasoup worker
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Начинаем сборку mediasoup worker...');

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
  console.error('❌ Mediasoup не найден в node_modules. Проверьте установку.');
  process.exit(1);
}

// Проверяем наличие worker
const workerDir = path.join(mediasoupPath, 'worker');
const workerOutPath = path.join(workerDir, 'out', 'Release', 'mediasoup-worker');

if (fs.existsSync(workerOutPath)) {
  console.log('✅ Mediasoup worker уже собран.');
  process.exit(0);
}

// Собираем worker
if (!fs.existsSync(workerDir)) {
  console.error('❌ Директория worker не найдена:', workerDir);
  process.exit(1);
}

try {
  console.log(`⚙️ Запускаем npm install в директории worker: ${workerDir}...`);
  execSync('npm install', { cwd: workerDir, stdio: 'inherit' });
  
  // Проверяем что worker собран
  if (fs.existsSync(workerOutPath)) {
    console.log('✅ Mediasoup worker успешно собран!');
    process.exit(0);
  } else {
    console.warn('⚠️ npm install завершился, но worker не найден. Возможно нужна дополнительная сборка.');
    console.log('💡 Попробуйте запустить вручную:');
    console.log(`   cd ${workerDir}`);
    console.log('   npm install');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Ошибка при сборке mediasoup worker:', error.message);
  console.log('💡 Попробуйте собрать вручную:');
  console.log(`   cd ${workerDir}`);
  console.log('   npm install');
  process.exit(1);
}

