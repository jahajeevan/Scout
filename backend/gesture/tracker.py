"""MediaPipe hand tracking + gesture control (Phase 3).

Direct-manipulation model — the particle sun is grabbed and moved, not toggled.

Detection is rotation-invariant: a finger counts as "extended" when its tip is
farther from the wrist than its knuckle, so it works with the hand tilted at any
angle (the old y-only test only worked for a perfectly upright hand).

A live DEBUG WINDOW shows the camera feed with the hand skeleton drawn and the
detected gesture + finger states overlaid, so detection can actually be seen and
tuned. Press 'q' in that window to quit. Disable it with --no-window.

Run (repo root, gesture venv)::

    ./.venv-gesture/bin/python -m backend.gesture.tracker
    ./.venv-gesture/bin/python -m backend.gesture.tracker --simulate   # no camera
    ./.venv-gesture/bin/python -m backend.gesture.tracker --no-window  # headless

Gestures: fist·rotate, two-hands·zoom, pinch·zoom-in, palm·burst, peace·implode,
point·spin, three·nebula, four·overview, ok·freeze, rock·reset.
"""

from __future__ import annotations

import asyncio
import math
import sys
import threading
import time
from typing import Sequence

from backend.config import CAMERA_INDEX, GESTURE_WS_PORT
from backend.gesture.ws_bridge import GestureBridge

# MediaPipe hand landmark indices.
WRIST = 0
THUMB_TIP, THUMB_IP, THUMB_MCP = 4, 3, 2
INDEX_TIP, INDEX_PIP, INDEX_MCP = 8, 6, 5
MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP = 12, 10, 9
RING_TIP, RING_PIP = 16, 14
PINKY_TIP, PINKY_PIP = 20, 18

ROTATE_GAIN = 3.4
ZOOM_MIN, ZOOM_MAX = 0.6, 3.2

Point = tuple[float, float]


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _extended(lm: Sequence[Point], tip: int, pip: int) -> bool:
    """Rotation-invariant: tip is farther from the wrist than the knuckle."""
    return _dist(lm[tip], lm[WRIST]) > _dist(lm[pip], lm[WRIST]) * 1.05


def _thumb_ext(lm: Sequence[Point]) -> bool:
    """Thumb is out when its tip sits well away from the index knuckle."""
    palm = _dist(lm[WRIST], lm[MIDDLE_MCP]) or 1e-6
    return _dist(lm[THUMB_TIP], lm[INDEX_MCP]) / palm > 0.8


def _remap(v: float, lo: float, hi: float, out_lo: float, out_hi: float) -> float:
    if hi == lo:
        return out_lo
    t = max(0.0, min(1.0, (v - lo) / (hi - lo)))
    return out_lo + t * (out_hi - out_lo)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def finger_states(lm: Sequence[Point]) -> tuple[bool, bool, bool, bool, float]:
    """Return (index, middle, ring, pinky extended) + normalised pinch gap."""
    palm = _dist(lm[WRIST], lm[MIDDLE_MCP]) or 1e-6
    pinch_gap = _dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm
    return (
        _extended(lm, INDEX_TIP, INDEX_PIP),
        _extended(lm, MIDDLE_TIP, MIDDLE_PIP),
        _extended(lm, RING_TIP, RING_PIP),
        _extended(lm, PINKY_TIP, PINKY_PIP),
        pinch_gap,
    )


def classify_pose(lm: Sequence[Point]) -> str | None:
    """Classify a one-hand static pose from 21 normalised landmarks."""
    index_ext, middle_ext, ring_ext, pinky_ext, pinch_gap = finger_states(lm)
    thumb_ext = _thumb_ext(lm)
    extended = sum([index_ext, middle_ext, ring_ext, pinky_ext])

    # OK sign: thumb + index circle while the other three stay up.
    if pinch_gap < 0.5 and middle_ext and ring_ext and pinky_ext:
        return "ok"
    # ILY: thumb + index + pinky, middle + ring down.
    if thumb_ext and index_ext and pinky_ext and not middle_ext and not ring_ext:
        return "ily"
    # Gun / L: thumb + index out (apart), others down.
    if thumb_ext and index_ext and pinch_gap > 0.6 and not middle_ext and not ring_ext and not pinky_ext:
        return "gun"
    # Shaka / call-me: thumb + pinky out, others down.
    if thumb_ext and pinky_ext and not index_ext and not middle_ext and not ring_ext:
        return "shaka"
    # Pinch: thumb + index tips together, others folded.
    if pinch_gap < 0.45 and extended <= 1:
        return "pinch_close" if pinch_gap < 0.28 else "pinch"
    # Fist: everything folded.
    if extended == 0:
        return "fist"
    # Rock: index + pinky up, middle + ring down.
    if index_ext and pinky_ext and not middle_ext and not ring_ext:
        return "rock"
    # Peace: index + middle up.
    if index_ext and middle_ext and not ring_ext and not pinky_ext:
        return "peace"
    # Three: index + middle + ring up.
    if index_ext and middle_ext and ring_ext and not pinky_ext:
        return "three"
    # Tails: middle + ring + pinky up, index down.
    if not index_ext and middle_ext and ring_ext and pinky_ext:
        return "tails"
    # Point: index only.
    if index_ext and not middle_ext and not ring_ext and not pinky_ext:
        return "point"
    # Pinky only.
    if pinky_ext and not index_ext and not middle_ext and not ring_ext:
        return "pinky"
    # All four up: spread wide = palm; held together = four.
    if extended == 4:
        palm = _dist(lm[WRIST], lm[MIDDLE_MCP]) or 1e-6
        spread = _dist(lm[INDEX_TIP], lm[PINKY_TIP]) / palm
        return "palm_spread" if spread > 0.9 else "four"
    return None


