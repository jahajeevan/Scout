#!/bin/bash
# Apply YOUR custom icon to Scout, shaped into a proper macOS squircle (rounded
# corners + padding) so it looks native, then rebuild Scout.app.
#
#   bash macos/apply_icon.sh /path/to/your_icon.png
set -e
SRC="$1"
REPO="/Users/apple/jarvis"
ASSETS="$REPO/macos/assets"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: bash macos/apply_icon.sh /path/to/your_icon.png"; exit 1
fi

# Round the corners + add macOS padding (transparent margin, squircle mask).
"$REPO/.venv/bin/python3.11" - "$SRC" "$ASSETS/Scout.png" <<'PY'
import sys
from PIL import Image, ImageDraw
src_path, out_path = sys.argv[1], sys.argv[2]
src = Image.open(src_path).convert("RGBA")
s = min(src.size)  # centre-crop to square
src = src.crop(((src.width - s)//2, (src.height - s)//2, (src.width - s)//2 + s, (src.height - s)//2 + s))
CANVAS, CONTENT, RAD = 1024, 840, 188   # macOS icon grid: ~82% tile, ~22% corner
margin = (CANVAS - CONTENT)//2
content = src.resize((CONTENT, CONTENT), Image.LANCZOS)
mask = Image.new("L", (CONTENT, CONTENT), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, CONTENT-1, CONTENT-1], RAD, fill=255)
canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
canvas.paste(content, (margin, margin), mask)
canvas.save(out_path)
print("shaped ->", out_path)
PY

# Build the .icns from the rounded master.
TMP="$(mktemp -d)/Scout.iconset"; mkdir -p "$TMP"
for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$ASSETS/Scout.png" --out "$TMP/icon_${sz}x${sz}.png" >/dev/null
  sips -z "$((sz*2))" "$((sz*2))" "$ASSETS/Scout.png" --out "$TMP/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$TMP" -o "$ASSETS/Scout.icns"
echo "Icon applied → $ASSETS/Scout.icns + Scout.png"

bash "$REPO/macos/build_app.sh"
touch "$REPO/Scout.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$REPO/Scout.app" 2>/dev/null || true
echo "Rebuilt Scout.app with your icon — quit & reopen Scout to see it."
