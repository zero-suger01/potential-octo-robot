#!/bin/bash
# Ilova manbasi oxirgi qurishdan keyin o'zgargan bo'lsa — testlar, so'ng .dmg (arm64 + x64) va
# Windows o'rnatuvchisi fon rejimida qayta quriladi. Claude Code Stop hook'i chaqiradi; qo'lda ham bo'ladi.
#   DRY=1 — faqat o'zgarish bormi tekshiradi, qurmaydi
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 0
STATE="$APP/.buildstate"; LOCK="$STATE/building.pid"; STAMP="$STATE/srchash"; LOG="$STATE/build.log"
mkdir -p "$STATE"

HASH=$( { cat package.json server.js data/lists.json fastdump/fastdump.jar
  find lib public electron -type f ! -name .DS_Store -print0 | sort -z | xargs -0 cat; } | shasum | cut -d' ' -f1)
[ "$HASH" = "$(cat "$STAMP" 2>/dev/null)" ] && exit 0
# Qurish allaqachon ketayotgan bo'lsa — u tugagach keyingi chaqiruv yangi o'zgarishni ko'radi
[ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null && exit 0
[ -n "$DRY" ] && { echo "o'zgargan: $HASH"; exit 0; }

nohup bash -c "echo \$\$ > '$LOCK'; npm test && npm run dist && echo '$HASH' > '$STAMP'; rm -f '$LOCK'" > "$LOG" 2>&1 &
cat <<'EOF'
{"systemMessage": "Tomorqa: manba o'zgardi — .dmg va Windows o'rnatuvchisi fonda qayta qurilmoqda (app/dist, jurnal: app/.buildstate/build.log)"}
EOF
