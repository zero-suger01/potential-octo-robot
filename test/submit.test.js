// 5-bosqichni kutish mantiqi: bot «Юбориш»ni bosmasdan, odamning harakatini qanday aniqlaydi.
const assert = require('assert');
const { Bot } = require('../lib/bot');

// awaitSubmit faqat activity/dump/has dan foydalanadi — qolganini soxta qilib beramiz
function fakeBot(script) {
  const b = new Bot({ serial: 'fake', submitWaitSec: 0 }, () => {});
  b.size = { w: 1080, h: 1920 };
  b.view = { top: 500, bottom: 1600 };
  b.mid = 540;
  let i = 0;
  const step = () => script[Math.min(i++, script.length - 1)];
  b.d = {
    emulator: false,
    nodes: [],
    dumps: 0,
    async activity() { return step().act; },   // House holdPlotDetailsActivity | HouseholdPlotActivity
    async dump() { b.d.dumps++; b.d.nodes = step().nodes || []; },
    has(t) { return b.d.nodes.some((n) => n.text === t); },
    find() { return null; },
    async tapNode() {},
  };
  return b;
}
const D = 'HouseholdPlotDetailsActivity', L = 'HouseholdPlotActivity';
const logs = [];
const run = async (b) => { b.log = (m) => logs.push(m); return b.awaitSubmit(1); };

(async () => {
  // 1. Odam «Юбориш»ni bosdi — forma yopildi, ro'yxatga qaytdi
  let b = fakeBot([{ act: D, nodes: [{ text: 'Юбориш' }] }, { act: D, nodes: [{ text: 'Юбориш' }] }, { act: L }]);
  assert.equal(await run(b), 'submitted', 'yuborilganda submitted');

  // 2. Odam «Чиқиш»ni bosdi — tasdiqlash oynasi chiqdi, keyin ro'yxat
  b = fakeBot([{ act: D, nodes: [{ text: 'Чиқишни тасдиқланг' }, { text: 'Чиқиш' }] }, { act: D, nodes: [{ text: 'Чиқишни тасдиқланг' }] }, { act: L }]);
  assert.equal(await run(b), 'discarded', 'bekor qilinganda discarded');

  // 3. Hech kim bosmadi — kutish chegarasi tugadi
  b = fakeBot([{ act: D, nodes: [{ text: 'Юбориш' }] }]);
  b.cfg.submitWaitSec = 1;
  b.check = () => {}; // cheksiz sikl bo'lmasin
  const t = await run(b);
  assert.equal(t, 'timeout', 'kutish chegarasida timeout');

  // 4. Bot hech qachon «Юбориш»ni bosmaydi: kutish davomida tapNode chaqirilmaydi
  b = fakeBot([{ act: D, nodes: [{ text: 'Юбориш' }] }]);
  b.cfg.submitWaitSec = 1;
  let taps = 0;
  b.d.tapNode = async () => { taps++; };
  await run(b);
  assert.equal(taps, 0, 'kutish paytida hech narsa bosilmaydi');

  // 5. To'xtatish: check() STOP tashlaydi
  b = fakeBot([{ act: D, nodes: [{ text: 'Юбориш' }] }]);
  b.stop();
  await assert.rejects(() => run(b), /STOP/);

  console.log('OK: yarim-avtomat kutish mantiqi (5 holat)');
})();
