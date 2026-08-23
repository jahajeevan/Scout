# Pre-flight checklist — before you hit record

> Do EVERY step in order. Don't skip. A demo that fails on camera
> costs more than 20 minutes of prep.

---

## T-2 hours: environment

### Backend + frontend running fresh

```bash
cd /Users/apple/jarvis

# 1. Kill anything running on our ports
lsof -t -i:8000 | xargs kill -9 2>/dev/null
lsof -t -i:3000 | xargs kill -9 2>/dev/null

# 2. Clear stale Next.js build cache
rm -rf frontend/.next

# 3. Fresh start
./run.sh
```

Wait for:
- Backend: `Application startup complete`
- Frontend: `✓ Ready in <X>s`

### Confirm every layer works with `curl`

```bash
# Backend health
curl -s http://localhost:8000/health | python3 -m json.tool
# Expect: status:"ok", model:"nemotron-3-ultra" (or your default)

# Connectors visible
curl -s http://localhost:8000/connectors | python3 -m json.tool
# Expect: 3 connectors listed. If Gmail shows connected:false,
# see "Gmail send permission" below.

# GIF working
curl -s "http://localhost:8000/gif/search?q=celebrate&limit=3" | python3 -m json.tool
# Expect: configured:true, gifs:[...] with 3 items.
# If configured:false → GIPHY_API_KEY not in .env or backend not restarted.

# Model catalog
curl -s http://localhost:8000/models | python3 -m json.tool | head -30
# Expect: 5 models listed, active:"nemotron-3-ultra"
```

If any fails → **fix before recording, not during**.

---

## T-90 min: Gmail send permission

Your Gmail is connected but only for READ. Sending needs a re-connect
with the `gmail.send` scope granted.

1. Open Scout in browser → topbar **Memory** button (or `⌘,`) →
   Settings modal → **Connectors** tab
2. Next to Gmail: **Disconnect**
3. Click **Connect** — browser opens Google's OAuth consent
4. **CRITICAL:** at the consent screen, check the box next to *"Send
   email on your behalf"* — if that box isn't there, click *"Advanced"*
   → *"Go to Scout (unsafe)"* and try again
5. Return to Scout — Gmail should now show "Connected"

Test:
```bash
# In chat, type:
# "send an email to yourself with subject 'test' and body 'hi'"
# Scout should surface a Confirm/Cancel card. Click Confirm.
# Check your Gmail inbox — the mail should appear.
```

If send still fails, the recording plan skips the email beat.

---

## T-60 min: rebuild the native Scout.app (if you'll show it in video)

The `.app` bundle has to be rebuilt so it picks up today's changes
(personality prompt, GIF tool, etc):

```bash
cd /Users/apple/jarvis/macos
/Users/apple/jarvis/.venv/bin/python setup_app.py py2app 2>&1 | tail -5

# Then replace the installed one
pkill -f "Scout.app/Contents/MacOS/Scout" 2>/dev/null || true
sleep 1
if [ -d /Applications/Scout.app ]; then
  mv /Applications/Scout.app /Applications/Scout.app.bak-record
fi
ditto /Users/apple/jarvis/macos/dist/Scout.app /Applications/Scout.app
open /Applications/Scout.app
```

If you're only showing the browser UI in the video, **skip this** —
saves 5 minutes.

---

## T-45 min: prep the Code Mode demo project

For the "add error handling to save_stats" beat, you need a Python
file with a deliberate `ZeroDivisionError`. Create it now:

```bash
mkdir -p ~/scout-demo-project
cd ~/scout-demo-project

cat > db.py <<'EOF'
"""User stats aggregator."""

def save_stats(values):
    total = sum(values)
    average = total / len(values)   # bug: divides by zero on empty list
    return {"total": total, "average": average}


if __name__ == "__main__":
    print(save_stats([]))
EOF

git init -q
git add db.py
git commit -q -m "Initial commit"

# Verify the bug reproduces
python3 db.py 2>&1 | tail -3
# Should print: ZeroDivisionError: division by zero
```

Then in Scout:
1. Open Code mode
2. Click **Choose folder** → pick `~/scout-demo-project`
3. Verify `db.py` shows in the file tree

---

## T-30 min: prep the Terminal-vision demo

For the "look at my terminal" beat, you need a Terminal window
showing the same `ZeroDivisionError` from above:

```bash
# In a Terminal window separate from where you'll run ./run.sh
cd ~/scout-demo-project
python3 db.py
# Leave the traceback visible on screen
```

**Position windows:**
- Scout browser tab: full-screen or left half
- Terminal with error: right half (visible when Scout activates it)
- Everything else closed

---

## T-15 min: permissions

Open **System Settings → Privacy & Security**. Confirm Scout has:

- ✅ **Microphone** (Talk button, voice loop)
- ✅ **Screen Recording** (see_screen / see_app tools)
- ✅ **Accessibility** (global ⌘⌥-Space hotkey — only if you'll use it)
- ✅ **Notifications** (autonomy daemon alerts — optional for video)

If any is off → grant it → **restart Scout.app**.

---

## T-10 min: recording setup

1. `⌘⇧5` → click **Record Entire Screen** or **Record Selected Portion**
2. Options:
   - Microphone: **Built-in Microphone**
   - Show Mouse Clicks: **On**
   - Save to: **Desktop**
   - Timer: **None**
3. Do **not** hit record yet — just get the toolbar visible so you know where it is
4. Close every unnecessary browser tab
5. **Do Not Disturb: ON** (top-right menu bar → Focus icon → Do Not
   Disturb → For 1 hour)
6. Silence Slack, Zoom, Discord, mail apps
7. Put phone on Do Not Disturb too

---

## T-5 min: warm-start the model

NVIDIA free tier can cold-start slow. Send one throwaway prompt to
Scout to warm the model:

```
"hey"
```

Scout should reply within 2-3 seconds. If it takes 15+ seconds →
model is cold, wait 30 sec and try again before recording.

---

## T-0: rehearse ONCE without recording

Walk through all 5 beats in the video_script exactly as you'll do
them on camera. Time it. If any beat breaks:
- Fix the code / prep / permission issue
- Rehearse the fixed beat 2 more times
- Then move to actual recording

---

## Recording

1. `⌘⇧5` → **Record Entire Screen** (or Selected Portion)
2. Take a breath. Smile.
3. Click record.
4. Wait 1 second (avoid the click sound at the start).
5. Deliver the script.
6. Stop with `⌘⇧5` → Stop, or the stop icon in menu bar.

---

## After recording

1. Play it back once. Cringe. It's fine.
2. If it's under 5:30 total, don't edit — just trim head/tail.
3. Upload to YouTube as **Unlisted**:
   - youtube.com → Create → Upload video
   - Visibility: **Unlisted**
   - Title: `Scout — Razorpay AI Buildathon Submission`
   - Description: paste `WHAT_BROKE.md` first paragraph + repo URL
4. Copy the unlisted URL
5. Paste into the Razorpay form
6. Submit

Done.