def _pose_to_payload(
    pose: str | None,
    hands_count: int,
    mdx: float,
    mdy: float,
    zoom_state: float,
) -> tuple[dict[str, object], float]:
    """Map a detected pose to a broadcast payload; returns (payload, new_zoom)."""
    payload: dict[str, object] = {
        "gesture": pose,
        "hands": hands_count,
        "rotDX": 0.0,
        "rotDY": 0.0,
        "zoom": None,
        "explode": 0.0,
        "grabbing": False,
        "reset": False,
    }
    if pose == "fist":
        payload.update(gesture="rotate", grabbing=True,
                       rotDX=round(-mdy * ROTATE_GAIN, 4), rotDY=round(mdx * ROTATE_GAIN, 4))
    elif pose in ("pinch", "pinch_close"):
        zoom_state = _clamp(zoom_state + 0.06, ZOOM_MIN, ZOOM_MAX)
        payload.update(gesture="pinch", grabbing=True, zoom=round(zoom_state, 3))
    elif pose == "palm_spread":
        payload.update(gesture="expand", explode=1.0)
    elif pose == "peace":
        payload.update(gesture="peace", explode=-0.55)
    elif pose == "point":
        payload.update(gesture="point", grabbing=True, rotDY=0.16)
    elif pose == "three":
        payload.update(gesture="three", grabbing=True, explode=0.5, rotDY=0.03)
    elif pose == "four":
        zoom_state = 0.7
        payload.update(gesture="four", zoom=round(zoom_state, 3))
    elif pose == "ok":
        payload.update(gesture="freeze", grabbing=True)
    elif pose == "rock":
        zoom_state = 1.0
        payload.update(gesture="reset", reset=True)
    elif pose == "gun":
        # Blast — a big, sharp burst outward.
        payload.update(gesture="gun", explode=1.3)
    elif pose == "shaka":
        # Hyperspin — whip it around fast.
        payload.update(gesture="shaka", grabbing=True, rotDY=0.3)
    elif pose == "ily":
        # Nova — burst while spinning.
        payload.update(gesture="ily", grabbing=True, explode=0.9, rotDY=0.12)
    elif pose == "tails":
        # Vortex — implode while swirling.
        payload.update(gesture="tails", grabbing=True, explode=-0.35, rotDY=0.14)
    elif pose == "pinky":
        # Tilt — rotate on the vertical axis.
        payload.update(gesture="pinky", grabbing=True, rotDX=0.14)
    return payload, zoom_state


