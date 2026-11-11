// Ekin va daraxt katalogi — Namangan viloyati (Norin tumani) amaliyoti bo'yicha taxminiy.
// name   — ilovadagi aniq nom (ro'yxatdan o'qilgan)
// fasl   — qaysi faslda ekiladi: bahor | yoz | kuz | qish
// months — odatiy ekish/ko'chat o'tqazish oylari (1..12)
// minArea— shu ekin uchun real eng kichik ekish maydoni (sotix; 1 sotix = 100 m²)
// minPlot— xonadon umumiy maydoni shundan kichik bo'lsa tanlanmaydi (sotix)
// w      — ommaviylik (tanlash ehtimoli og'irligi)

const OPEN_CROPS = [
  { name: 'Сабзи', fasl: ['bahor', 'yoz'], months: [3, 4, 7, 8], minArea: 0.3, minPlot: 0, w: 9 },
  { name: 'Пиёз', fasl: ['bahor', 'kuz'], months: [3, 4, 9, 10], minArea: 0.3, minPlot: 0, w: 9 },
  { name: 'Саримсоқпиёз', fasl: ['kuz', 'qish'], months: [10, 11], minArea: 0.3, minPlot: 0, w: 6 },
  { name: 'Карам', fasl: ['bahor', 'yoz'], months: [3, 4, 7], minArea: 0.4, minPlot: 2, w: 5 },
  { name: 'Оқ бошли карам', fasl: ['bahor', 'yoz'], months: [4, 6, 7], minArea: 0.4, minPlot: 3, w: 4 },
  { name: 'Қизил бошли карам', fasl: ['bahor', 'yoz'], months: [4, 7], minArea: 0.4, minPlot: 4, w: 1 },
  { name: 'Гул карам', fasl: ['bahor', 'yoz'], months: [3, 4, 7, 8], minArea: 0.4, minPlot: 3, w: 2 },
  { name: 'Брокколи', fasl: ['bahor', 'yoz'], months: [3, 4, 7, 8], minArea: 0.4, minPlot: 4, w: 1 },
  { name: 'Колраби', fasl: ['bahor', 'yoz'], months: [3, 4, 8], minArea: 0.3, minPlot: 3, w: 1 },
  { name: 'Пекин карами', fasl: ['bahor', 'kuz'], months: [3, 8], minArea: 0.4, minPlot: 3, w: 1 },
  { name: 'Баргли хитой карами', fasl: ['bahor', 'kuz'], months: [3, 8, 9], minArea: 0.4, minPlot: 4, w: 1 },
  { name: 'Салат руколла', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9], minArea: 0.2, minPlot: 2, w: 1 },
  { name: 'Салат айсберг', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9], minArea: 0.2, minPlot: 3, w: 1 },
  { name: 'Айсберг', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9], minArea: 0.2, minPlot: 3, w: 1 },
  { name: 'Селдрей', fasl: ['bahor'], months: [3, 4], minArea: 0.2, minPlot: 3, w: 1 },
  { name: 'Укроп', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9, 10], minArea: 0.2, minPlot: 0, w: 6 },
  { name: 'Петрушка', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9], minArea: 0.2, minPlot: 0, w: 4 },
  { name: 'Кашнич', fasl: ['bahor', 'kuz'], months: [3, 4, 8, 9, 10], minArea: 0.2, minPlot: 0, w: 6 },
  { name: 'Кўкпиёз', fasl: ['bahor', 'kuz'], months: [3, 4, 9, 10], minArea: 0.2, minPlot: 0, w: 5 },
  { name: 'Отқулоқ', fasl: ['bahor', 'kuz'], months: [3, 4, 9], minArea: 0.2, minPlot: 1, w: 1 },
  { name: 'Исмалоқ', fasl: ['bahor', 'kuz'], months: [3, 9, 10], minArea: 0.2, minPlot: 0, w: 3 },
  { name: 'Редиска', fasl: ['bahor', 'kuz'], months: [3, 4, 9, 10], minArea: 0.2, minPlot: 0, w: 5 },
  { name: 'Ош лавлаги', fasl: ['bahor', 'yoz'], months: [4, 5, 7], minArea: 0.3, minPlot: 1, w: 4 },
  { name: 'Шолғом', fasl: ['yoz'], months: [7, 8], minArea: 0.3, minPlot: 2, w: 3 },
  { name: 'Турп', fasl: ['yoz'], months: [7, 8], minArea: 0.3, minPlot: 2, w: 3 },
  { name: 'Ер тути (қулупнай)', fasl: ['bahor', 'kuz'], months: [4, 8, 9], minArea: 0.5, minPlot: 2, w: 2 },
  { name: 'Олтинсимон қорағат (смародина)', fasl: ['bahor', 'kuz'], months: [3, 10], minArea: 0.5, minPlot: 5, w: 1 },
  // Асосий / Такрорий ro'yxatlarida bo'lishi mumkin bo'lgan ekinlar (ilovada topilmasa o'tkazib yuboriladi)
  { name: 'Помидор', fasl: ['bahor'], months: [4, 5], minArea: 0.4, minPlot: 2, w: 8 },
  { name: 'Бодринг', fasl: ['bahor', 'yoz'], months: [4, 5, 6], minArea: 0.4, minPlot: 2, w: 7 },
  { name: 'Қалампир', fasl: ['bahor'], months: [4, 5], minArea: 0.4, minPlot: 2, w: 3 },
  { name: 'Булғор қалампир', fasl: ['bahor'], months: [4, 5], minArea: 0.4, minPlot: 3, w: 3 },
  { name: 'Бақлажон', fasl: ['bahor'], months: [4, 5], minArea: 0.4, minPlot: 3, w: 3 },
  { name: 'Картошка', fasl: ['bahor', 'yoz'], months: [3, 6, 7], minArea: 1.0, minPlot: 4, w: 6 },
  { name: 'Ловия', fasl: ['yoz'], months: [5, 6, 7], minArea: 1.0, minPlot: 4, w: 3 },
  { name: 'Мош', fasl: ['yoz'], months: [6, 7], minArea: 1.0, minPlot: 6, w: 3 },
  { name: 'Қовоқ', fasl: ['bahor'], months: [4, 5], minArea: 1.5, minPlot: 5, w: 2 },
  { name: 'Қовун', fasl: ['bahor'], months: [4, 5], minArea: 2.0, minPlot: 8, w: 2 },
  { name: 'Тарвуз', fasl: ['bahor'], months: [4, 5], minArea: 2.0, minPlot: 8, w: 2 },
  { name: 'Маккажўхори', fasl: ['bahor', 'yoz'], months: [4, 6, 7], minArea: 1.5, minPlot: 10, w: 3 },
  { name: 'Кунгабоқар', fasl: ['bahor'], months: [4, 5], minArea: 1.5, minPlot: 8, w: 1 },
  // Donli ekinlar: katta maydon talab qiladi, kichik tomorqada tanlanmaydi
  { name: 'Буғдой', fasl: ['kuz'], months: [10, 11], minArea: 5, minPlot: 10, w: 2 },
  { name: 'Арпа', fasl: ['kuz'], months: [10, 11], minArea: 5, minPlot: 10, w: 1 },
];

