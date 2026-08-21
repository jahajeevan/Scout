#!/bin/bash
# Build a lightweight native **Scout.app** (menu-bar Halo helper) that wraps the
# existing venv + macos/scout.py. Reliable — no py2app dependency-bundling — and
# gives Scout its own macOS identity (com.scout.app) for TCC permissions.
#
# The app auto-starts the backend + web if they aren't running, then runs the
# Halo/wake helper. Double-click Scout.app (or add it to Login Items) and go.
#
#   bash macos/build_app.sh      # -> ./Scout.app
set -e
REPO="/Users/apple/jarvis"
APP="$REPO/Scout.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$REPO/macos/assets/Scout.icns" "$APP/Contents/Resources/Scout.icns" 2>/dev/null || true

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Scout</string>
  <key>CFBundleDisplayName</key><string>Scout</string>
  <key>CFBundleIdentifier</key><string>com.scout.app</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>Scout</string>
  <key>CFBundleIconFile</key><string>Scout.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSMicrophoneUsageDescription</key><string>Scout listens for "Hey Scout" and your voice commands.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Scout transcribes your speech locally on your Mac.</string>
  <key>NSAppleEventsUsageDescription</key><string>Scout opens and controls the apps you ask it to.</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/Scout" <<'LAUNCH'
#!/bin/bash
# Scout.app is a thin trigger: it starts the Scout LaunchAgents (which run in the
# GUI login session so the menu-bar orb actually shows) and opens the workspace
# window. It does NOT run its own python instance (a LaunchServices-launched
# python can't show the menu-bar item).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Backend + web (via its LaunchAgent) if not already answering.
if ! curl -s -o /dev/null -m1 http://localhost:8000/health; then
  launchctl start com.scout.backend 2>/dev/null
fi

# Menu-bar app (orb) via its LaunchAgent — GUI session, so the item shows.
if ! pgrep -f "macos/scout.py" >/dev/null 2>&1; then
  launchctl start com.scout.menubar 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "macos/scout.py" >/dev/null && break; sleep 1; done
fi

# Ask the running Scout to open its workspace window.
touch /tmp/scout_open_window
exit 0
LAUNCH
chmod +x "$APP/Contents/MacOS/Scout"

# Refresh Finder's icon cache for the new bundle.
touch "$APP"
echo "Built $APP"
