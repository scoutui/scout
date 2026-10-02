#!/bin/sh
# Renders card.html to static/img/social-card.png (1200x630) with headless Chrome.
# Run yarn install first; set CHROME to override the browser path.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="$here/../static/img/social-card.png"
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

for font in geologica/files/geologica-latin-600-normal.woff2 mona-sans/files/mona-sans-latin-500-normal.woff2; do
  if [ ! -f "$here/../../../node_modules/@fontsource/$font" ]; then
    echo "Font $font is missing. Run yarn install, then try again." >&2
    exit 1
  fi
done

profile=$(mktemp -d)
rm -f "$out"
"$chrome" --headless=new --user-data-dir="$profile" --allow-file-access-from-files \
  --hide-scrollbars --window-size=1200,630 --force-device-scale-factor=1 \
  --virtual-time-budget=3000 --screenshot="$out" "file://$here/card.html" >/dev/null 2>&1 &
pid=$!

i=0
while [ ! -s "$out" ] && [ "$i" -lt 60 ]; do
  sleep 0.5
  i=$((i + 1))
done
sleep 1
kill "$pid" 2>/dev/null || true
pkill -f "user-data-dir=$profile" 2>/dev/null || true
rm -rf "$profile"

if [ ! -s "$out" ]; then
  echo "Chrome didn't write the card. Check that CHROME points at a Chrome binary." >&2
  exit 1
fi
echo "Wrote $out"
