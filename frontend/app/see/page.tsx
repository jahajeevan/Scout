"use client";

// ═══════════════════════════════════════════════════════════════════════════
// S.E.E. — Systems Engineering Environment · Slices 1–3.5
// The components now seat onto a forearm ARMATURE in a gauntlet layout, each at
// its real position + orientation, so assembling them builds a recognisable
// forearm gauntlet — not parts on a board. PREVIEW shows the finished module.
// Pinch → carry → magnetic seat → lock → power. All local. See SEE_SPEC.md.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as sound from "@/lib/sound";

const SEAT_DIST = 0.12; // very forgiving magnetic capture radius
const SNAP_DIST = 0.075; // easy auto-seat
const GRAB_REACH = 0.22; // generous pickup radius so small parts are easy to grab
const PINCH_RATIO = 0.72; // easier pinch detection

type Shape = "plate" | "servo" | "knuckle" | "palm" | "cell" | "conduit";
interface Comp {
  id: string; name: string; category: string; material: string;
  mass: number; power: number; dims: [number, number, number];
  shape: Shape; mount: [number, number, number]; rot: [number, number, number]; bin: [number, number, number];
}

// Mounts laid out on a vertical forearm+hand armature (front face toward camera):
// forearm plate low, wrist servo at the joint, palm + knuckles up on the hand,
// power cell + conduit down the side.
const CATALOG: Comp[] = [
  { id: "FP-2", name: "Forearm Dorsal Plate", category: "Armour", material: "Ti-6Al-4V", mass: 118, power: 0, dims: [92, 12, 60], shape: "plate", mount: [0, -0.05, 0.05], rot: [0, 0, 0], bin: [-0.16, -0.16, 0] },
  { id: "PC-7", name: "Micro Power Cell", category: "Power", material: "Li-S · graphene", mass: 71, power: -240, dims: [22, 22, 44], shape: "cell", mount: [-0.05, -0.055, 0.03], rot: [0, 0, 0], bin: [-0.096, -0.16, 0] },
  { id: "AC-3", name: "Arc Conduit", category: "Power", material: "Cu · aerogel", mass: 28, power: 0, dims: [80, 8, 8], shape: "conduit", mount: [-0.028, -0.02, 0.05], rot: [0, 0, Math.PI / 2], bin: [-0.032, -0.16, 0] },
  { id: "SV-9", name: "Wrist Servo Actuator", category: "Actuation", material: "Ti · NdFeB", mass: 43, power: 3.4, dims: [18, 18, 26], shape: "servo", mount: [0, 0.012, 0.052], rot: [-Math.PI / 2, 0, 0], bin: [0.032, -0.16, 0] },
  { id: "PP-1", name: "Palm Plate", category: "Armour", material: "Ti-6Al-4V", mass: 96, power: 0, dims: [58, 9, 62], shape: "palm", mount: [0, 0.045, 0.042], rot: [0, 0, 0], bin: [0.096, -0.16, 0] },
  { id: "KG-4", name: "Knuckle Guard", category: "Armour", material: "CFRP", mass: 64, power: 0, dims: [70, 10, 22], shape: "knuckle", mount: [0, 0.085, 0.03], rot: [0.35, 0, 0], bin: [0.16, -0.16, 0] },
];

type Mode = "studio" | "assembly";

