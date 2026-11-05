#!/bin/sh
# Renders the kit SVGs (from make-kit.mjs) to PNG and builds AppIcon.icns.
#
#   sh render.sh <svg-dir> <out-dir>
#
# Needs macOS (sips, iconutil) and Google Chrome. Chrome renders each SVG once at full size on a transparent page;
# sips makes the smaller sizes from that render.
set -eu

mkdir -p "$2"
SVG_DIR=$(cd "$1" && pwd)
OUT=$(cd "$2" && pwd)
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

mkdir -p "$OUT"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# render <svg> <width> <height> <png>
render() {
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="file://%s" width="%s" height="%s">' \
    "$1" "$2" "$3" > "$WORK/page.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$2,$3" --screenshot="$4" "file://$WORK/page.html" >/dev/null 2>&1
}

# resize <src> <width> <dest>
resize() {
  sips --resampleWidth "$2" "$1" --out "$3" >/dev/null
}

# macOS: AppIcon.icns and the 1024 PNG.
render "$SVG_DIR/macos.svg" 1024 1024 "$OUT/macos-1024.png"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  resize "$OUT/macos-1024.png" "$s" "$ICONSET/icon_${s}x${s}.png"
  resize "$OUT/macos-1024.png" $((s * 2)) "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$OUT/AppIcon.icns"

# Expo / iOS full-bleed icon, favicon, Android adaptive layers, splash.
render "$SVG_DIR/fullbleed.svg" 1024 1024 "$OUT/icon.png"
render "$SVG_DIR/favicon.svg" 1024 1024 "$WORK/favicon-1024.png"
resize "$WORK/favicon-1024.png" 48 "$OUT/favicon.png"
render "$SVG_DIR/android-foreground.svg" 1024 1024 "$WORK/fg.png"
resize "$WORK/fg.png" 512 "$OUT/android-icon-foreground.png"
render "$SVG_DIR/android-background.svg" 1024 1024 "$WORK/bg.png"
resize "$WORK/bg.png" 512 "$OUT/android-icon-background.png"
render "$SVG_DIR/android-monochrome.svg" 1024 1024 "$WORK/mono.png"
resize "$WORK/mono.png" 432 "$OUT/android-icon-monochrome.png"
render "$SVG_DIR/splash.svg" 1344 1240 "$WORK/splash.png"
resize "$WORK/splash.png" 228 "$OUT/splash-icon.png"

# Flat mark and silhouette, full size.
render "$SVG_DIR/flat-tile.svg" 1024 1024 "$OUT/flat-tile-1024.png"
render "$SVG_DIR/silhouette.svg" 1024 1024 "$OUT/silhouette-1024.png"

ls -l "$OUT"
