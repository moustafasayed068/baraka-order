"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserDb } from "./client";

// Live updates for a branch: broadcast topic (auto-reconnects) + polling fallback.
// Returns false while the realtime channel is down, for the red offline banner.
export function useBranchLive(branchId: string, refresh: () => void, pollMs = 15_000) {
  const [live, setLive] = useState(true);
  const ref = useRef(refresh);
  useEffect(() => { ref.current = refresh; });
  useEffect(() => {
    const db = browserDb();
    const ch = db
      .channel(`branch:${branchId}`)
      .on("broadcast", { event: "changed" }, () => ref.current())
      .subscribe((s) => {
        setLive(s === "SUBSCRIBED");
        if (s === "SUBSCRIBED") ref.current(); // catch up on anything missed while disconnected
      });
    const poll = setInterval(() => ref.current(), pollMs);
    const onBack = () => ref.current();
    window.addEventListener("online", onBack);
    return () => {
      clearInterval(poll);
      window.removeEventListener("online", onBack);
      db.removeChannel(ch);
    };
  }, [branchId, pollMs]);
  return live;
}

// Keep tablets and TVs from sleeping (needs HTTPS; silently skipped on plain http).
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    const request = () => {
      if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      lock?.release();
    };
  }, []);
}

// Browsers block audio until a tap, so staff screens show a "tap to enable sound" button first.
export function useSound() {
  const ctx = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const enable = useCallback(() => {
    ctx.current ??= new AudioContext();
    ctx.current.resume();
    setEnabled(true);
  }, []);
  const play = useCallback((freqs: number[]) => {
    const c = ctx.current;
    if (!c) return;
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), at = c.currentTime + i * 0.22;
      o.connect(g); g.connect(c.destination);
      o.frequency.value = f;
      g.gain.setValueAtTime(0.3, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      o.start(at); o.stop(at + 0.2);
    });
  }, []);
  return { enabled, enable, play };
}
