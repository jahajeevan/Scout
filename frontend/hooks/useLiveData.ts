"use client";

import { useEffect, useState } from "react";

// System stats for the gauges (spec §4: CPU / RAM / GPU / Battery).
//
// These are now REAL values, polled from the backend GET /stats endpoint, which
// reads CPU/RAM/battery via psutil and Apple-Silicon GPU utilisation via ioreg
// (see backend/main.py). The backend port comes only from config/jarvis.json.

export interface LiveData {
  cpu: number;
  ram: number;
  gpu: number;
  battery: number;
}

interface StatsResponse {
  cpu: number;
  ram: number;
  gpu: number;
  battery: number;
}

const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT;
const POLL_MS = 1200;

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>({
    cpu: 0,
    ram: 0,
    gpu: 0,
    battery: 100,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !BACKEND_PORT) return;
    const url = `http://${window.location.hostname}:${BACKEND_PORT}/stats`;
    let active = true;

    async function poll(): Promise<void> {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as StatsResponse;
        if (active) {
          setData({
            cpu: json.cpu,
            ram: json.ram,
            gpu: json.gpu,
            battery: json.battery,
          });
        }
      } catch {
        // Backend not reachable — keep the last known values.
      }
    }

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return data;
}
