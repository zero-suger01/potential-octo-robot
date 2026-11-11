# Томорқа бот

Online Mahalla 2.0 → **Аҳоли томорқаси** formasini USB orqali ulangan Android planshetda avtomatik to'ldiradi. Emulator qo'llab-quvvatlanmaydi.

**Yarim-avtomat:** bot formani 5-bosqichga (Тасдиқлаш) qadar to'ldiradi va **to'xtaydi**.
«Юбориш»ni qurilmada **siz o'zingiz bosasiz** — bot bu tugmani hech qachon bosmaydi
(`lib/adb.js` → `FORBIDDEN`). Bot faqat kutadi va natijani kuzatadi: yozuv yuborilgan bo'lsa
`report.csv` ga `yuborildi` deb yozadi va **keyingi xonadonga o'tadi**; «Чиқиш» bilan bekor
qilinsa — `bekor_qilindi` deb yozib, keyingisiga o'tadi.

## Ishga tushirish

```bash
cd ~/Desktop/tomorqa/app
npm start          # desktop ilova (Electron) oynasi ochiladi
npm run web        # ixtiyoriy: faqat brauzer versiyasi, http://localhost:4173
```

1. **Qurilma:** USB orqali ulangan planshetni tanlang (Developer options → USB debugging).
   Rasm va GPS planshetniki: kamera ochilganda tomorqani o'zingiz suratga olasiz (bot 3 daqiqa kutadi).
