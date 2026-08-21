# S.E.E. — Systems Engineering Environment

> The software Tony Stark would use to *engineer and assemble* the Mark suits —
> reimagined as a real next-generation CAD/AR platform, not a movie effect.
> A cinematic mixed-reality **engineering workstation**. Not a game. Not a weapon
> sim. Not an animation showcase.

*(Name: "S.E.E. — Systems Engineering Environment." Chosen over "Stark…" on
purpose — the goal is a believable real platform, not Marvel branding. Easy to
rename.)*

## North star
The user stands at the camera; JARVIS scans them; every body part becomes an
engineering project. The user **physically assembles** an exosuit, part by part,
with their own hands. Nothing is auto-generated. Nothing just appears. Everything
is **assembled** — picked up, rotated, examined, aligned, magnetically guided,
mechanically locked, powered, and brought alive. It should feel like building an
F1 engine in mixed reality.

Viewers should think *"this is the future of CAD, AR and engineering,"* never
*"this is an Iron Man clone."*

## Design language (non-negotiable)
- Minimal, elegant, transparent, physically believable. No clutter, no gimmicks,
  no cartoon/gaming UI. Everything feels **expensive**.
- Restraint over spectacle: every animation has a *purpose* (it communicates an
  engineering state), every UI element helps you *build something*, every
  interaction feels *physical*.
- Rendering (within real-time browser limits): WebGL **PBR** metals with
  roughness/anisotropy, image-based reflections (local RoomEnvironment/HDRI),
  soft studio lighting, subtle bloom, thin volumetric light, transparent glass
  holograms, floating engineering data pinned in 3D. No neon, no comic FX.
- Sound: precise mechanical clicks, servo whirs, magnetic snaps, power hum,
  cooling fans — quiet and physical, never arcade.

## The component model (everything is a real part)
Spawn hundreds of engineering components floating in the workspace: finger joints,
palm plate, servo motors, titanium plates, hydraulic cylinders, carbon-fibre
shells, energy cables, cooling tubes, power cells, arc conduits, magnetic
connectors, bolts, bearings, sensor arrays…

Every component carries real metadata:
`id, name, category, material, mass(g), dimensions(mm), temperature(°C),
powerDraw(W), health(%), revision, mfgDate, tolerances(µm), compatibleWith[],
mountPoints[], stressLimit(N), thermalLimit(°C)`.

Components have **mount points** (typed connectors) so alignment/compatibility is
computed, not faked.

## Interaction model (hands)
- Two-hand tracking. **Left = support hand** (holds/steadies the assembly),
  **right = engineering hand** (picks up, moves, rotates a component in space).
- Pick up → move through space → rotate naturally → bring near the target. When
  alignment (position + orientation + compatible mount) crosses tolerance:
  magnetic guidance appears → the part eases into position → mechanical locks
  rotate → pistons engage → power flows → indicators light. A satisfying,
  physical "seat."
- Installed parts can be removed, replaced, re-seated. Repeat until the gauntlet
  (then the limb, then the suit) is complete.
- Fallback controls (no camera / precision work): mouse orbit + drag, so it's a
  usable tool even without hand tracking.

## Inspection & diagnostics
- Click an installed part → **exploded engineering view**: internal gears,
  bearings, power routing, cooling, stress map, material thickness, current flow,
  torque, servos, sensors, tolerances, assembly order.
- **Engineering Diagnostics panel**: parts can be *faulty*. Example loop — you
  seat the last finger plate; JARVIS: *"Structural integrity 98.7%. Servo
  calibration required."* The finger won't actuate. Open diagnostics → the faulty
  servo is highlighted → remove that one component → replace → recalibrate → only
  then does the hand fully activate. The suit is **engineered, not animated.**

## JARVIS = chief engineer (not an assistant)
Continuously observes and advises like a veteran aerospace engineer: detects
mistakes, warns on structural problems, suggests lighter materials, optimises
power, computes centre of mass, predicts overheating, recommends stronger joints
and manufacturing improvements. Advice is derived from the live component data,
not scripted flavour text.

## Projects (build order)
Each body part is its own project, built individually, then linked into the full
suit: Helmet · Faceplate · Neck · Chest · **Arc Reactor** · Back · Shoulders ·
Upper Arms · Forearms · **Hands/Gauntlet** · Legs · Boots.

## Build plan (vertical slices — each one real)
1. **Slice 1 — Environment + one engineered component.** The workstation shell
   (minimal glass UI, cinematic PBR viewport), one real component (servo/plate)
   you can orbit, inspect (live spec panel), and explode. JARVIS analysis line.
   *(This slice: mouse control; the aesthetic + data model proven.)*
2. **Slice 2 — Hand control.** Right-hand pick-up/rotate of the component in 3D
   via MediaPipe; left-hand steadies. Magnetic snap onto a single mount with the
   full lock/power sequence + sound.
3. **Slice 3 — The gauntlet project.** A parts bin of ~15 real components; build
   the full hand piece-by-piece with compatibility + mount logic.
4. **Slice 4 — Diagnostics loop.** Faults, exploded internals, remove/replace/
   recalibrate before activation.
5. **Slice 5 — Body scan + more projects.** Pose/body scan to place limb
   workspaces; forearm, chest, arc reactor; link projects into a suit.
6. **Slice 6+ — Depth.** Stress/thermal/CoM simulation, revision history, BOM
   export, material library, manufacturing tolerances, save/load builds.

## Honest constraints
- Not film-VFX photorealism (real-time browser ceiling). Target: *physically
  believable, professionally impressive* PBR — quality through restraint.
- Component count is bounded by GPU budget; use instancing/LOD and stream the
  parts bin. "Hundreds of parts" is a streaming/pooling problem, planned for.
- Everything stays local (no cloud); hand tracking + rendering on-device.
