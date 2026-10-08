/**
 * Performance Warehouse — запуск онлайн-сервера склада на хостинге
 * (ISPmanager «Node.js», Phusion Passenger, любой хостинг с Node.js 22).
 *
 * Укажите этот файл как «Файл запуска» (startup file) приложения Node.js.
 * Настройки — в pw-config.json рядом с этим файлом.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\nPerformance Warehouse: нужна версия Node.js 22.13 или новее, сейчас ${process.versions.node}.\n` +
    'В панели ISPmanager выберите для сайта версию Node.js 22 (или новее) и перезапустите приложение.\n' +
    'Если такой версии в списке нет — попросите поддержку хостинга включить Node.js 22.\n');
  process.exit(1);
}

const cfgFile = path.join(__dirname, 'pw-config.json');
let cfg = {};
try {
  if (fs.existsSync(cfgFile)) cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
} catch (e) {
  console.error('Ошибка в pw-config.json (проверьте запятые и кавычки):', e.message);
  process.exit(1);
}

/** Значение из pw-config.json, если такая переменная окружения не задана в панели. */
const set = (name, value) => {
  if (value === undefined || value === null || value === '' || process.env[name] !== undefined) return;
  process.env[name] = String(value);
};
set('PW_HOME', __dirname);
set('PW_ONLINE', cfg.online === false ? '0' : '1');
set('PW_PUBLIC_URL', cfg.publicUrl);
set('PW_DATA', cfg.dataDir || '../pw-data');
set('PW_WEB', cfg.webDir || 'web');
set('PW_TRUST_PROXY', cfg.behindProxy === false ? '0' : '1');
set('PW_HOST', cfg.host || '127.0.0.1');
// порт, который назначила панель хостинга (переменная PORT), важнее порта из pw-config.json
if (!process.env.PORT) set('PW_PORT', cfg.port);
set('PW_SETUP_CODE', cfg.setupCode);

require('./pw-server.cjs').runCli();
