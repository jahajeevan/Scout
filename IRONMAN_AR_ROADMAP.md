# JARVIS — Holographic AR Armor Forge (Roadmap)

The Tony-Stark experience: build and wear holographic armor over your real body via
the webcam + hand tracking, then fire weapons with Iron Man-style gestures. Captured
so no idea gets lost — this is the running wishlist + build plan.

## The vision (in the user's words, cleaned up)
- Build armor pieces the way Tony Stark does — **hand, forearm gauntlet, face mask**,
  eventually **every body part**.
- **Fit each piece onto the real body part** through the camera: e.g. use the *other*
  hand to "snap" the gauntlet onto the target hand/arm.
- The gauntlet is packed with **tons of features, weapons, technologies** — a deep,
  upgradeable system, not a single static model.
- The 3D shape must **fit the user's actual hand** (scale/orient to the live hand).
- Once fitted, **certain Iron-Man-style actions fire the weapon** (e.g. open-palm =
  repulsor blast), like the movies.
- Keep adding **plenty of features and upgrades** over time.

## Honest scope
- ❌ Photoreal movie-CGI armor in real time — not achievable locally (VFX-studio work).
- ✅ **Stylized holographic AR armor** that tracks the hand/arm, assembles with
  animation, glows, shows HUD callouts, and fires VFX on gestures. This becomes the
  signature look and fits JARVIS's gold-hologram aesthetic.

## Tech approach
- **Hand/body tracking in the browser:** MediaPipe **HandLandmarker** (21 3D landmarks
  per hand, WASM, real-time) overlaid on the webcam `<video>`. Later: PoseLandmarker
  for arm/torso, FaceLandmarker for the mask. (Run browser-side so the 3D overlays the
  same video feed — the existing Python gesture WS only emits gesture labels.)
- **3D + VFX:** Three.js. Armor built **procedurally** from primitives with emissive
  gold/red materials + glow (no external model files → stays 100% local, and
  procedural = auto-fits any hand by scaling to landmark distances).
- **Fitting:** compute position/rotation/scale from wrist (lm 0) + middle-MCP (lm 9) +
  hand width; the other hand's pinch near the target hand triggers the "snap-on".
- **Firing:** open palm facing camera → repulsor beam + particle burst + screen flash +
  sound. Fist-thrust, finger-guns, etc. map to other weapons.

## Phased plan
- **Phase A — Mark I Gauntlet (MVP):** webcam + hand tracking + a glowing gauntlet that
  fits your hand + an assembly animation + repulsor fire on open-palm. New `/forge` page.
- **Phase B — Weapons & upgrades:** repulsor (palm), missiles (finger-guns), energy
  blade (fist), shield (two-hand). An upgrade/tech tree + HUD callouts + charge meters.
- **Phase C — More body parts:** forearm/shoulder via Pose tracking; **face mask** via
  Face tracking (the helmet closing over your face).
- **Phase D — Full suit + polish:** multi-piece assembly, damage/energy states, voice
  ("JARVIS, suit up"), gesture-driven weapon switching, sound design.

## Feature / upgrade backlog (keep adding)
- Repulsor charge-up + overload, missile lock-on reticle, energy blade, deflector shield.
- Armor "materialize" assembly with flying panels + sparks.
- HUD callouts pinned to the hand (power %, weapon name, targeting).
- Two-hand "unibeam" combo; recoil/knockback VFX.
- Suit skins (Mark variants), damage states, low-power red mode.
- "Suit up / stand down" voice commands; auto-fit calibration per user.