export default function SEEPage(): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lmkRef = useRef<any>(null);
  const modeRef = useRef<Mode>("studio");
  const heldRef = useRef<number>(-1);
  const previewRef = useRef<boolean>(false);
  const heroRef = useRef<boolean>(false);

  const [ready, setReady] = useState<boolean>(false);
  const [mode, setMode] = useState<Mode>("studio");
  const [preview, setPreview] = useState<boolean>(false);
  const [heroLoaded, setHeroLoaded] = useState<boolean>(false);
  const [explode, setExplode] = useState<boolean>(false);
  const explodeRef = useRef<boolean>(false);
  const heldGRef = useRef<number>(-1);
  const [heroSeated, setHeroSeated] = useState<number>(0);
  const [heroTotal, setHeroTotal] = useState<number>(0);
  const fitRef = useRef<boolean>(false);
  const [fit, setFit] = useState<boolean>(false);
  const [installed, setInstalled] = useState<boolean[]>(CATALOG.map(() => false));
  const [active, setActive] = useState<number>(3);
  const [status, setStatus] = useState<string>("Orbit the armature. Preview the module, or build it by hand.");

  const lastStatus = useRef<string>("");
  const say = (s: string) => { if (lastStatus.current !== s) { lastStatus.current = s; setStatus(s); } };
  const count = installed.filter(Boolean).length;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
      if (disposed || !mountRef.current) return;
      const mount = mountRef.current;
      const W = mount.clientWidth, H = mount.clientHeight;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 100);
      const STUDIO_POS = new THREE.Vector3(0.14, 0.03, 0.34);
      camera.position.copy(STUDIO_POS);

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // Cinematic bloom (studio/hero only — assembly renders plain so the webcam shows).
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.6, 0.88));

      const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(0.2, 0.4, 0.3);
      key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.near = 0.05; key.shadow.camera.far = 1.2; key.shadow.bias = -0.0002;
      const scam = key.shadow.camera as THREE.OrthographicCamera;
      scam.left = -0.3; scam.right = 0.3; scam.top = 0.3; scam.bottom = -0.3;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fc4ff, 0.7); rim.position.set(-0.25, 0.1, -0.2); scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffffff, 1.1); fill.position.set(0, 0.06, 0.5); scene.add(fill);
      scene.add(new THREE.HemisphereLight(0x8090a0, 0x0a0c10, 0.35));

      const mat = {
        ti: new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 1, roughness: 0.3 }),
        steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.45 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.4, roughness: 0.55 }),
        carbon: new THREE.MeshStandardMaterial({ color: 0x14161b, metalness: 0.25, roughness: 0.5 }),
        copper: new THREE.MeshStandardMaterial({ color: 0xc8794a, metalness: 1, roughness: 0.38 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xcaa24a, metalness: 1, roughness: 0.3 }),
        cell: new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.6, roughness: 0.4, emissive: 0x1b3a5a, emissiveIntensity: 0.7 }),
        arm: new THREE.MeshStandardMaterial({ color: 0x40454e, metalness: 0.9, roughness: 0.38 }),
      };
      // Curved shell plate — vertical axis so it wraps the forearm, arc facing +Z.
      const shell = (r: number, h: number, arc: number, m: THREE.Material) => {
        const g = new THREE.CylinderGeometry(r, r, h, 28, 1, true, Math.PI / 2 - arc / 2, arc);
        return new THREE.Mesh(g, m);
      };
      const build = (shape: Shape): THREE.Group => {
        const g = new THREE.Group();
        const m = (mesh: THREE.Mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
        if (shape === "plate") { m(shell(0.05, 0.085, 2.0, mat.ti)); m(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.004), mat.dark)).position.set(0, 0, 0.05); }
        else if (shape === "palm") { m(shell(0.043, 0.058, 2.0, mat.ti)); m(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.003), mat.steel)).position.set(0, 0, 0.043); }
        else if (shape === "servo") {
          m(new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.028, 40), mat.ti));
          m(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 30), mat.gold)).position.y = 0.018;
          m(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.016, 20), mat.steel)).position.y = 0.028;
          m(new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.025, 0.006, 40), mat.dark)).position.y = -0.015;
        } else if (shape === "knuckle") {
          for (let i = 0; i < 4; i++) m(new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.011, 0.02), mat.carbon)).position.set((i - 1.5) * 0.016, 0, 0);
          m(new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.005, 0.008), mat.steel)).position.set(0, -0.007, -0.008);
        } else if (shape === "cell") {
          m(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 28), mat.cell));
          for (const y of [0.022, -0.022]) m(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 28), mat.steel)).position.y = y;
        } else if (shape === "conduit") {
          const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.035, 0, 0), new THREE.Vector3(0, 0.006, 0.005), new THREE.Vector3(0.035, 0, 0)]);
          m(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.005, 12), mat.copper));
          for (const x of [-0.035, 0.035]) m(new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.009, 0.009), mat.dark)).position.set(x, 0, 0);
        }
        return g;
      };

      // ---- forearm + hand armature (always visible — the frame you build onto) ----
      const arm = new THREE.Group();
      const addA = (mesh: THREE.Mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; arm.add(mesh); return mesh; };
      addA(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.046, 0.11, 32), mat.arm)).position.y = -0.05;
      addA(new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.006, 12, 32).rotateX(Math.PI / 2), mat.arm)).position.y = 0.01;
      addA(new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.052, 0.03, 1, 1, 1), mat.arm)).position.set(0, 0.045, 0);
      for (let i = 0; i < 4; i++) addA(new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.03, 0.014), mat.arm)).position.set((i - 1.5) * 0.015, 0.086, 0);
      scene.add(arm);

      type Item = { comp: Comp; obj: THREE.Group; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; power: THREE.Mesh; seated: boolean; ease: THREE.Vector3; q: THREE.Quaternion };
      const items: Item[] = CATALOG.map((comp) => {
        const obj = build(comp.shape);
        obj.position.set(comp.bin[0], comp.bin[1], comp.bin[2]);
        scene.add(obj);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.0 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0015, 10, 44).rotateX(-Math.PI / 2), ringMat);
        ring.position.set(comp.mount[0], comp.mount[1], comp.mount[2] + 0.01); scene.add(ring);
        const power = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 12, 12), new THREE.MeshBasicMaterial({ color: 0x2a3038 }));
        power.position.set(comp.mount[0] + 0.03, comp.mount[1], comp.mount[2]); scene.add(power);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(comp.rot[0], comp.rot[1], comp.rot[2]));
        return { comp, obj, ring, ringMat, power, seated: false, ease: new THREE.Vector3(comp.bin[0], comp.bin[1], comp.bin[2]), q };
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 0.14; controls.maxDistance = 0.7; controls.target.set(0, 0.0, 0);

      const onResize = () => { const w = mount.clientWidth, h = mount.clientHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      window.addEventListener("resize", onResize);
      sceneRef.current = { THREE, controls, camera, arm, items, STUDIO_POS };

      // Real model (optional): if a gauntlet GLB is dropped at /models/gauntlet.glb
      // it becomes the forearm (auto-fit + PBR + shadows). Otherwise the procedural
      // armature above is used. Non-blocking — the scene renders immediately.
      (async () => {
        try {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const gltf = await new GLTFLoader().loadAsync("/models/gauntlet.glb");
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3(); box.getSize(size);
          const center = new THREE.Vector3(); box.getCenter(center);
          const s = 0.17 / (Math.max(size.x, size.y, size.z) || 1); // fit largest axis
          model.scale.setScalar(s);
          model.position.set(-center.x * s, -center.y * s, -center.z * s);
          model.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
          scene.add(model);
          model.updateMatrixWorld(true);
          arm.visible = false; // the real model replaces the procedural armature
          items.forEach((it) => { it.obj.visible = false; it.power.visible = false; }); // hero mode: hide procedural bin
          heroRef.current = true;
          // Flatten every sub-mesh onto the model root (keeps world transform) so
          // each real part can be exploded radially — a true exploded engineering view.
          const meshList: THREE.Mesh[] = [];
          model.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) meshList.push(mm); });
          meshList.forEach((mm) => model.attach(mm));
          const lbox = new THREE.Box3().setFromObject(model);
          const lc = lbox.getCenter(new THREE.Vector3()); model.worldToLocal(lc);
          sceneRef.current.model = model;
          sceneRef.current.heroParts = meshList.map((mm) => ({ mesh: mm, rest: mm.position.clone(), q: mm.quaternion.clone() }));
          sceneRef.current.heroCenter = lc;

          // Group the 31 meshes into hand-assemblable sub-assemblies. The unmatched
          // remainder (main body/plating) stays as the fixed base you build onto.
          const groupDefs = [
            { key: "Finger I", m: (n: string) => n.includes("palec1") },
            { key: "Finger II", m: (n: string) => n.includes("palec2") },
            { key: "Finger III", m: (n: string) => n.includes("palec3") },
            { key: "Finger IV", m: (n: string) => n.includes("palec4") },
            { key: "Thumb", m: (n: string) => n.includes("kciuk") },
            { key: "Dial", m: (n: string) => n.includes("zegar") || n.includes("wskazowka") },
            { key: "Hand Guard", m: (n: string) => n.includes("oslonadloni") || n.includes("skrzydla") },
          ];
          // finger group → MediaPipe landmark chain [MCP, PIP, DIP, TIP] for curl.
          const FMAP: Record<string, number[]> = {
            "Finger I": [5, 6, 7, 8], "Finger II": [9, 10, 11, 12], "Finger III": [13, 14, 15, 16], "Finger IV": [17, 18, 19, 20], "Thumb": [1, 2, 3, 4],
          };
          const used = new Set<THREE.Mesh>();
          const groups = groupDefs.map((gd) => {
            const ms = meshList.filter((mm) => { const n = (mm.name || "").toLowerCase(); if (used.has(mm) || !gd.m(n)) return false; used.add(mm); return true; });
            const rest = ms.map((mm) => mm.position.clone());
            const restQ = ms.map((mm) => mm.quaternion.clone());
            const centroid = rest.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(ms.length ? 1 / ms.length : 0);
            // knuckle pivot = the extreme rest point nearest the model centre; tip = the far one.
            let A = rest[0] || new THREE.Vector3(), B = rest[0] || new THREE.Vector3(), md = -1;
            for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) { const d = rest[i].distanceTo(rest[j]); if (d > md) { md = d; A = rest[i]; B = rest[j]; } }
            const aNear = A.distanceTo(lc) <= B.distanceTo(lc);
            const pivot = (aNear ? A : B).clone();
            const fingerAxis = (aNear ? B.clone().sub(A) : A.clone().sub(B)).normalize();
            const bendAxis = fingerAxis.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
            if (bendAxis.lengthSq() < 0.01) bendAxis.set(1, 0, 0);
            return { key: gd.key, meshes: ms, rest, restQ, centroid, pivot, bendAxis, lm: FMAP[gd.key] || null, seated: false, offset: new THREE.Vector3(), scatter: new THREE.Vector3() };
          }).filter((g) => g.meshes.length > 0);
          sceneRef.current.groups = groups;
          sceneRef.current.modelScale = model.scale.x || 1;
          sceneRef.current.modelHome = { pos: model.position.clone(), scale: model.scale.clone() };
          setHeroTotal(groups.length);
          setHeroLoaded(true);
        } catch { /* no model present — keep the procedural armature */ }
      })();

      const tmp = new THREE.Vector3(), ndc = new THREE.Vector3();
      const dist2D = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      let seatDwell = 0, wasPinch = false;

      const seat = (it: Item) => {
        it.seated = true; heldRef.current = -1;
        (it.power.material as THREE.MeshBasicMaterial).color.set(0x66ff99);
        it.ringMat.color.set(0x66ff99); it.ringMat.opacity = 0.45;
        sound.sfx("rev"); window.setTimeout(() => sound.sfx("freeze"), 90); window.setTimeout(() => sound.sfx("chime"), 260);
        setInstalled((prev) => { const n = [...prev]; n[items.indexOf(it)] = true; return n; });
      };

      const handStep = (video: HTMLVideoElement) => {
        const lmk = lmkRef.current;
        if (!lmk || video.readyState < 2) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let hands: any[] = [];
        try { hands = lmk.detectForVideo(video, performance.now()).landmarks || []; } catch { return; }
        if (!hands.length) { heldRef.current = -1; wasPinch = false; say("Show your hand to the camera."); return; }
        const lm = hands[0];
        const hs = dist2D(lm[0], lm[9]) || 1;
        const pinch = dist2D(lm[4], lm[8]) < hs * PINCH_RATIO;
        const palm = { x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 };
        const sx = 1 - palm.x, sy = palm.y;
        ndc.set(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        const tt = (0.03 - camera.position.z) / (dir.z || -1e-4);
        const hand = new THREE.Vector3().copy(camera.position).addScaledVector(dir, tt);
        hand.x = Math.max(-0.2, Math.min(0.2, hand.x)); hand.y = Math.max(-0.18, Math.min(0.14, hand.y));

        if (pinch && !wasPinch && heldRef.current < 0) {
          let best = -1, bd = GRAB_REACH;
          items.forEach((it, i) => { if (it.seated) return; const d = it.obj.position.distanceTo(hand); if (d < bd) { bd = d; best = i; } });
          if (best >= 0) { heldRef.current = best; setActive(best); }
        }
        wasPinch = pinch;

        const held = heldRef.current;
        if (held >= 0 && !items[held].seated) {
          const it = items[held];
          const mnt = new THREE.Vector3(it.comp.mount[0], it.comp.mount[1], it.comp.mount[2]);
          if (pinch) {
            tmp.copy(hand);
            const d = dist2D(tmp, mnt);
            it.ringMat.opacity = 0.6;
            if (d < SEAT_DIST) { const pull = (1 - d / SEAT_DIST) * 0.65; tmp.x += (mnt.x - tmp.x) * pull; tmp.y += (mnt.y - tmp.y) * pull; it.ringMat.color.set(0x66ff99); it.obj.quaternion.slerp(it.q, 0.15); }
            else it.ringMat.color.set(0x7fb2ff);
            it.obj.position.lerp(tmp, 0.35);
            const near = dist2D(it.obj.position, mnt);
            if (near < SNAP_DIST) seatDwell++; else seatDwell = 0;
            if (near < SNAP_DIST * 0.6 || seatDwell > 14) seat(it);
            else say(near < SEAT_DIST ? `Aligning ${it.comp.id} — hold steady` : `Carry ${it.comp.id} to its bay`);
          } else {
            if (dist2D(it.obj.position, mnt) < SEAT_DIST) seat(it);
            else { it.ease.copy(it.obj.position); heldRef.current = -1; }
            seatDwell = 0;
          }
        } else say(count >= CATALOG.length ? "Gauntlet complete, sir." : "Pinch a floating part to pick it up");
      };

      // --- Real-model hand assembly: grab a floating sub-assembly, snap it home ---
      const ZERO = new THREE.Vector3();
      let wasPinchG = false, seatDwellG = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seatGroup = (g: any) => {
        g.seated = true; heldGRef.current = -1;
        sound.sfx("rev"); window.setTimeout(() => sound.sfx("freeze"), 90); window.setTimeout(() => sound.sfx("chime"), 260);
        setHeroSeated((p) => p + 1);
      };
      const heroAssemblyStep = (video: HTMLVideoElement | null) => {
        const sr = sceneRef.current; const groups = sr?.groups; const model = sr?.model; const s = sr?.modelScale || 1;
        if (!groups || !model) return;
        const lmk = lmkRef.current;
        if (lmk && video && video.readyState >= 2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let hands: any[] = [];
          try { hands = lmk.detectForVideo(video, performance.now()).landmarks || []; } catch { /* transient */ }
          if (!hands.length) { heldGRef.current = -1; wasPinchG = false; say("Show your hand to the camera."); }
          else {
            const lm = hands[0];
            const hsz = dist2D(lm[0], lm[9]) || 1;
            const pinch = dist2D(lm[4], lm[8]) < hsz * PINCH_RATIO;
            const palm = { x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 };
            ndc.set((1 - palm.x) * 2 - 1, -(palm.y * 2 - 1), 0.5).unproject(camera);
            const dir = ndc.sub(camera.position).normalize();
            const tt = (model.position.z - camera.position.z) / (dir.z || -1e-4);
            const handW = new THREE.Vector3().copy(camera.position).addScaledVector(dir, tt);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const asmW = (g: any) => new THREE.Vector3().copy(g.centroid).multiplyScalar(s).add(model.position);
            if (pinch && !wasPinchG && heldGRef.current < 0) {
              let best = -1, bd = GRAB_REACH;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              groups.forEach((g: any, i: number) => { if (g.seated) return; const c = asmW(g).add(g.offset); const d = c.distanceTo(handW); if (d < bd) { bd = d; best = i; } });
              if (best >= 0) heldGRef.current = best;
            }
            wasPinchG = pinch;
            const held = heldGRef.current;
            if (held >= 0 && !groups[held].seated) {
              const g = groups[held]; const base = asmW(g);
              if (pinch) {
                const want = handW.clone().sub(base);
                const d = want.length();
                if (d < SEAT_DIST) want.multiplyScalar(Math.max(0, 1 - (1 - d / SEAT_DIST) * 0.9)); // strong magnetic pull
                g.offset.lerp(want, 0.35);
                const near = g.offset.length();
                if (near < SNAP_DIST) seatDwellG++; else seatDwellG = 0;
                if (near < SNAP_DIST * 0.7 || seatDwellG > 8) seatGroup(g);
                else say(near < SEAT_DIST ? `Aligning ${g.key} — hold steady` : `Carry ${g.key} into place`);
              } else {
                if (g.offset.length() < SEAT_DIST) seatGroup(g); else heldGRef.current = -1;
                seatDwellG = 0;
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } else if (groups.every((g: any) => g.seated)) say("Gauntlet assembled, sir.");
            else say("Pinch a floating part to grab it");
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        groups.forEach((g: any, i: number) => {
          if (g.seated) g.offset.lerp(ZERO, 0.2);
          else if (heldGRef.current !== i) g.offset.lerp(g.scatter, 0.08);
          tmp.copy(g.offset).divideScalar(s);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.meshes.forEach((mm: any, k: number) => mm.position.copy(g.rest[k]).add(tmp));
        });
      };

      // --- FIT TO HAND: gauntlet tracks the hand, each finger bends with the real finger ---
      const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
      const fitStep = (video: HTMLVideoElement | null) => {
        const sr = sceneRef.current; const model = sr?.model; const groups = sr?.groups; if (!model || !groups) return;
        const lmk = lmkRef.current;
        if (!lmk || !video || video.readyState < 2) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let hands: any[] = [];
        try { hands = lmk.detectForVideo(video, performance.now()).landmarks || []; } catch { return; }
        if (!hands.length) { say("Present your right hand to the camera, sir."); return; }
        const lm = hands[0];
        const palm = { x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 };
        ndc.set((1 - palm.x) * 2 - 1, -(palm.y * 2 - 1), 0.5).unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        const tt = (0 - camera.position.z) / (dir.z || -1e-4);
        const handW = new THREE.Vector3().copy(camera.position).addScaledVector(dir, tt);
        // scale from hand span (index-MCP → pinky-MCP), calibrated
        const hw = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y) || 0.1;
        const target = (sr.modelHome.scale.x) * (hw / 0.11) * 2.4;
        // roll from wrist → middle-MCP (mirrored X)
        const roll = Math.atan2((1 - lm[9].x) - (1 - lm[0].x), lm[0].y - lm[9].y);
        model.position.lerp(handW, 0.5);
        model.scale.setScalar(model.scale.x + (target - model.scale.x) * 0.4);
        model.rotation.z += (roll - model.rotation.z) * 0.4;
        // Per-finger curl: each gauntlet finger bends as the real finger curls.
        const d2 = (a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        groups.forEach((g: any) => {
          if (!g.lm) return;
          const [mcp, pip, dp, tip] = g.lm;
          const chain = d2(mcp, pip) + d2(pip, dp) + d2(dp, tip);
          const straight = chain > 0 ? Math.min(1, d2(mcp, tip) / chain) : 1;
          const curl = Math.max(0, Math.min(1, (1 - straight) * 1.6));
          const angle = curl * 1.6; // CURL_MAX — calibrate amount + sign
          _q.setFromAxisAngle(g.bendAxis, angle);
          for (let k = 0; k < g.meshes.length; k++) {
            _v.copy(g.rest[k]).sub(g.pivot).applyQuaternion(_q).add(g.pivot);
            g.meshes[k].position.copy(_v);
            g.meshes[k].quaternion.copy(_q).multiply(g.restQ[k]);
          }
        });
        say("Gauntlet fitted, sir. Move your fingers.");
      };

      setReady(true);
      let raf = 0; const clock = new THREE.Clock();
      const animate = () => {
        raf = requestAnimationFrame(animate);
        const dt = clock.getDelta(), t = clock.elapsedTime;
        const asm = modeRef.current === "assembly";
        if (fitRef.current) fitStep(videoRef.current);
        else if (asm && heroRef.current) heroAssemblyStep(videoRef.current);
        else if (asm && videoRef.current) handStep(videoRef.current);
        if (!asm && previewRef.current) { arm.rotation.y += dt * 0.25; const md = sceneRef.current?.model; if (md) md.rotation.y += dt * 0.3; }
        // Real-model exploded view (studio/hero only): push sub-parts radially out.
        const hp = sceneRef.current?.heroParts, hc = sceneRef.current?.heroCenter;
        if (hp && hc && !asm) { const F = explodeRef.current ? 0.85 : 0; for (const p of hp) { tmp.copy(p.rest).sub(hc).multiplyScalar(1 + F).add(hc); p.mesh.position.lerp(tmp, 0.14); } }

        items.forEach((it, i) => {
          const mnt = new THREE.Vector3(it.comp.mount[0], it.comp.mount[1], it.comp.mount[2]);
          const showSeated = it.seated || previewRef.current;
          if (showSeated) { it.obj.position.lerp(mnt, 0.2); it.obj.quaternion.slerp(it.q, 0.2); }
          else if (heldRef.current === i) { /* handStep */ }
          else {
            const home = asm ? it.ease : new THREE.Vector3(it.comp.bin[0], it.comp.bin[1], it.comp.bin[2]);
            it.obj.position.lerp(home, 0.06);
            if (asm) it.obj.position.y += Math.sin(t * 1.5 + i) * 0.00016;
          }
          const show = asm && !it.seated && !heroRef.current;
          it.ring.visible = show;
          if (show && heldRef.current !== i) { it.ringMat.opacity = 0.12 + 0.1 * Math.sin(t * 4 + i); it.ringMat.color.set(0x7fb2ff); }
          it.ring.rotation.z += dt * 0.5;
        });

        if (!asm) controls.update();
        if (asm) renderer.render(scene, camera); else composer.render();
      };
      animate();

      cleanup = () => {
        cancelAnimationFrame(raf); window.removeEventListener("resize", onResize);
        controls.dispose(); renderer.dispose(); pmrem.dispose(); composer.dispose();
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);

  async function enterAssembly(): Promise<void> {
    sound.unlock();
    previewRef.current = false; setPreview(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = videoRef.current!; video.srcObject = stream; await video.play();
      if (!lmkRef.current) {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const make = (delegate: "GPU" | "CPU") => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate }, runningMode: "VIDEO", numHands: 2 });
        lmkRef.current = await make("GPU").catch(() => make("CPU"));
      }
      heldRef.current = -1; heldGRef.current = -1;
      const sr = sceneRef.current;
      if (heroLoaded && sr?.groups) {
        explodeRef.current = false; setExplode(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (sr.heroParts) sr.heroParts.forEach((p: any) => p.mesh.position.copy(p.rest));
        const n = sr.groups.length;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sr.groups.forEach((g: any, i: number) => { g.seated = false; g.offset.set(0, 0, 0); const a = (i / n) * Math.PI * 2 - Math.PI / 2; g.scatter.set(Math.cos(a) * 0.1, Math.sin(a) * 0.062 - 0.005, Math.abs(Math.cos(a)) * 0.02 + 0.02); });
        setHeroSeated(0);
        sr.controls.enabled = false; sr.camera.position.set(0.05, 0.035, 0.58); sr.camera.lookAt(0, 0, 0); sr.camera.updateProjectionMatrix();
      } else if (sr) {
        sr.controls.enabled = false; sr.camera.position.set(0, 0.01, 0.58); sr.camera.lookAt(0, 0.01, 0); sr.camera.updateProjectionMatrix();
      }
      modeRef.current = "assembly"; setMode("assembly");
      say(heroLoaded ? "Pinch a floating part to grab it" : "Pinch a floating part to pick it up");
    } catch (e) { say(`Camera failed: ${(e as Error).message}`); }
  }

  function exitAssembly(): void {
    modeRef.current = "studio"; setMode("studio"); heldRef.current = -1;
    const v = videoRef.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
    if (v) v.srcObject = null;
    if (sceneRef.current) {
      const sr = sceneRef.current;
      sr.controls.enabled = true; sr.camera.position.copy(sr.STUDIO_POS); sr.controls.target.set(0, 0, 0); sr.camera.updateProjectionMatrix();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (sr.groups) { sr.groups.forEach((g: any) => { g.seated = false; g.offset.set(0, 0, 0); }); if (sr.heroParts) sr.heroParts.forEach((p: any) => p.mesh.position.copy(p.rest)); setHeroSeated(0); }
    }
    say(heroLoaded ? "Rotate to inspect, or explode the assembly." : "Orbit the armature. Preview the module, or build it by hand.");
  }

  function togglePreview(): void { const n = !preview; setPreview(n); previewRef.current = n; }

  async function enterFit(): Promise<void> {
    sound.unlock();
    try {
      const video = videoRef.current!;
      if (!video.srcObject) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = stream; await video.play();
      }
      if (!lmkRef.current) {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const make = (delegate: "GPU" | "CPU") => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate }, runningMode: "VIDEO", numHands: 2 });
        lmkRef.current = await make("GPU").catch(() => make("CPU"));
      }
      explodeRef.current = false; setExplode(false);
      const sr = sceneRef.current;
      if (sr) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (sr.groups) sr.groups.forEach((g: any) => { g.seated = true; g.offset.set(0, 0, 0); });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (sr.heroParts) sr.heroParts.forEach((p: any) => p.mesh.position.copy(p.rest));
        sr.controls.enabled = false;
        sr.camera.position.set(0, 0, 0.6); sr.camera.lookAt(0, 0, 0); sr.camera.updateProjectionMatrix();
      }
      fitRef.current = true; modeRef.current = "assembly"; setMode("assembly"); setFit(true);
      say("Present your right hand to the camera, sir.");
    } catch (e) { say(`Camera failed: ${(e as Error).message}`); }
  }

  function exitFit(): void {
    fitRef.current = false; setFit(false); modeRef.current = "studio"; setMode("studio");
    const v = videoRef.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
    if (v) v.srcObject = null;
    const sr = sceneRef.current;
    if (sr?.model && sr.modelHome) {
      sr.model.position.copy(sr.modelHome.pos); sr.model.scale.copy(sr.modelHome.scale); sr.model.rotation.set(0, 0, 0);
      sr.controls.enabled = true; sr.camera.position.copy(sr.STUDIO_POS); sr.controls.target.set(0, 0, 0); sr.camera.updateProjectionMatrix();
    }
    say("Rotate to inspect, or explode the assembly.");
  }

  function reset(): void {
    setInstalled(CATALOG.map(() => false)); heldRef.current = -1; previewRef.current = false; setPreview(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (sceneRef.current) sceneRef.current.items.forEach((it: any) => { it.seated = false; it.obj.position.set(it.comp.bin[0], it.comp.bin[1], it.comp.bin[2]); it.power.material.color.set(0x2a3038); it.ringMat.opacity = 0; });
  }

  const A = CATALOG[active];
  const complete = count >= CATALOG.length;

  return (
    <main style={ST.page}>
      <video ref={videoRef} playsInline muted style={{ ...ST.video, opacity: mode === "assembly" ? 0.5 : 0 }} />
      <div style={{ ...ST.bg, opacity: mode === "assembly" ? 0 : 1 }} />
      <div ref={mountRef} style={ST.viewport} />

      <Link href="/" style={ST.back}>‹ EXIT ENVIRONMENT</Link>
      <header style={ST.header}>
        <div style={ST.wordmark}>S<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span></div>
        <div style={ST.subwordmark}>MARK I GAUNTLET · FOREARM MODULE</div>
      </header>

      <section style={ST.leftPanel}>
        {heroLoaded ? (
          <>
            <div style={ST.idRow}><span style={ST.idTag}>MK-I</span><span style={ST.category}>Assembly</span></div>
            <div style={ST.partName}>Hextech Gauntlet Module</div>
            <div style={ST.rule} />
            <Spec k="Components" v="31 parts" />
            <Spec k="Material" v="Hextech alloy · plating" />
            <Spec k="Est. mass" v="3.24 kg" />
            <Spec k="Envelope" v="410 × 190 × 160 mm" />
            <Spec k="Integrity" v="99.1%" live />
            <Spec k="Status" v={explode ? "EXPLODED" : "assembled"} live={explode} />
          </>
        ) : (
          <>
            <div style={ST.idRow}><span style={ST.idTag}>{A.id}</span><span style={ST.category}>{A.category}</span></div>
            <div style={ST.partName}>{A.name}</div>
            <div style={ST.rule} />
            <Spec k="Material" v={A.material} />
            <Spec k="Mass" v={`${A.mass} g`} />
            <Spec k="Dimensions" v={`${A.dims.join(" × ")} mm`} />
            <Spec k="Power" v={A.power === 0 ? "passive" : A.power < 0 ? `+${-A.power} W supply` : `${A.power} W draw`} />
            <Spec k="Status" v={installed[active] ? "INSTALLED" : "in bin"} live={installed[active]} />
          </>
        )}
      </section>

      <section style={ST.rightPanel}>
        {heroLoaded ? (
          <>
            <div style={ST.panelTitle}>{mode === "assembly" ? `ASSEMBLY · ${heroSeated}/${heroTotal}` : "SUBSYSTEMS · 31 PARTS"}</div>
            {mode === "assembly" ? <div style={ST.progress}><div style={{ ...ST.progressFill, width: `${heroTotal ? (heroSeated / heroTotal) * 100 : 0}%` }} /></div> : null}
            <div style={ST.rule} />
            {["Outer plating", "Finger linkages ×4", "Thumb crank", "Dial escapement", "Hand guards", "Power core"].map((s) => (
              <div key={s} style={ST.bomRow}>
                <span style={ST.bomName}>{s}</span>
                <span style={{ ...ST.bomDot, background: "#66ff99" }} />
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={ST.panelTitle}>BILL OF MATERIALS · {count}/{CATALOG.length}</div>
            <div style={ST.progress}><div style={{ ...ST.progressFill, width: `${(count / CATALOG.length) * 100}%` }} /></div>
            <div style={ST.rule} />
            {CATALOG.map((c, i) => (
              <div key={c.id} style={{ ...ST.bomRow, opacity: installed[i] ? 1 : 0.7 }} onClick={() => setActive(i)}>
                <span style={ST.bomIdx}>{c.id}</span>
                <span style={ST.bomName}>{c.name}</span>
                <span style={{ ...ST.bomDot, background: installed[i] ? "#66ff99" : "#3a4048" }} />
              </div>
            ))}
          </>
        )}
      </section>

      <footer style={ST.footer}>
        <div style={ST.jarvis}>
          <span style={ST.jarvisTag}>JARVIS</span>
          <span style={ST.jarvisText}>
            {heroLoaded
              ? (fit ? status
                : mode === "assembly"
                ? (heroSeated >= heroTotal && heroTotal > 0
                  ? "Gauntlet assembled — all sub-assemblies seated, structural integrity 99.1%. Beautiful work, sir."
                  : `${status} · ${heroSeated}/${heroTotal} seated`)
                : explode
                ? "Exploded assembly — 31 components resolved: finger linkages, thumb crank, dial escapement, hand guards and outer plating. Rotate to walk the internals."
                : "Hextech Gauntlet · Mark I loaded. 31 components, est. 3.24 kg, structural integrity 99.1%. Rotate to inspect, explode, or hand-assemble the sub-assemblies.")
              : complete
              ? "Forearm gauntlet complete. Plates seated, wrist servo aligned, power bus live. Structural integrity 99.1%, mass 420 g. Ready to link the upper-arm module."
              : mode === "assembly" ? status
              : preview ? "Module preview — this is the target: dorsal plate over the forearm, servo at the wrist, palm and knuckle guards on the hand, power cell and conduit down the side."
              : "Six components in the bin. Preview the finished module, or enter hand assembly and build it yourself."}
          </span>
        </div>
        <div style={ST.controls}>
          {mode === "studio" ? (
            heroLoaded ? (
              <>
                <button style={{ ...ST.btn, ...(explode ? ST.btnActive : {}) }} onClick={() => { const n = !explode; setExplode(n); explodeRef.current = n; }}>{explode ? "◱ COLLAPSE" : "◳ EXPLODE"}</button>
                <button style={{ ...ST.btn, ...(preview ? ST.btnActive : {}) }} onClick={togglePreview}>⟳ ROTATE</button>
                <button style={ST.btn} onClick={enterAssembly}>◉ HAND ASSEMBLE</button>
                <button style={{ ...ST.btn, ...ST.btnPrimary }} onClick={enterFit}>✋ FIT TO HAND</button>
              </>
            ) : (
              <>
                <button style={ST.btn} onClick={reset}>⟲ RESET</button>
                <button style={{ ...ST.btn, ...(preview ? ST.btnActive : {}) }} onClick={togglePreview}>◇ PREVIEW</button>
                <button style={{ ...ST.btn, ...ST.btnPrimary }} onClick={enterAssembly}>◉ HAND ASSEMBLY</button>
              </>
            )
          ) : fit ? (
            <button style={{ ...ST.btn, ...ST.btnActive }} onClick={exitFit}>‹ EXIT FIT</button>
          ) : (
            <>
              {heroLoaded && heroSeated >= heroTotal && heroTotal > 0 ? (
                <button style={{ ...ST.btn, ...ST.btnPrimary }} onClick={() => { exitAssembly(); setTimeout(enterFit, 60); }}>✋ FIT TO HAND</button>
              ) : null}
              <button style={{ ...ST.btn, ...ST.btnActive }} onClick={exitAssembly}>‹ EXIT ASSEMBLY</button>
            </>
          )}
        </div>
      </footer>

      {!ready ? <div style={ST.loading}>INITIALISING ENVIRONMENT…</div> : null}
    </main>
  );
}

function Spec({ k, v, live }: { k: string; v: string; live?: boolean }): JSX.Element {
  return <div style={ST.specRow}><span style={ST.specK}>{k}</span><span style={{ ...ST.specV, color: live ? "#66ff99" : "rgba(255,255,255,0.82)" }}>{v}</span></div>;
}

const DISPLAY = "var(--font-display), 'Space Grotesk', system-ui, sans-serif";
const MONO = "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace";
const HAIR = "1px solid rgba(255,255,255,0.08)";
const PANEL = "rgba(16,18,22,0.55)";

const ST: Record<string, React.CSSProperties> = {
  page: { position: "relative", height: "100vh", width: "100vw", overflow: "hidden", background: "#06070a", color: "#fff" },
  video: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", transition: "opacity 0.6s", zIndex: 0 },
  bg: { position: "absolute", inset: 0, zIndex: 0, transition: "opacity 0.6s", background: "radial-gradient(120% 90% at 50% 35%, #14171d 0%, #0a0c10 45%, #06070a 100%)" },
  viewport: { position: "absolute", inset: 0, zIndex: 1 },
  back: { position: "absolute", top: 22, right: 26, fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)", textDecoration: "none", zIndex: 5 },
  header: { position: "absolute", top: 20, left: 28, zIndex: 5 },
  wordmark: { fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: "0.14em", color: "#fff" },
  dot: { color: "#7FB2FF" },
  subwordmark: { fontFamily: DISPLAY, fontSize: 8.5, letterSpacing: "0.36em", color: "rgba(255,255,255,0.35)", marginTop: 3 },
  leftPanel: { position: "absolute", top: 96, left: 28, width: 250, padding: "16px 18px", background: PANEL, border: HAIR, borderRadius: 4, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", zIndex: 5 },
  idRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  idTag: { fontFamily: MONO, fontSize: 12, color: "#7FB2FF", letterSpacing: "0.1em" },
  category: { fontFamily: DISPLAY, fontSize: 8.5, letterSpacing: "0.24em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" },
  partName: { fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, marginTop: 6 },
  rule: { height: 1, background: "rgba(255,255,255,0.08)", margin: "12px 0" },
  specRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0" },
  specK: { fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.06em", color: "rgba(255,255,255,0.38)" },
  specV: { fontFamily: MONO, fontSize: 11, textAlign: "right", maxWidth: 150 },
  rightPanel: { position: "absolute", top: 96, right: 28, width: 224, padding: "16px 18px", background: PANEL, border: HAIR, borderRadius: 4, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", zIndex: 5 },
  panelTitle: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.2em", color: "rgba(255,255,255,0.45)" },
  progress: { height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill: { height: "100%", background: "#66ff99", transition: "width 0.4s", boxShadow: "0 0 8px rgba(102,255,153,0.6)" },
  bomRow: { display: "flex", alignItems: "center", gap: 9, padding: "5px 0", cursor: "pointer" },
  bomIdx: { fontFamily: MONO, fontSize: 9.5, color: "rgba(255,255,255,0.35)", width: 34 },
  bomName: { fontFamily: DISPLAY, fontSize: 10.5, color: "rgba(255,255,255,0.78)", flex: 1 },
  bomDot: { width: 5, height: 5, borderRadius: "50%", transition: "background 0.4s" },
  footer: { position: "absolute", left: 28, right: 28, bottom: 22, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, zIndex: 5 },
  jarvis: { maxWidth: 560, display: "flex", gap: 12, alignItems: "flex-start" },
  jarvisTag: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.22em", color: "#7FB2FF", paddingTop: 2, flexShrink: 0 },
  jarvisText: { fontFamily: DISPLAY, fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.62)" },
  controls: { display: "flex", gap: 10, flexShrink: 0 },
  btn: { fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.14em", color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.04)", border: HAIR, borderRadius: 3, padding: "9px 15px", cursor: "pointer", transition: "all 0.2s" },
  btnActive: { color: "#cfe4ff", border: "1px solid rgba(127,178,255,0.5)", background: "rgba(127,178,255,0.08)" },
  btnPrimary: { color: "#06070a", background: "linear-gradient(#cfe4ff, #7FB2FF)", border: "1px solid transparent", fontWeight: 700 },
  loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 11, letterSpacing: "0.3em", color: "rgba(255,255,255,0.4)", zIndex: 4 },
};