2. **Ish:** mavsum va xonadonlar soni — bot «Хатлов қилинмаган» ro'yxatidan shuncha xonadonni ketma-ket ochadi.
   Bir run ichida bir xonadon ikki marta ochilmaydi (ЖШШИР xeshi bo'yicha).
   Qo'shimcha: «Юбориш»ni kutish chegarasi (`0` — cheksiz), issiqxona chastotasi.
3. **Hisoblash** — xatlov qilinmaganlar sonini o'qiydi. **Boshlash** — N ta xonadonni to'ldiradi.
   Har xonadonda bot 5-bosqichda to'xtaydi va **sizni kutadi**: qurilma ekranidagi «Юбориш»ni bosing.
   Bot yuborilganini payqaydi, CSV'ga yozadi va o'zi keyingi xonadonni ochadi — siz faqat tugmani bosasiz.
   Ishlayotganda: joriy xonadon va bosqich, o'rtacha vaqt, qolgan vaqt (ETA), jonli ekran, natija kartalari.
   «To'xtatish» — joriy xonadondan saqlamasdan chiqib to'xtaydi. «CSV yuklab olish» — oxirgi run hisoboti.

UI dizayni — [Solid Glass](https://github.com/deeplethe/solid-glass) (MIT) materialining vanilla CSS porti
(`public/solid-glass.css`): asl tema React 19 + Tailwind 4 + shadcn talab qiladi, bu yerda build bosqichisiz.
Yorug'/qorong'i mavzu — sarlavhadagi tugma.

## Desktop (Electron)

Asosiy ishga tushirish usuli — `npm start` (yoki `dist/` dagi o'rnatuvchi). Web versiya bilan 1:1: `electron/main.js` o'sha `server.js` ni shu jarayonda ishga tushiradi va o'sha `public/` UI'ni
oynada ochadi. 4173 band bo'lsa (`npm run web` ishlab tursa) bo'sh port olinadi — lekin bitta qurilmani ikkalasi bilan
bir vaqtda boshqarmang. Bot ishlayotganda oyna yopilsa, avval tasdiq so'raladi.

O'rnatuvchilar (`dist/`): `npm run dist` → `Tomorqa bot-<v>-arm64.dmg` (Apple Silicon), `Tomorqa bot-<v>.dmg` (Intel),
`Tomorqa bot Setup <v>.exe` (Windows x64). `scripts/build-if-changed.sh` manba o'zgargan bo'lsa ularni fonda qayta quradi
(Claude Code Stop hook'i chaqiradi; jurnal `.buildstate/build.log`). Imzolanmagan: macOS'da birinchi marta o'ng tugma → Open,
Windows'da SmartScreen → "More info" → "Run anyway". Qadoqlangan ilova sozlama va hisobotni
`~/Library/Application Support/tomorqa-bot` (Windows: `%APPDATA%\tomorqa-bot`) da saqlaydi. Har kompyuterda Android SDK
(adb, `platform-tools`) kerak; SDK yo'li `ANDROID_HOME` yoki standart joydan olinadi.

## Planshet maketi va sozlamalar

Ilova yangi versiyada gorizontal planshetda formani **ikki ustunda** ko'rsatadi. Bot shunga moslangan:
ekran o'lchami aylanishni hisobga olib o'qiladi (`dumpsys window displays` → `cur=1920x1200`), har ustun
o'z x koordinatasi bilan suriladi, qator yorlig'i bo'lim sarlavhasidan ajratiladi (sarlavha butun kenglikka
cho'zilgan), tanlangan qiymat tekshiriladi va kerak bo'lsa tanlov qayta bosiladi.

Ekin va mahsulot ro'yxati oynasi: surish ro'yxat bandlari ustida boshlanadi va 900 ms davom etadi
(tezrog'i «fling» bo'lib yo'qoladi), yopish tugmasi `Ёпиш` bo'lmasa yuqori-o'ngdagi X ikonkasi bosiladi.

Muhit o'zgaruvchilari:

- `AUTO_SUBMIT=1` — bot «Юбориш»ni o'zi bosadi (to'liq avtomat). Sukut bo'yicha o'chiq:
  yarim-avtomat rejimda bot bu tugmaga hech qachon tegmaydi.
- `AUTO_PHOTO=1` — faqat sinov uchun: bot kameradagi `Shutter` va `Done` tugmalarini o'zi bosadi.
  Sukut bo'yicha o'chiq, chunki suratning mazmuni muhim — uni planshetda odam oladi.

## Xatlov davri va ekish sanalari

Xatlov yiliga uch marta o'tkaziladi: **1-xatlov** mart, **2-xatlov** iyul oxiri va avgust,
**3-xatlov** oktyabr oxiri va noyabr. Xatlovni UI'dagi **Xatlov** ro'yxatidan qo'lda tanlash mumkin (1/2/3), yoki «Avto» — `campaign()`
bugungi sanadan xatlov raqamini aniqlaydi (`CAMPAIGNS` → `inMonths`). Qo'lda tanlanganda ekish sanasi
shu xatlov oylariga tushadi (oxirgi 400 kundan), fasli ham o'sha xatlovga mos va ekin sanasi faqat shu xatlovning oylaridan olinadi
(3-xatlovda — 9, 10, 11; eng ko'pi 75 kun oldin). Ekin turi ham xatlov fasliga mos tanlanadi
(`lib/catalog.js` dagi `fasl`), ya'ni 3-xatlovda mart yoki iyul sanasi qo'yilmaydi.

## Maydon chegaralari (1 sotix = 100 m²)

Ekin turi maydonga qarab tanlanadi — 1 sotixga buğdoy ekilmaydi, 1 sotixga 20 tup daraxt sig'maydi:

- `lib/catalog.js` → `minArea`: shu ekin uchun real eng kichik maydon (ko'katlar 0.2; karam, помидор 0.4;
  картошка, ловия 1; қовун, тарвуз 2; буғдой, арпа 5 sotix). Maydoni yetmaydigan ekin tanlanmaydi.
- Yuqori chegara: alohida `maxArea` ko'rsatilmasa — `minArea` ning 10 barobari, lekin kamida 2 sotix.
  Shu sababli bitta turga 12 sotix ko'kat tushmaydi; maydon qolsa bot yana ekin turi qo'shadi.
- `splitRange()` maydonni shu quyi va yuqori chegaralar ichida 0.1 sotix qadam bilan taqsimlaydi,
  yig'indi aynan «Экин экиладиган майдон» ga teng bo'ladi.
- Daraxtlar: `TREES` → `perTree` — bitta daraxtga ketadigan maydon (узум 0.06–0.1; ёнғоқ 0.8–1 sotix).
  Daraxt soni maydondan kelib chiqadi va xonadon umumiy sotixidan hamda 12 tadan oshmaydi.

## Tezlik

Eng qimmat amal edi — `uiautomator dump` (~2.5–3 s: har safar jarayon ishga tushadi va 1 s "idle" kutadi; tap ~0.08 s).
`--compressed` foyda bermaydi. Bot dump sonini kamaytiradi:
- ekran o'zgarmagan joyda oxirgi dumpdan foydalanadi;
- forma maydonlari va mavsum tabi joylashuvi birinchi marta o'qilib keshlanadi;
- qolgan ekin maydoni («Мавжуд майдон») bot tomonida hisoblanadi;
- yangi sana oynasi bugungi sanada ochiladi — boshlang'ich holat o'qilmaydi, faqat oxirida tekshiriladi;
- maydonga yozish va sana g'ildiragi bitta shell chaqiruvida;
- yozuvdan chiqish Back tugmalari bilan, bosqich ma'lum bo'lsa dumpsiz.

"Кейинги" bosishdan oldin har doim yangi dump qilinadi: 5-bosqichda aynan shu joyda «Юбориш» turadi,
shuning uchun bot koordinata bo'yicha ham tasodifan bosib yubormasligi kerak.

Doimiy dump serveri (`fastdump/`): qurilmadagi `/system/framework/uiautomator.jar` bilan bir marta ulanadi va
har so'rovda aynan o'sha XML'ni beradi — dump ~0.05–0.5 s (APK o'rnatilmaydi, faqat 3 KB jar
`/data/local/tmp` ga yoziladi). Bosishdan keyin kamida 0.6 s, ekran 0.5 s tinch turguncha kutiladi.
Server ishlamasa bot o'zi eski `uiautomator dump`ga o'tadi. Qayta yig'ish:

```bash
cd fastdump && javac --release 11 -cp $ANDROID_HOME/platforms/android-35/android.jar -d build FastDump.java \
  && $ANDROID_HOME/build-tools/36.0.0/d8 --min-api 26 --lib $ANDROID_HOME/platforms/android-35/android.jar --output fastdump.jar build/*.class
```

## Xavfsizlik

- Server faqat `127.0.0.1` da; POST so'rovlar faqat shu sahifadan (`Origin` + `Content-Type: application/json` tekshiruvi) —
  brauzerdagi boshqa sayt botni ishga tushira olmaydi.
- `Host` sarlavhasi tekshiriladi (DNS rebinding): begona domen orqali qurilma ekrani va sozlamalar o'qilmaydi.
- «Юбориш» `lib/adb.js` → `FORBIDDEN` da bloklangan: bot uni matn bo'yicha ham, koordinata bo'yicha ham
  bosa olmaydi. Uni faqat qurilmadagi odam bosadi — bu rejimning butun mazmuni shu.
- Jurnal va hisobotga FIO/ЖШШИР/pasport yozilmaydi; xonadonlar faqat tartib raqami bilan.

Planshet (USB): rasm bosqichida bot kutadi — rasmni planshetda o'zingiz olasiz; GPS — planshetniki.

## To'ldirish qoidalari (`lib/rules.js`, `lib/catalog.js`)

| Bosqich | Qoida |
|---|---|
| 1 Маълумот | «Хонадон умумий майдони» va «Очиқ томорқа майдони» o'qiladi |
| 2 Экин майдони | Экин экиладиган майдон < ochiq maydon: butun qismi (3.9 → 3) yoki 0.1–0.3 kam (3.9 → 3.7). Teng yoki katta bo'lmaydi |
| | Rasm — planshetda odam oladi; Жойлашув — planshet GPS'i; Ҳолат — «Экин экилган» |
| 3 Сув | Ikkalasi «Таъминланган». Tomorqa: Ариқ 70% / Тик қудуқ 15% / Насос 15%. Ichimlik: Артизан 70% / Тик қудуқ 15% / Маҳаллага олиб келинади 15% |
| 4 Экинлар | Ekin maydoni to'liq taqsimlanadi: ochiq ekinlar + issiqxona + daraxtlar = ekin maydoni |
| | Tur soni maydonga qarab: <1.5 → 1, <3 → 1–2, <6 → 2–3, <10 → 3–4, katta → 4–5. Kichik maydonga katta ekin (makka, qovun…) tushmaydi (`minPlot`) |
| | Ekish sanasi: ekin oylariga mos, bugundan 7–150 kun oldin |
| | Issiqxona: faqat umumiy maydon **> 13 sotix** bo'lgan har **20** xonadondan 1 tasiga, 2–3 sotix. Иситиш — Газ'dan boshqa tasodifiy; Молиялаштириш — Ўз маблағлари ҳисобидан; ташкил этилган — 1–2 oy oldin; Қоплама — tasodifiy |
| | Daraxtlar: umumiy maydon **> 4.5 sotix** bo'lgan har **10** xonadondan 1 tasiga (UI: «Daraxt: har N tadan 1») — ekin maydonining 15–30% (0.3–3 sotix), 1–3 tur, soni maydon/daraxt zichligidan, yoshi **2–10 yil**. Daraxt tushmasa, butun maydon ochiq ekinlarga |
| 5 Тасдиқлаш | Bot to'xtaydi. «Юбориш»ni **odam** bosadi. Bot natijani kuzatadi: yuborilgan → `yuborildi` va keyingi xonadon; «Чиқиш» → `bekor_qilindi`; kutish chegarasi tugasa → `kutilmadi` |

Ekin katalogi har ekin uchun fasl (bahor/yoz/kuz/qish), ekish oylari va minimal maydonni saqlaydi.
Ilovadagi ro'yxatlar birinchi ishga tushishda o'qib olinadi va `data/lists.json` ga keshlanadi.

## Natijalar

`runs/<vaqt>/report.csv` — har xonadon rejasi (shaxsiy ma'lumotsiz). `holat` ustuni:
`yuborildi` (siz «Юбориш»ni bosdingiz), `bekor_qilindi` («Чиқиш»), `kutilmadi` (kutish chegarasi), `xato`.
Xatoda — `xato_N.png` skrinshot (ekranda shaxsiy ma'lumot bor — tarqatmang).

## Test

```bash
npm test   # qoidalar: 3000 ta tasodifiy xonadon
```
