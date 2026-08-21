"use client";

// ═══════════════════════════════════════════════════════════════════════════
// S.E.E. · MARK — our own Iron Man gauntlet. Hand-authored procedural geometry
// in Three.js: red+gold PBR plating, palm repulsor emitter, per-finger segments
// with joints placed exactly where MediaPipe puts YOUR knuckles. Chest arc
// reactor tracked to shoulders. Live debug overlay so we're never blind again.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as sound from "@/lib/sound";

// Iron Man palette + shared knobs (edit these to retune quickly).
const RED = 0xa8241f;
const RED_DEEP = 0x5e120e;
const GOLD = 0xd6a24a;
const GOLD_HOT = 0xf4c76a;
const CORE_BLUE = 0x9fd8ff;
const CHARCOAL = 0x14161b;

const K = {
  handSpan: 0.85, // gauntlet width as fraction of (wrist→middle-MCP) span
  wristDepth: 0.55, // forearm cuff length as fraction of same span
  fingerCurl: 1.55, // radians at full curl
  fingerBendAxisSign: 1, // flip to -1 if fingers curl the wrong way
  repulsorTrigger: 0.85, // "openness" 0..1 threshold to charge
  smooth: 0.35,
};

// Fingers in MediaPipe landmark index order.
const FINGERS: { name: string; mcp: number; pip: number; dip: number; tip: number }[] = [
  { name: "thumb", mcp: 1, pip: 2, dip: 3, tip: 4 },
  { name: "index", mcp: 5, pip: 6, dip: 7, tip: 8 },
  { name: "middle", mcp: 9, pip: 10, dip: 11, tip: 12 },
  { name: "ring", mcp: 13, pip: 14, dip: 15, tip: 16 },
  { name: "pinky", mcp: 17, pip: 18, dip: 19, tip: 20 },
];

type Debug = {
  hands: number;
  span: number;
  roll: number;
  openness: number;
  curls: number[];
  chestX: number;
  chestY: number;
  shoulderPx: number;
};

