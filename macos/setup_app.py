"""py2app build of Scout — a real .app bundle so it's "Scout" everywhere (Dock,
⌘-Tab, menu bar). Bundles only the menu-bar/Halo app's deps (scout.py talks to the
backend over HTTP, so the backend/web are NOT bundled — run them via the
com.scout.backend LaunchAgent or ./run.sh).

Build from the macos/ directory:
    cd macos && python setup_app.py py2app
    open dist/Scout.app
"""

from setuptools import setup

APP = ["scout.py"]

OPTIONS = {
    "argv_emulation": False,
    "iconfile": "assets/Scout.icns",
    "resources": ["assets"],
    "plist": {
        "CFBundleName": "Scout",
        "CFBundleDisplayName": "Scout",
        "CFBundleIdentifier": "com.scout.app",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "LSMinimumSystemVersion": "13.0",
        "NSHighResolutionCapable": True,
        "NSMicrophoneUsageDescription": "Scout listens for “Hey Scout” and your voice commands.",
        "NSSpeechRecognitionUsageDescription": "Scout transcribes your speech locally on your Mac.",
        "NSAppleEventsUsageDescription": "Scout opens and controls the apps you ask it to.",
        "NSCameraUsageDescription": "Scout uses your camera for the Arc Forge AR gauntlet and vision features.",
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    },
    "packages": ["rumps", "sounddevice", "vosk", "numpy", "httpx", "httpcore",
                 "anyio", "certifi", "cffi"],
    "includes": [
        "json", "wave", "idna", "sniffio", "h11",
        "objc", "PyObjCTools", "PyObjCTools.AppHelper",
        "AppKit", "Foundation", "WebKit", "Quartz", "AVFoundation",
        "ApplicationServices", "CoreFoundation",
    ],
    # Not needed in the menu-bar app — keeps the bundle sane.
    "excludes": ["backend", "tkinter", "matplotlib", "PIL", "openwakeword",
                 "pvporcupine", "onnxruntime", "chromadb", "fastapi", "uvicorn"],
}

setup(
    app=APP,
    name="Scout",
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
