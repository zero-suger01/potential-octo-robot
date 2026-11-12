// Mac kompyuterdagi rasm papkasidan tasodifiy bir rasmni planshetga uzatadi.
// Manzil: OM external files — PhotoCaptureActivity shu fayldan o'qib kameradan chiqarish o'rniga uni ishlatadi.
const fs = require('fs');
const path = require('path');
const { run } = require('./adb');

const DEST = '/sdcard/Android/data/uz.realsoft.onlinemahalla.assistant/files/om_current.jpg';
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function listImages(folder) {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
  return fs.readdirSync(folder)
    .filter((f) => EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(folder, f));
}

async function pushRandom(serial, folder) {
  const imgs = listImages(folder);
  if (imgs.length === 0) throw new Error('Papkada rasm topilmadi (.jpg/.jpeg/.png/.webp)');
  const pick = imgs[Math.floor(Math.random() * imgs.length)];
  await run(['-s', serial, 'shell', 'mkdir', '-p', path.dirname(DEST)]);
  await run(['-s', serial, 'push', pick, DEST]);
  return { file: path.basename(pick), count: imgs.length };
}

module.exports = { pushRandom, listImages, DEST };