export default function MarkPage(): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLmkRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseLmkRef = useRef<any>(null);
  const debugRef = useRef<Debug>({ hands: 0, span: 0, roll: 0, openness: 0, curls: [0, 0, 0, 0, 0], chestX: 0, chestY: 0, shoulderPx: 0 });

  const [started, setStarted] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Ready. Link to bring the Mark online.");
  const [showDebug, setShowDebug] = useState<boolean>(true);
  const [dbg, setDbg] = useState<Debug>(debugRef.current);
  const lastStatus = useRef<string>("");
  const say = (s: string) => { if (lastStatus.current !== s) { lastStatus.current = s; setStatus(s); } };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
      if (disposed || !mountRef.current) return;
      const mount = mountRef.current;
      const W = mount.clientWidth || 1, H = mount.clientHeight || 1;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      // Ortho camera: X in viewport units (aspect wide), Y is 0..1 flipped.
      // Any point at MediaPipe (u,v) can be placed at (x=(0.5-u)*aspect, y=0.5-v).
      const scene = new THREE.Scene();
      let aspect = W / H;
      const camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, -10, 10);
      camera.position.z = 1;

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.4, 0.6, 1); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffb480, 1.1); rim.position.set(-0.6, 0.2, 0.4); scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xffe5c0, 0x0a0c10, 0.5));

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.85, 0.62);
      composer.addPass(bloom);

      // Webcam plane (mirrored) as background.
      const videoTex = new THREE.VideoTexture(videoRef.current!);
      videoTex.colorSpace = THREE.SRGBColorSpace;
      const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), new THREE.MeshBasicMaterial({ map: videoTex, depthWrite: false }));
      bgMesh.position.z = -1; bgMesh.scale.x = -1; scene.add(bgMesh);

      // ---- MATERIALS (Iron Man red + gold + hot core) --------------------
      const mats = {
        red: new THREE.MeshStandardMaterial({ color: RED, metalness: 0.9, roughness: 0.35 }),
        redDeep: new THREE.MeshStandardMaterial({ color: RED_DEEP, metalness: 0.9, roughness: 0.45 }),
        gold: new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1.0, roughness: 0.25 }),
        goldHot: new THREE.MeshStandardMaterial({ color: GOLD_HOT, metalness: 1.0, roughness: 0.18, emissive: 0x241800, emissiveIntensity: 0.6 }),
        dark: new THREE.MeshStandardMaterial({ color: CHARCOAL, metalness: 0.4, roughness: 0.6 }),
        core: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: CORE_BLUE, emissiveIntensity: 3.2, metalness: 0.1, roughness: 0.3 }),
        coreHot: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 5.5 }),
      };
      // Runtime handle to dial the repulsor glow.
      const coreMat = mats.core;

      // ---- GAUNTLET (procedural, unit-length = wrist→middle-MCP) ----------
      // Local frame: +X = down the arm (toward fingers), +Y = up the back of hand,
      // +Z = out toward camera. rig.rotation.z will be set to the hand roll.
      const rig = new THREE.Group();
      const arm = new THREE.Group(); rig.add(arm);
      const build = () => {
        // 1) Forearm cuff — segmented plates
        for (let i = 0; i < 4; i++) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32 - i * 0.01, 0.14, 22, 1, true, -Math.PI / 2.2, Math.PI * 1.15), mats.red);
          seg.position.x = -0.55 + i * 0.14; seg.rotation.z = Math.PI / 2; arm.add(seg);
          const gold = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.01, 0.02, 8, 22), mats.gold);
          gold.position.x = -0.55 + i * 0.14 + 0.07; gold.rotation.y = Math.PI / 2; arm.add(gold);
        }
        // wrist joint — dark under-mesh + gold ring
        const wristHub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), mats.dark);
        arm.add(wristHub);
        const wristRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 10, 30), mats.gold);
        wristRing.rotation.y = Math.PI / 2; arm.add(wristRing);

        // 2) Back-of-hand plate — a wide gold spine + red side plates
        const backPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.42), mats.red);
        backPlate.position.set(0.32, 0.09, 0); arm.add(backPlate);
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.14), mats.gold);
        spine.position.set(0.32, 0.13, 0); arm.add(spine);
        // side rails
        for (const zSign of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), mats.gold);
          rail.position.set(0.32, 0.05, 0.18 * zSign); arm.add(rail);
        }

        // 3) PALM PLATE (front side, under fingers)
        const palmPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.42), mats.red);
        palmPlate.position.set(0.32, -0.08, 0); arm.add(palmPlate);

        // 4) PALM REPULSOR — recessed ring + emissive core, in the palm centre
        const repulsorHousing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 12, 32), mats.gold);
        repulsorHousing.position.set(0.4, -0.09, 0); repulsorHousing.rotation.x = Math.PI / 2;
        arm.add(repulsorHousing);
        const repulsorCore = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), mats.core);
        repulsorCore.position.set(0.4, -0.105, 0); repulsorCore.rotation.x = Math.PI / 2;
        arm.add(repulsorCore);
        // outer glow halo (sprite-like plane behind core)
        const halo = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshBasicMaterial({ color: CORE_BLUE, transparent: true, opacity: 0.28 }));
        halo.position.set(0.4, -0.108, 0); halo.rotation.x = Math.PI / 2;
        arm.add(halo);

        return { coreMat: mats.core, halo: halo.material as THREE.MeshBasicMaterial };
      };
      const gaunt = build();

      // ---- FINGERS — per-finger group with 3 segments hinged at knuckles ----
      type FingerRig = {
        name: string;
        group: THREE.Group; // pivots at the MCP (knuckle)
        pip: THREE.Group;   // pivots at PIP
        dip: THREE.Group;   // pivots at DIP
        landmarks: { mcp: number; pip: number; dip: number; tip: number };
      };
      const fingerRigs: FingerRig[] = [];
      // Finger geometry factory: 3 segments (proximal/middle/distal) with knuckle caps.
      const buildFinger = (name: string, len: number, radius: number, isThumb: boolean) => {
        const proximal = new THREE.Group();
        const seg1 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, radius * 2, radius * 2.1), mats.red);
        seg1.position.x = len * 0.2; proximal.add(seg1);
        const goldRing1 = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.15, radius * 0.15, 8, 20), mats.gold);
        goldRing1.rotation.y = Math.PI / 2; goldRing1.position.x = len * 0.4; proximal.add(goldRing1);

        const middle = new THREE.Group(); middle.position.x = len * 0.42;
        const seg2 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.32, radius * 1.9, radius * 2.0), mats.red);
        seg2.position.x = len * 0.16; middle.add(seg2);
        const goldRing2 = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.1, radius * 0.14, 8, 20), mats.gold);
        goldRing2.rotation.y = Math.PI / 2; goldRing2.position.x = len * 0.32; middle.add(goldRing2);

        const distal = new THREE.Group(); distal.position.x = len * 0.34;
        const seg3 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.26, radius * 1.75, radius * 1.85), mats.gold);
        seg3.position.x = len * 0.13; distal.add(seg3);
        // fingertip cap (glowing gold, gives fingers a hero read at any zoom)
        const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.85, 12, 10), mats.goldHot);
        tip.position.x = len * 0.26; distal.add(tip);

        middle.add(distal); proximal.add(middle);
        proximal.userData = { isThumb, len };
        return { root: proximal, pip: middle, dip: distal };
      };

      const fingerSpecs: { name: string; angle: number; forward: number; radius: number; len: number; landmarks: FingerRig["landmarks"] }[] = [
        // angle = radians on Y-axis around wrist (0 = straight along +X)
        { name: "thumb",  angle:  0.75, forward: 0.35, radius: 0.075, len: 0.55, landmarks: { mcp: 1, pip: 2, dip: 3, tip: 4 } },
        { name: "index",  angle:  0.18, forward: 0.55, radius: 0.075, len: 0.68, landmarks: { mcp: 5, pip: 6, dip: 7, tip: 8 } },
        { name: "middle", angle:  0.0,  forward: 0.58, radius: 0.078, len: 0.72, landmarks: { mcp: 9, pip: 10, dip: 11, tip: 12 } },
        { name: "ring",   angle: -0.16, forward: 0.55, radius: 0.075, len: 0.66, landmarks: { mcp: 13, pip: 14, dip: 15, tip: 16 } },
        { name: "pinky",  angle: -0.32, forward: 0.48, radius: 0.065, len: 0.55, landmarks: { mcp: 17, pip: 18, dip: 19, tip: 20 } },
      ];
      for (const f of fingerSpecs) {
        const built = buildFinger(f.name, f.len, f.radius, f.name === "thumb");
        // MCP knuckle position on the front edge of the back-plate
        const mcpX = 0.55; // wrist origin is 0; knuckle line ~ end of back-plate
        const mcpZ = Math.sin(f.angle) * 0.19; // spread across the hand width
        const mcpY = f.name === "thumb" ? -0.02 : 0.08; // thumb slightly lower
        const knuckle = new THREE.Group();
        knuckle.position.set(mcpX, mcpY, mcpZ);
        knuckle.rotation.y = f.angle;
        knuckle.add(built.root);
        arm.add(knuckle);
        // small gold knuckle cap
        const cap = new THREE.Mesh(new THREE.SphereGeometry(f.radius * 1.1, 14, 10), mats.gold);
        knuckle.add(cap);
        fingerRigs.push({ name: f.name, group: knuckle, pip: built.pip, dip: built.dip, landmarks: f.landmarks });
      }

      scene.add(rig);
      // Sensible pre-link placement so the intro frame reads composed, not stacked.
      rig.position.set(0.25, -0.05, 0.001); rig.scale.setScalar(0.35);
      rig.rotation.z = 0.05;

      // ---- ARC REACTOR (procedural chest reactor — matches gauntlet aesthetic) ----
      const reactor = new THREE.Group();
      const reactorHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 40), mats.dark);
      reactorHousing.rotation.x = Math.PI / 2; reactor.add(reactorHousing);
      const reactorRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 14, 44), mats.gold);
      reactor.add(reactorRing);
      const reactorInner = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 12, 40), mats.gold);
      reactor.add(reactorInner);
      // core disc
      const reactorCore = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), mats.core);
      reactorCore.position.z = 0.09; reactor.add(reactorCore);
      // segmented spokes
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.04), mats.gold);
        spoke.position.set(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.04);
        spoke.rotation.z = a; reactor.add(spoke);
      }
      const reactorHalo = new THREE.Mesh(new THREE.CircleGeometry(0.75, 44), new THREE.MeshBasicMaterial({ color: CORE_BLUE, transparent: true, opacity: 0.22 }));
      reactorHalo.position.z = 0.05; reactor.add(reactorHalo);
      // Sensible pre-link reactor placement (upper-left) so intro is composed.
      reactor.position.set(-0.28, 0.1, 0); reactor.scale.setScalar(0.25);
      scene.add(reactor);

      // ---- ENERGY CONDUIT (line from reactor → gauntlet, drawn each frame) ----
      const conduitMat = new THREE.LineBasicMaterial({ color: CORE_BLUE, transparent: true, opacity: 0.9 });
      const conduitGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const conduit = new THREE.Line(conduitGeo, conduitMat);
      scene.add(conduit);

      // ---- REPULSOR BEAM (only while charging/firing) ----
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 1.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: CORE_BLUE, transparent: true, opacity: 0.0 }));
      beam.rotation.z = Math.PI / 2; // point +X
      beam.position.x = 0.4 + 0.7; // out from repulsor
      arm.add(beam);

      const onResize = () => {
        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        renderer.setSize(w, h); composer.setSize(w, h);
        aspect = w / h;
        camera.left = -aspect / 2; camera.right = aspect / 2; camera.updateProjectionMatrix();
        const old = bgMesh.geometry; bgMesh.geometry = new THREE.PlaneGeometry(aspect, 1); old.dispose();
      };
      window.addEventListener("resize", onResize);

      sceneRef.current = { THREE, scene, camera, rig, arm, reactor, fingerRigs, gaunt, beam, conduit, conduitGeo, reactorHalo: (reactorHalo.material as THREE.MeshBasicMaterial), aspect: () => aspect };

      // ---- Loop -----------------------------------------------------------
      const smooth = { hx: 0, hy: 0, scale: 0.5, roll: 0, cx: 0, cy: 0, cScale: 0.5, cRoll: 0 };
      const fingerAngles = [0, 0, 0, 0, 0];
      let charge = 0;
      let raf = 0; const clock = new THREE.Clock();
      const animate = () => {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        const vid = videoRef.current;

        const handLmk = handLmkRef.current;
        const poseLmk = poseLmkRef.current;
        const camL = (camera.right - camera.left);
        const nextDbg: Debug = { ...debugRef.current, hands: 0 };

        // ---- POSE → reactor position + roll ----
        if (poseLmk && vid && vid.readyState >= 2) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res: any = poseLmk.detectForVideo(vid, performance.now());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p: any[] = res?.landmarks?.[0] || [];
            if (p.length >= 25) {
              const ls = p[11], rs = p[12], lh = p[23], rh = p[24];
              const smid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
              const hmid = { y: (lh.y + rh.y) / 2 };
              const chestY = smid.y + (hmid.y - smid.y) * 0.3;
              const nx = (1 - smid.x) - 0.5;
              const ny = 0.5 - chestY;
              const shoulderPx = Math.hypot(ls.x - rs.x, ls.y - rs.y);
              const shoulderSpan = shoulderPx * camL;
              const targetScale = Math.max(0.05, shoulderSpan * 0.32);
              const targetRoll = Math.atan2(ls.y - rs.y, (1 - ls.x) - (1 - rs.x));

              smooth.cx += (nx * camL - smooth.cx) * K.smooth;
              smooth.cy += (ny - smooth.cy) * K.smooth;
              smooth.cScale += (targetScale - smooth.cScale) * 0.25;
              smooth.cRoll += (targetRoll - smooth.cRoll) * 0.3;
              reactor.position.set(smooth.cx, smooth.cy, 0);
              reactor.scale.setScalar(smooth.cScale);
              reactor.rotation.z = smooth.cRoll;
              nextDbg.chestX = +smooth.cx.toFixed(3);
              nextDbg.chestY = +smooth.cy.toFixed(3);
              nextDbg.shoulderPx = +shoulderPx.toFixed(3);
            }
          } catch { /* transient */ }
        }

        // ---- HAND → gauntlet position, roll, per-finger curl ----
        if (handLmk && vid && vid.readyState >= 2) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res: any = handLmk.detectForVideo(vid, performance.now());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hs: any[] = res?.landmarks || [];
            nextDbg.hands = hs.length;
            if (hs.length) {
              const h = hs[0];
              // hand span = wrist→middle-MCP (normalised video coords).
              const dx = h[9].x - h[0].x, dy = h[9].y - h[0].y;
              const spanN = Math.hypot(dx, dy);
              const spanV = spanN * camL;
              // hand centre (average of key anchor points)
              const cx = (h[0].x + h[5].x + h[17].x) / 3;
              const cy = (h[0].y + h[5].y + h[17].y) / 3;
              const nx = (1 - cx) - 0.5;
              const ny = 0.5 - cy;
              // roll — wrist to middle-MCP direction (mirrored X)
              const roll = Math.atan2(h[9].y - h[0].y, (1 - h[9].x) - (1 - h[0].x));

              smooth.hx += (nx * camL - smooth.hx) * K.smooth;
              smooth.hy += (ny - smooth.hy) * K.smooth;
              smooth.scale += (spanV * K.handSpan - smooth.scale) * 0.35;
              smooth.roll += (roll - smooth.roll) * K.smooth;

              rig.position.set(smooth.hx, smooth.hy, 0.001);
              rig.scale.setScalar(smooth.scale);
              rig.rotation.z = smooth.roll;

              // per-finger curl: length-of-chain vs straight-line-distance ratio
              const d = (a: number, b: number) => Math.hypot(h[a].x - h[b].x, h[a].y - h[b].y);
              let openness = 0;
              for (let i = 0; i < FINGERS.length; i++) {
                const f = FINGERS[i];
                const chain = d(f.mcp, f.pip) + d(f.pip, f.dip) + d(f.dip, f.tip);
                const straight = chain > 0 ? Math.min(1, d(f.mcp, f.tip) / chain) : 1;
                const curl = Math.max(0, Math.min(1, (1 - straight) * 1.5));
                openness += (1 - curl);
                const target = curl * K.fingerCurl * K.fingerBendAxisSign;
                fingerAngles[i] += (target - fingerAngles[i]) * 0.35;
                nextDbg.curls[i] = +curl.toFixed(2);
                const fr = fingerRigs[i];
                if (fr) {
                  // bend the whole finger at the MCP; PIP + DIP each add a fraction
                  fr.group.rotation.z = -fingerAngles[i];
                  fr.pip.rotation.z = -fingerAngles[i] * 0.9;
                  fr.dip.rotation.z = -fingerAngles[i] * 0.7;
                }
              }
              openness = openness / FINGERS.length;
              nextDbg.openness = +openness.toFixed(2);
              nextDbg.span = +spanN.toFixed(3);
              nextDbg.roll = +roll.toFixed(2);

              // ---- REPULSOR: charge on open palm, discharge on close ----
              const target = openness > K.repulsorTrigger ? 1 : 0;
              charge += (target - charge) * 0.08;
              (sceneRef.current.gaunt.coreMat as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + charge * 8;
              (sceneRef.current.gaunt.halo as THREE.MeshBasicMaterial).opacity = 0.25 + charge * 0.6;
              const bm = beam.material as THREE.MeshBasicMaterial;
              bm.opacity = charge > 0.55 ? (charge - 0.55) * 2.2 : 0;
              beam.scale.set(1, 1 + charge * 3, 1);
            } else {
              // no hand → fade back
              charge += (0 - charge) * 0.08;
              (sceneRef.current.gaunt.coreMat as THREE.MeshStandardMaterial).emissiveIntensity = 2.0;
              (sceneRef.current.gaunt.halo as THREE.MeshBasicMaterial).opacity = 0.25;
              (beam.material as THREE.MeshBasicMaterial).opacity = 0;
            }
          } catch { /* transient */ }
        }

        // ---- ENERGY CONDUIT: draw a live line from reactor to gauntlet ----
        const src = new THREE.Vector3(reactor.position.x, reactor.position.y, 0);
        const dst = new THREE.Vector3(rig.position.x, rig.position.y, 0.001);
        conduitGeo.setFromPoints([src, dst]);
        conduitMat.opacity = 0.35 + 0.35 * Math.sin(t * 4);

        // reactor pulse
        const rpulse = 2.6 + Math.sin(t * 2.2) * 1.0;
        (mats.core as THREE.MeshStandardMaterial).emissiveIntensity = Math.max((mats.core as THREE.MeshStandardMaterial).emissiveIntensity, rpulse);
        (sceneRef.current.reactorHalo as THREE.MeshBasicMaterial).opacity = 0.2 + 0.15 * Math.sin(t * 2.2);

        // publish debug at 6fps
        if (showDebug && Math.floor(t * 6) !== Math.floor((t - 0.017) * 6)) {
          debugRef.current = nextDbg;
          setDbg(nextDbg);
        }

        composer.render();

        // status hint
        if (!nextDbg.hands) say("Present your hand to the camera.");
        else if (nextDbg.openness > K.repulsorTrigger) say("Repulsor charging — open palm to fire.");
        else say("Mark online. Move your fingers.");
      };
      animate();

      cleanup = () => {
        cancelAnimationFrame(raf); window.removeEventListener("resize", onResize);
        renderer.dispose(); pmrem.dispose(); composer.dispose();
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function link(): Promise<void> {
    sound.unlock();
    say("Booting optics…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const v = videoRef.current!; v.srcObject = stream; await v.play();
      say("Loading trackers…");
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const mkH = (d: "GPU" | "CPU") => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate: d }, runningMode: "VIDEO", numHands: 1 });
      const mkP = (d: "GPU" | "CPU") => PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task", delegate: d }, runningMode: "VIDEO", numPoses: 1 });
      handLmkRef.current = await mkH("GPU").catch(() => mkH("CPU"));
      poseLmkRef.current = await mkP("GPU").catch(() => mkP("CPU"));
      setStarted(true);
      say("Mark online. Show your right hand + stand back.");
    } catch (e) {
      say(`Link failed: ${(e as Error).message}`);
    }
  }

  return (
    <main style={ST.page}>
      <video ref={videoRef} playsInline muted style={ST.hidden} />
      <div ref={mountRef} style={ST.viewport} />

      <Link href="/see" style={ST.back}>‹ EXIT MARK</Link>
      <header style={ST.header}>
        <div style={ST.wordmark}>S<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span> · MARK</div>
        <div style={ST.subwordmark}>PROCEDURAL IRON GAUNTLET · CHEST REACTOR · REPULSOR</div>
      </header>

      {showDebug ? (
        <aside style={ST.debug}>
          <div style={ST.dhdr}>LIVE TELEMETRY</div>
          <Row k="hands" v={String(dbg.hands)} />
          <Row k="hand span" v={dbg.span.toFixed(3)} />
          <Row k="roll (rad)" v={dbg.roll.toFixed(2)} />
          <Row k="openness" v={dbg.openness.toFixed(2)} />
          <Row k="chest x" v={dbg.chestX.toFixed(3)} />
          <Row k="chest y" v={dbg.chestY.toFixed(3)} />
          <Row k="shoulder px" v={dbg.shoulderPx.toFixed(3)} />
          <div style={{ ...ST.dhdr, marginTop: 10 }}>PER-FINGER CURL</div>
          {["thumb", "index", "middle", "ring", "pinky"].map((n, i) => (
            <Row key={n} k={n} v={dbg.curls[i].toFixed(2)} bar={dbg.curls[i]} />
          ))}
          <button onClick={() => setShowDebug(false)} style={ST.dbtn}>hide</button>
        </aside>
      ) : (
        <button onClick={() => setShowDebug(true)} style={{ ...ST.dbtn, position: "absolute", top: 20, right: 130, zIndex: 6 }}>show debug</button>
      )}

      <footer style={ST.footer}>
        <div style={ST.jarvis}>
          <span style={ST.jarvisTag}>JARVIS</span>
          <span style={ST.jarvisText}>{status}</span>
        </div>
        {!started ? <button style={{ ...ST.btn, ...ST.btnPrimary }} onClick={link}>◉ BRING THE MARK ONLINE</button> : null}
      </footer>
    </main>
  );
}

