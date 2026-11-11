// Platformaga bog'liq yo'llar va tizim amallari: macOS (asosiy), Windows, Linux.
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (
  MAC ? path.join(os.homedir(), 'Library/Android/sdk')
    : WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : path.join(os.homedir(), 'Android', 'Sdk'));
const ADB = path.join(SDK, 'platform-tools', `adb${EXE}`);

// Yoziladigan fayllar: web versiyada loyiha papkasi; qadoqlangan desktop ilovada TOMORQA_HOME
// (ilova ichi — app.asar — faqat o'qiladi)
const ROOT = path.join(__dirname, '..');
const HOME = process.env.TOMORQA_HOME || ROOT;
const DATA = path.join(HOME, 'data');
const RUNS = path.join(HOME, 'runs');

// app.asar ichidagi fayl tashqi dasturga (adb) berilsa — ochilgan nusxasi (asarUnpack)
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Papka yoki havolani tizim dasturida ochish
function openExternal(target) {
  spawn(MAC ? 'open' : WIN ? 'explorer' : 'xdg-open', [target], { stdio: 'ignore', detached: true }).unref();
}

module.exports = { MAC, WIN, SDK, ADB, ROOT, HOME, DATA, RUNS, unpacked, openExternal };