def camera_loop(bridge: GestureBridge, show_window: bool) -> None:
    """Webcam loop — MUST run on the main thread (macOS camera + cv2 window)."""
    import cv2
    import mediapipe as mp

    mp_hands = mp.solutions.hands
    mp_draw = mp.solutions.drawing_utils
    hands = mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.6,
                           min_tracking_confidence=0.5)
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[gesture] ERROR: could not open camera index {CAMERA_INDEX}")
        return
    print("[gesture] Camera open. Make a FIST and move to rotate. Press 'q' to quit.")

    prev_primary: Point | None = None
    zoom_state = 1.0
    last_send = 0.0
    last_key: tuple[object, ...] | None = None
    last_pose_log: str | None = "__"

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(rgb)
        lists = result.multi_hand_landmarks or []
        n = len(lists)

        pose: str | None = None
        mdx = mdy = 0.0

        if n >= 1:
            lm0 = [(p.x, p.y) for p in lists[0].landmark]
            wx, wy = lm0[WRIST]
            if prev_primary is not None:
                mdx, mdy = wx - prev_primary[0], wy - prev_primary[1]
            prev_primary = (wx, wy)
            if n >= 2:
                lm1 = [(p.x, p.y) for p in lists[1].landmark]
                dist = _dist((wx, wy), lm1[WRIST])
                zoom_state = _clamp(_remap(dist, 0.2, 0.8, 0.7, 3.0), ZOOM_MIN, ZOOM_MAX)
                pose = "__two__"
            else:
                pose = classify_pose(lm0)
        else:
            prev_primary = None

        if pose == "__two__":
            payload = {
                "gesture": "zoom", "hands": n,
                "rotDX": round(-mdy * ROTATE_GAIN, 4), "rotDY": round(mdx * ROTATE_GAIN, 4),
                "zoom": round(zoom_state, 3), "explode": 0.0, "grabbing": True, "reset": False,
            }
        else:
            payload, zoom_state = _pose_to_payload(pose, n, mdx, mdy, zoom_state)

        gesture = payload["gesture"]
        if gesture != last_pose_log:
            print(f"[gesture] detected: {gesture}")
            last_pose_log = gesture  # type: ignore[assignment]

        now = time.monotonic()
        active = bool(payload["grabbing"]) or payload["explode"] != 0 or bool(payload["reset"])
        key = (gesture, payload["zoom"], payload["grabbing"], payload["rotDX"], payload["rotDY"])
        if now - last_send > 0.05 and (active or key != last_key):
            bridge.broadcast_threadsafe(payload)
            last_send = now
            last_key = key

        if show_window:
            for hand_landmarks in lists:
                mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            label = str(gesture) if gesture else "-"
            cv2.putText(frame, f"GESTURE: {label}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (48, 168, 240), 2)
            if n == 1:
                idx, mid, rng, pky, gap = finger_states(
                    [(p.x, p.y) for p in lists[0].landmark]
                )
                info = f"I{int(idx)} M{int(mid)} R{int(rng)} P{int(pky)}  pinch={gap:.2f}"
                cv2.putText(frame, info, (10, 60), cv2.FONT_HERSHEY_SIMPLEX,
                            0.6, (255, 255, 255), 1)
            cv2.putText(frame, "press 'q' to quit", (10, frame.shape[0] - 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
            cv2.imshow("JARVIS gesture tracker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        else:
            time.sleep(0.02)

    cap.release()
    if show_window:
        cv2.destroyAllWindows()


async def simulate_loop(bridge: GestureBridge) -> None:
    """No-camera demo: rotate → zoom in → burst → reset, on a cycle."""
    print("[gesture] SIMULATE mode — cycling rotate / zoom / burst / reset.")
    t = 0
    while True:
        phase = (t // 60) % 4
        payload = {
            "gesture": None, "hands": 1, "rotDX": 0.0, "rotDY": 0.0,
            "zoom": None, "explode": 0.0, "grabbing": False, "reset": False,
        }
        step = t % 60
        if phase == 0:
            payload.update(gesture="rotate", rotDY=0.06, grabbing=True)
        elif phase == 1:
            payload.update(gesture="pinch", zoom=round(1 + (step / 60) * 2.0, 3),
                           rotDY=0.02, grabbing=True)
        elif phase == 2:
            payload.update(gesture="rotate", zoom=3.0, rotDY=0.05, grabbing=True)
        else:
            if step < 30:
                payload.update(gesture="expand", explode=1.0, zoom=1.6)
            else:
                payload.update(gesture="reset", zoom=1.0, reset=True)
        bridge.broadcast_threadsafe(payload)
        t += 1
        await asyncio.sleep(0.05)


async def _run_simulate() -> None:
    bridge = GestureBridge()
    await bridge.start()
    print(f"[gesture] WS bridge live on ws://0.0.0.0:{GESTURE_WS_PORT}")
    await simulate_loop(bridge)


def _run_camera(show_window: bool) -> None:
    """WS bridge on a background thread; camera on the main thread."""
    bridge = GestureBridge()
    ready = threading.Event()

    def serve() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(bridge.start())
        ready.set()
        loop.run_forever()

    threading.Thread(target=serve, daemon=True).start()
    ready.wait(timeout=5)
    print(f"[gesture] WS bridge live on ws://0.0.0.0:{GESTURE_WS_PORT}")
    camera_loop(bridge, show_window)


if __name__ == "__main__":
    try:
        if "--simulate" in sys.argv:
            asyncio.run(_run_simulate())
        else:
            _run_camera(show_window="--no-window" not in sys.argv)
    except KeyboardInterrupt:
        print("\n[gesture] Stopped.")
