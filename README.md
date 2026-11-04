# Томорқа бот

Online Mahalla 2.0 → **Аҳоли томорқаси** formasini Android emulator yoki USB telefonda avtomatik to'ldiradi.

**Sinov rejimi:** bot 5-bosqichga (Тасдиқлаш) yetadi, natijani ko'rsatadi, **«Юбориш» bosmaydi** va
«Чиқиш» orqali saqlamasdan chiqadi. Ilova ma'lumotni faqat «Юбориш»da yuboradi — yozuv
«Хатлов қилинмаган» holatida qoladi. «Юбориш» kodda bloklangan (`lib/adb.js` → `FORBIDDEN`).

## Ishga tushirish

```bash
cd ~/Desktop/tomorqa/app
npm start          # http://localhost:4173 ochiladi
```

1. **Qurilma:** emulator yoki USB telefonni tanlang. Emulator o'chiq bo'lsa — AVD tanlab «Ishga tushirish».
   Emulator `-camera-back imagefile:../camfeed/current.png` bilan ochiladi: bot har xonadon oldidan
   papkadan tasodifiy rasmni shu faylga yozadi, ilova kamerasi uni «suratga oladi».
   UI emulator shu rejimda ochilganini tekshiradi; bo'lmasa «Kamera bilan qayta ishga tushirish» tugmasi chiqadi.
