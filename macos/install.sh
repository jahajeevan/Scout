#!/bin/bash
# Install SCOUT as auto-starting macOS LaunchAgents (backend + menu-bar).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/run_backend.sh" "$DIR/run_menubar.sh"
mkdir -p ~/Library/LaunchAgents
for L in com.scout.backend com.scout.menubar; do
  cp "$DIR/$L.plist" ~/Library/LaunchAgents/
  launchctl unload ~/Library/LaunchAgents/$L.plist 2>/dev/null || true
  launchctl load ~/Library/LaunchAgents/$L.plist
done
echo "SCOUT installed. A ◆ icon appears in the menu bar."
echo "Grant Microphone (and optionally Accessibility) when macOS prompts."
echo "Uninstall: launchctl unload ~/Library/LaunchAgents/com.scout.*.plist && rm ~/Library/LaunchAgents/com.scout.*.plist"
