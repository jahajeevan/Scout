#!/bin/bash
# Launches the SCOUT native menu-bar app FROM THE BUNDLED Scout.app.
#
# This is what makes macOS TCC treat Scout as one stable identity forever
# (com.scout.app / dist/Scout.app/Contents/MacOS/Scout). Grant Accessibility
# / Screen Recording / Microphone once — never asked again, even after venv
# rebuilds or homebrew python upgrades.
#
# scout.py inside the bundle is a symlink to macos/scout.py, so edits to the
# source apply immediately without needing to rebuild the app.

cd /Users/apple/jarvis || exit 1
set -a; [ -f .env ] && source .env; set +a
export SCOUT_NO_WINDOW=1

BUNDLE=/Users/apple/jarvis/macos/dist/Scout.app
if [ ! -d "$BUNDLE" ]; then
  echo "[run_menubar] bundled Scout.app missing at $BUNDLE"
  echo "[run_menubar] rebuild with:  cd macos && python setup_app.py py2app"
  echo "[run_menubar] falling back to raw python (TCC will re-prompt on updates)"
  source .venv/bin/activate
  exec -a Scout .venv/bin/python3.11 -u macos/scout.py
fi

# `open -a` hands the launch to LaunchServices, which sets the correct
# activation context so the menu-bar item actually appears (a direct
# invocation of the binary from a launchd job would fail to register).
exec open -Wa "$BUNDLE"
