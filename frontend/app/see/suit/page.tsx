"use client";

// ═══════════════════════════════════════════════════════════════════════════
// S.E.E. · SUIT UP — Slice 1: chest-tracked arc reactor.
// Webcam + MediaPipe Pose → the arc reactor GLB anchors to your sternum,
// scales with your shoulder width, and rolls with your body. Cinematic PBR
// with bloom. 100% local. This is the foundation for mask, gauntlet-fit,
// power flow, and repulsor blast — one honest slice at a time.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function SuitPage(): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateRef = useRef<any>(null);
  const [started, setStarted] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Ready to link.");
  const [error, setError] = useState<string>("");
  const lastStatus = useRef<string>("");
  const say = (s: string) => { if (lastStatus.current !== s) { lastStatus.current = s; setStatus(s); } };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
      if (disposed || !mountRef.current) return;
      const mount = mountRef.current;
      const W = mount.clientWidth, H = mount.clientHeight;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      // Ortho camera in normalised viewport coordinates (0..1 x, 0..1 y flipped),
      // so a point placed at MediaPipe (x,y) draws exactly over that pixel of the
      // webcam feed — no 2D→3D projection guesswork.
      const scene = new THREE.Scene();
      const aspect = W / H;
      const camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, -10, 10);
      camera.position.z = 1;

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // Lights: hero key + cool rim so the metal reads well over live video.
      const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.4, 0.6, 1); scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fc4ff, 1.0); rim.position.set(-0.5, 0.2, 0.4); scene.add(rim);
      scene.add(new THREE.HemisphereLight(0x8aa4ff, 0x111318, 0.5));

      // Bloom for the reactor core glow.
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.75, 0.75));

      // ---- load the arc reactor ----
      const rig = new THREE.Group();
      scene.add(rig);
      let reactorReady = false;
      let baseScale = 1;
      const bright = new THREE.Color(0x9fd8ff);
      const glowMats: THREE.MeshStandardMaterial[] = [];
      try {
        const gltf = await new GLTFLoader().loadAsync("/models/arc_reactor.glb");
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const centre = new THREE.Vector3(); box.getCenter(centre);
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        baseScale = 0.14 / maxAxis; // reactor ~14% viewport tall — tune
        // Normalise the model to unit-diameter (largest axis = 1), so at runtime we
        // can literally say "reactor diameter = 1× shoulder-span" — no guess multipliers.
        const maxD = Math.max(size.x, size.y, size.z) || 1;
        const norm = 1 / maxD;
        model.scale.setScalar(norm);
        model.position.set(-centre.x * norm, -centre.y * norm, -centre.z * norm);
        // orient the reactor face-out (camera-facing). Many Sketchfab reactors are
        // authored looking up +Y; rotating -90° on X lays the disc face-out.
        model.rotation.x = -Math.PI / 2;
        baseScale = 1; // rig scale = target chest-plate diameter directly
        model.traverse((o) => {
          const m = o as THREE.Mesh; if (!m.isMesh) return;
          const mat = m.material as THREE.MeshStandardMaterial;
          // any bright/emissive-ish material gets pushed to glow
          if (mat && mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b > 0.05 || mat.name.toLowerCase().includes("glow") || mat.name.toLowerCase().includes("core"))) {
            mat.emissive.copy(bright); mat.emissiveIntensity = 2.4; glowMats.push(mat);
          }
        });
        rig.add(model);
        reactorReady = true;
      } catch (e) {
        setError(`Reactor load failed: ${(e as Error).message}`);
      }

      // ---- video plane (webcam) behind the 3D ----
      const videoTex = new THREE.VideoTexture(videoRef.current!);
      videoTex.colorSpace = THREE.SRGBColorSpace;
      const bgGeo = new THREE.PlaneGeometry(aspect, 1);
      const bgMat = new THREE.MeshBasicMaterial({ map: videoTex, depthWrite: false });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.z = -1; bgMesh.scale.x = -1; // mirror
      scene.add(bgMesh);

      const onResize = () => {
        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        renderer.setSize(w, h); composer.setSize(w, h);
        const a = w / h || 1;
        camera.left = -a / 2; camera.right = a / 2; camera.updateProjectionMatrix();
        const old = bgMesh.geometry; bgMesh.geometry = new THREE.PlaneGeometry(a, 1); old.dispose();
      };
      window.addEventListener("resize", onResize);

      stateRef.current = { THREE, rig, baseScale, glowMats, reactorReady, camera };

      let raf = 0; const clock = new THREE.Clock();
      const smooth = { x: 0, y: 0, scale: 1, roll: 0 };
      const animate = () => {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();

        // Pose-driven placement
        const s = stateRef.current;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lmk = s?.poseLmk as any;
        const vid = videoRef.current;
        if (reactorReady && lmk && vid && vid.readyState >= 2) {
          try {
            const res = lmk.detectForVideo(vid, performance.now());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pts: any[] = res?.landmarks?.[0] || [];
            if (pts.length >= 25) {
              // landmarks: 11 = left shoulder, 12 = right shoulder, 23/24 = hips
              const ls = pts[11], rs = pts[12], lh = pts[23], rh = pts[24];
              // chest midpoint = midway between shoulders, slightly toward hips (sternum area)
              const shoulderMidX = (ls.x + rs.x) / 2, shoulderMidY = (ls.y + rs.y) / 2;
              const hipMidY = (lh.y + rh.y) / 2;
              const chestY = shoulderMidY + (hipMidY - shoulderMidY) * 0.28; // slightly below shoulder line
              // mirror x (video is mirrored)
              const nx = (1 - shoulderMidX) - 0.5;
              const ny = 0.5 - chestY;
              const cam = s.camera as THREE.OrthographicCamera;
              const px = nx * (cam.right - cam.left);
              const py = ny;
              const shoulderPx = Math.hypot(ls.x - rs.x, ls.y - rs.y);
              // Reactor diameter (viewport units) = 0.55 × shoulder-span directly.
              // Model is normalised to unit-diameter, so rig.scale = this value literally.
              const shoulderSpanY = shoulderPx * (camera.right - camera.left) / 1; // shoulderPx is in normalised x already
              const scaleTarget = Math.max(0.02, shoulderSpanY * 0.55);
              const roll = Math.atan2(ls.y - rs.y, (1 - ls.x) - (1 - rs.x));

              // smooth to kill jitter
              smooth.x += (px - smooth.x) * 0.35;
              smooth.y += (py - smooth.y) * 0.35;
              smooth.scale += (scaleTarget - smooth.scale) * 0.25;
              smooth.roll += (roll - smooth.roll) * 0.3;

              rig.position.set(smooth.x, smooth.y, 0);
              rig.scale.setScalar(smooth.scale);
              rig.rotation.z = smooth.roll;
              say("Arc reactor linked to your chest, sir.");
            } else {
              say("Step back so I can see your shoulders.");
            }
          } catch { /* transient frame */ }
        }
        // pulse the reactor glow
        const pulse = 2.0 + Math.sin(t * 2.4) * 0.9;
        for (const m of glowMats) m.emissiveIntensity = pulse;

        composer.render();
      };
      animate();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        renderer.dispose(); pmrem.dispose(); composer.dispose();
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);

  async function link(): Promise<void> {
    setError("");
    say("Booting optics…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = videoRef.current!; video.srcObject = stream; await video.play();
      say("Loading body tracker…");
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const make = (delegate: "GPU" | "CPU") => PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task", delegate }, runningMode: "VIDEO", numPoses: 1 });
      const lmk = await make("GPU").catch(() => make("CPU"));
      if (stateRef.current) stateRef.current.poseLmk = lmk;
      setStarted(true);
      say("Stand back — arms visible.");
    } catch (e) {
      setError(`Link failed: ${(e as Error).message}. Allow camera access and retry.`);
      say("Offline.");
    }
  }

  return (
    <main style={ST.page}>
      <video ref={videoRef} playsInline muted style={ST.hidden} />
      <div ref={mountRef} style={ST.viewport} />
      <Link href="/see" style={ST.back}>‹ EXIT SUIT</Link>
      <header style={ST.header}>
        <div style={ST.wordmark}>S<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span>E<span style={ST.dot}>.</span> · SUIT UP</div>
        <div style={ST.subwordmark}>PHASE I · ARC REACTOR LINK</div>
      </header>
      <footer style={ST.footer}>
        <div style={ST.jarvis}>
          <span style={ST.jarvisTag}>JARVIS</span>
          <span style={ST.jarvisText}>{error || status}</span>
        </div>
        {!started ? <button style={{ ...ST.btn, ...ST.btnPrimary }} onClick={link}>◉ LINK ARC REACTOR</button> : null}
      </footer>
    </main>
  );
}