function Row({ k, v, bar }: { k: string; v: string; bar?: number }): JSX.Element {
  return (
    <div style={ST.row}>
      <span style={ST.rk}>{k}</span>
      <span style={ST.rv}>{v}</span>
      {bar != null ? <div style={ST.barTrack}><div style={{ ...ST.barFill, width: `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%` }} /></div> : null}
    </div>
  );
}

const DISPLAY = "var(--font-display), 'Space Grotesk', system-ui, sans-serif";
const MONO = "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace";

const ST: Record<string, React.CSSProperties> = {
  page: { position: "relative", height: "100vh", width: "100vw", overflow: "hidden", background: "#06070a", color: "#fff" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" },
  viewport: { position: "absolute", inset: 0 },
  back: { position: "absolute", top: 22, right: 26, fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.55)", textDecoration: "none", zIndex: 6 },
  header: { position: "absolute", top: 20, left: 28, zIndex: 6 },
  wordmark: { fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: "0.14em" },
  dot: { color: "#7FB2FF" },
  subwordmark: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.28em", color: "rgba(255,255,255,0.42)", marginTop: 3 },
  debug: { position: "absolute", top: 96, right: 22, width: 230, padding: "12px 14px", background: "rgba(10,12,16,0.7)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", zIndex: 6, color: "#fff" },
  dhdr: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.22em", color: "rgba(255,255,255,0.5)", marginBottom: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", gap: 6 },
  rk: { fontFamily: DISPLAY, fontSize: 10, color: "rgba(255,255,255,0.55)" },
  rv: { fontFamily: MONO, fontSize: 10.5, color: "#cfe4ff" },
  barTrack: { width: 60, height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" },
  barFill: { height: "100%", background: "#7FB2FF", transition: "width 0.1s" },
  dbtn: { marginTop: 10, fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.16em", color: "rgba(255,255,255,0.55)", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", padding: "5px 10px", borderRadius: 3, cursor: "pointer" },
  footer: { position: "absolute", left: 28, right: 28, bottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, zIndex: 6 },
  jarvis: { maxWidth: 620, display: "flex", gap: 12 },
  jarvisTag: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.22em", color: "#7FB2FF", paddingTop: 2 },
  jarvisText: { fontFamily: DISPLAY, fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" },
  btn: { fontFamily: DISPLAY, fontSize: 11, letterSpacing: "0.14em", padding: "11px 22px", borderRadius: 3, cursor: "pointer", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)" },
  btnPrimary: { background: "linear-gradient(#f4c76a, #d6a24a)", color: "#3a1a05", border: "1px solid transparent", fontWeight: 700 },
};