2. **Tomorqa rasmlari:** «Tanlash…» — macOS papka oynasi (jpg/png/heic), eskizlar ko'rsatiladi.
3. **Ish:** mavsum va xonadonlar soni — bot «Хатлов қилинмаган» ro'yxatidan shuncha xonadonni ketma-ket ochadi.
   Bir run ichida bir xonadon ikki marta ochilmaydi (ЖШШИР xeshi bo'yicha).
   Qo'shimcha: GPS nuqtasi, tasdiqlashda kutish, issiqxona chastotasi.
4. **Hisoblash** — xatlov qilinmaganlar sonini o'qiydi. **Boshlash** — N ta xonadonni to'ldiradi.
   Ishlayotganda: joriy xonadon va bosqich, o'rtacha vaqt, qolgan vaqt (ETA), jonli ekran, natija kartalari.
   «To'xtatish» — joriy xonadondan saqlamasdan chiqib to'xtaydi. «CSV yuklab olish» — oxirgi run hisoboti.

UI dizayni — [Solid Glass](https://github.com/deeplethe/solid-glass) (MIT) materialining vanilla CSS porti
(`public/solid-glass.css`): asl tema React 19 + Tailwind 4 + shadcn talab qiladi, bu yerda build bosqichisiz.
Yorug'/qorong'i mavzu — sarlavhadagi tugma.

## Emulator xotirasi

Emulatorga kamida **4 GB RAM** kerak (`-memory 4096`, AVD'da `hw.ramSize=4096`). 2 GB'da ilova va
`uiautomator` xotiraga sig'maydi: dump OOM bilan o'ldiriladi (`Killed`, rc=137), har amal 2–3 barobar sekinlashadi.
UI'dagi «Ishga tushirish» emulatorni shu sozlama bilan ochadi.

## Tezlik

Eng qimmat amal — `uiautomator dump` (~2.5–3 s: har safar jarayon ishga tushadi va 1 s "idle" kutadi; tap ~0.08 s).
`--compressed` foyda bermaydi. Bot dump sonini kamaytiradi:
- ekran o'zgarmagan joyda oxirgi dumpdan foydalanadi;
- forma maydonlari, mavsum tabi, kamera tugmasi joylashuvi birinchi marta o'qilib keshlanadi;
- qolgan ekin maydoni («Мавжуд майдон») bot tomonida hisoblanadi;
- yangi sana oynasi bugungi sanada ochiladi — boshlang'ich holat o'qilmaydi, faqat oxirida tekshiriladi;
- maydonga yozish va sana g'ildiragi bitta shell chaqiruvida;
- yozuvdan chiqish Back tugmalari bilan, bosqich ma'lum bo'lsa dumpsiz.

"Кейинги" bosishdan oldin har doim yangi dump qilinadi: 5-bosqichda aynan shu joyda «Юбориш» turadi.
Keyingi qadam (ixtiyoriy): qurilmada doimiy UiAutomator2 server — dump ~0.3 s bo'ladi, lekin qurilmaga
qo'shimcha APK o'rnatish va instrumentatsiyani ishga tushirish kerak.

## Xavfsizlik

- Server faqat `127.0.0.1` da; POST so'rovlar faqat shu sahifadan (`Origin` + `Content-Type: application/json` tekshiruvi) —
  brauzerdagi boshqa sayt botni ishga tushira olmaydi.
- `Host` sarlavhasi tekshiriladi (DNS rebinding): begona domen orqali qurilma ekrani va sozlamalar o'qilmaydi.
- Rasm eskizlari faqat UI'da tanlangan papkadan beriladi.
- «Юбориш» `lib/adb.js` → `FORBIDDEN` da bloklangan: matn bo'yicha ham, koordinata bo'yicha ham bosilmaydi.
- Jurnal va hisobotga FIO/ЖШШИР/pasport yozilmaydi; xonadonlar faqat tartib raqami bilan.

Telefon (USB): rasm bosqichida bot kutadi — rasmni telefonda o'zingiz olasiz; GPS — telefonniki.

## To'ldirish qoidalari (`lib/rules.js`, `lib/catalog.js`)

| Bosqich | Qoida |
|---|---|
| 1 Маълумот | «Хонадон умумий майдони» va «Очиқ томорқа майдони» o'qiladi |
| 2 Экин майдони | Экин экиладиган майдон < ochiq maydon: butun qismi (3.9 → 3) yoki 0.1–0.3 kam (3.9 → 3.7). Teng yoki katta bo'lmaydi |
| | Rasm — papkadan tasodifiy; Жойлашув — joriy GPS (emulatorda UI'dagi nuqta); Ҳолат — «Экин экилган» |
| 3 Сув | Ikkalasi «Таъминланган». Tomorqa: Ариқ 70% / Тик қудуқ 15% / Насос 15%. Ichimlik: Артизан 70% / Тик қудуқ 15% / Маҳаллага олиб келинади 15% |
| 4 Экинлар | Ekin maydoni to'liq taqsimlanadi: ochiq ekinlar + issiqxona + daraxtlar = ekin maydoni |
| | Tur soni maydonga qarab: <1.5 → 1, <3 → 1–2, <6 → 2–3, <10 → 3–4, katta → 4–5. Kichik maydonga katta ekin (makka, qovun…) tushmaydi (`minPlot`) |
| | Ekish sanasi: ekin oylariga mos, bugundan 7–150 kun oldin |
| | Issiqxona: faqat umumiy maydon **> 13 sotix** bo'lgan har **20** xonadondan 1 tasiga, 2–3 sotix. Иситиш — Газ'dan boshqa tasodifiy; Молиялаштириш — Ўз маблағлари ҳисобидан; ташкил этилган — 1–2 oy oldin; Қоплама — tasodifiy |
| | Daraxtlar: umumiy maydon **> 4.5 sotix** bo'lgan har **10** xonadondan 1 tasiga (UI: «Daraxt: har N tadan 1») — ekin maydonining 15–30% (0.3–3 sotix), 1–3 tur, soni maydon/daraxt zichligidan, yoshi **2–10 yil**. Daraxt tushmasa, butun maydon ochiq ekinlarga |
| 5 Тасдиқлаш | Ko'rib chiqish, **Юбориш bosilmaydi**, saqlamasdan chiqish |

Ekin katalogi har ekin uchun fasl (bahor/yoz/kuz/qish), ekish oylari va minimal maydonni saqlaydi.
Ilovadagi ro'yxatlar birinchi ishga tushishda o'qib olinadi va `data/lists.json` ga keshlanadi.

## Natijalar

`runs/<vaqt>/report.csv` — har xonadon rejasi (shaxsiy ma'lumotsiz). Xatoda — `xato_N.png` skrinshot
(ekranda shaxsiy ma'lumot bor — tarqatmang).

## Test

```bash
npm test   # qoidalar: 3000 ta tasodifiy xonadon
```