// Issiqxona ekinlari (ilova ro'yxatidan, issiqxonada odatiylari)
const GREENHOUSE_CROPS = [
  { name: 'Помидор', w: 8, minArea: 0.5 },
  { name: 'Бодринг', w: 8, minArea: 0.5 },
  { name: 'Булғор қалампир', w: 3, minArea: 0.5 },
  { name: 'Лимон', w: 3, minArea: 1 },
  { name: 'Ер тути (қулупнай)', w: 2, minArea: 0.5 },
  { name: 'Кўкпиёз', w: 2, minArea: 0.3 },
  { name: 'Укроп', w: 2, minArea: 0.3 },
];

// Daraxtlar: age — odatiy yosh oralig'i, perTree — bitta daraxt egallaydigan maydon (sotix);
// bog' ekish sxemasi bo'yicha (masalan o'rik 5×6 m ≈ 0.3 sotix), tomorqada biroz zichroq
// Daraxt yoshi 10 yildan oshmaydi
const TREES = [
  { name: 'Ўрик', minPlot: 0, w: 8, age: [3, 10], perTree: [0.25, 0.35] },
  { name: 'Олма', minPlot: 0, w: 8, age: [3, 10], perTree: [0.15, 0.25] },
  { name: 'Шафтоли', minPlot: 0, w: 6, age: [2, 10], perTree: [0.15, 0.25] },
  { name: 'Гилос', minPlot: 0, w: 6, age: [3, 10], perTree: [0.25, 0.35] },
  { name: 'Олча', minPlot: 0, w: 3, age: [2, 10], perTree: [0.1, 0.15] },
  { name: 'Нок', minPlot: 0, w: 4, age: [3, 10], perTree: [0.2, 0.3] },
  { name: 'Олхўри', minPlot: 0, w: 3, age: [3, 10], perTree: [0.12, 0.2] },
  { name: 'Беҳи', minPlot: 0, w: 4, age: [3, 10], perTree: [0.12, 0.2] },
  { name: 'Анор', minPlot: 0, w: 5, age: [2, 10], perTree: [0.08, 0.12] },
  { name: 'Анжир', minPlot: 0, w: 4, age: [2, 10], perTree: [0.12, 0.2] },
  { name: 'Хурмо', minPlot: 0, w: 3, age: [3, 10], perTree: [0.2, 0.3] },
  { name: 'Узум', minPlot: 0, w: 8, age: [3, 10], perTree: [0.06, 0.1] },
  { name: 'Ёнғоқ', minPlot: 10, w: 3, age: [5, 10], perTree: [0.8, 1] },
  { name: 'Жийда', minPlot: 8, w: 1, age: [5, 10], perTree: [0.3, 0.4] },
];

// Tanlov menyulari (ilovadagi aniq matn)
const WATER_PLOT_TYPES = [['Оқар сув (Ариқ)', 70], ['Тик қудуқ', 15], ['Насос кўмагида олиб келинади', 15]];
const WATER_DRINK_TYPES = [['Марказлашган (Артизан)', 70], ['Тик қудуқ', 15], ['Марказлашган тартибда маҳаллага олиб келинади', 15]];
const GH_HEATING = ['Электр токи', 'Кўмир', 'Мавжуд эмас']; // Газ — ataylab yo'q
const GH_FUNDING = 'Ўз маблағлари ҳисобидан';
const GH_COVER = ['Ойнали', 'Полиэтинли қоплама'];

module.exports = { OPEN_CROPS, GREENHOUSE_CROPS, TREES, WATER_PLOT_TYPES, WATER_DRINK_TYPES, GH_HEATING, GH_FUNDING, GH_COVER };