const DISPLAY = "var(--font-display), 'Space Grotesk', system-ui, sans-serif";
const HAIR = "1px solid rgba(255,255,255,0.08)";

const ST: Record<string, React.CSSProperties> = {
  page: { position: "relative", height: "100vh", width: "100vw", overflow: "hidden", background: "#06070a", color: "#fff" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" },
  viewport: { position: "absolute", inset: 0 },
  back: { position: "absolute", top: 22, right: 26, fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.55)", textDecoration: "none", zIndex: 5 },
  header: { position: "absolute", top: 20, left: 28, zIndex: 5 },
  wordmark: { fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: "0.14em" },
  dot: { color: "#7FB2FF" },
  subwordmark: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.36em", color: "rgba(255,255,255,0.4)", marginTop: 3 },
  footer: { position: "absolute", left: 28, right: 28, bottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, zIndex: 5 },
  jarvis: { maxWidth: 620, display: "flex", gap: 12 },
  jarvisTag: { fontFamily: DISPLAY, fontSize: 9, letterSpacing: "0.22em", color: "#7FB2FF", paddingTop: 2 },
  jarvisText: { fontFamily: DISPLAY, fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" },
  btn: { fontFamily: DISPLAY, fontSize: 11, letterSpacing: "0.14em", padding: "11px 22px", borderRadius: 3, cursor: "pointer", border: HAIR, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)" },
  btnPrimary: { background: "linear-gradient(#cfe4ff, #7FB2FF)", color: "#06070a", border: "1px solid transparent", fontWeight: 700 },
};
