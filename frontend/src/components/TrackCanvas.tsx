"use client";

import { useRef, useEffect } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker, SectorOverlay, Corner, MarshalSector, SectorFlag } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  trackStatus?: string;
  drivers: DriverMarker[];
  highlightedDrivers: string[];
  playbackSpeed?: number;
  showDriverNames?: boolean;
  sectorOverlay?: SectorOverlay | null;
  compact?: boolean;
  zoom?: number;
  corners?: Corner[] | null;
  marshalSectors?: MarshalSector[] | null;
  sectorFlags?: SectorFlag[] | null;
  playing?: boolean;
}

// Longer than the 500ms frame interval so the dot is always still moving
// when the next target arrives - the more overlap, the smoother the motion
const BASE_INTERP_MS = 750;

interface PosEntry {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  startTime: number;
  duration: number;
}

function getCanvasWindow(canvas: HTMLCanvasElement | null): Window {
  return canvas?.ownerDocument?.defaultView || window;
}


export default function TrackCanvas({
  trackPoints,
  rotation,
  trackStatus = "green",
  drivers,
  highlightedDrivers,
  playbackSpeed = 1,
  showDriverNames = true,
  sectorOverlay = null,
  compact = false,
  zoom = 1,
  corners = null,
  marshalSectors = null,
  sectorFlags = null,
  playing = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Two-finger touch or mouse drag (PC) */
  type PanSession =
    | { mode: "twofinger"; originX: number; originY: number; baseX: number; baseY: number }
    | { mode: "mouse"; pointerId: number; originX: number; originY: number; baseX: number; baseY: number };
  const panSessionRef = useRef<PanSession | null>(null);

  const posRef = useRef<Map<string, PosEntry>>(new Map());
  const driversRef = useRef<DriverMarker[]>([]);
  const wheelZoomFactorRef = useRef(1);
  const zoomRef = useRef(zoom);

  /** Group all props that the rAF loop reads via ref (to avoid recreating the loop). */
  const latestPropsRef = useRef({
    trackStatus,
    playbackSpeed,
    showDriverNames,
    sectorOverlay,
    compact,
    corners,
    marshalSectors,
    sectorFlags,
  });
  useEffect(() => {
    latestPropsRef.current = { trackStatus, playbackSpeed, showDriverNames, sectorOverlay, compact, corners, marshalSectors, sectorFlags };
  });
  useEffect(() => {
    zoomRef.current = zoom * wheelZoomFactorRef.current;
  }, [zoom]);

  // Snap drivers to current position when paused (stop interpolation glide)
  useEffect(() => {
    if (!playing) {
      const now = performance.now();
      posRef.current.forEach((entry) => {
        const t = Math.min((now - entry.startTime) / entry.duration, 1);
        const x = entry.prevX + (entry.targetX - entry.prevX) * t;
        const y = entry.prevY + (entry.targetY - entry.prevY) * t;
        entry.prevX = x;
        entry.prevY = y;
        entry.targetX = x;
        entry.targetY = y;
        entry.startTime = now;
      });
    }
  }, [playing]);

  // Update targets when drivers prop changes
  useEffect(() => {
    driversRef.current = drivers;
    const now = performance.now();
    // Scale interpolation duration with speed so dots keep up
    const duration = BASE_INTERP_MS / Math.max(latestPropsRef.current.playbackSpeed, 0.25);

    for (const drv of drivers) {
      const entry = posRef.current.get(drv.abbr);
      if (!entry) {
        // First time seeing driver - snap to position
        posRef.current.set(drv.abbr, {
          prevX: drv.x, prevY: drv.y,
          targetX: drv.x, targetY: drv.y,
          startTime: now,
          duration,
        });
      } else {
        // Start new interpolation from current visual position
        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / entry.duration, 1);
        entry.prevX = entry.prevX + (entry.targetX - entry.prevX) * t;
        entry.prevY = entry.prevY + (entry.targetY - entry.prevY) * t;
        entry.targetX = drv.x;
        entry.targetY = drv.y;
        entry.startTime = now;
        entry.duration = duration;
      }
    }
  }, [drivers]);

  // Continuous animation loop
  useEffect(() => {
    let running = true;

    function animate() {
      if (!running) return;

      const canvas = canvasRef.current;
      const hostWindow = getCanvasWindow(canvas);
      if (!canvas) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      const dpr = hostWindow.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;

      if (w === 0 || h === 0) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Pan on the 2D context (not CSS transform): moving the <canvas> element under overflow:hidden
      // clips the bitmap and leaves empty margins. Translate here keeps the full viewport as the bitmap.
      const px = panRef.current.x;
      const py = panRef.current.y;
      ctx.save();
      ctx.translate(px, py);

      const lp = latestPropsRef.current;
      drawTrack(
        ctx,
        trackPoints,
        w,
        h,
        rotation,
        lp.trackStatus,
        lp.sectorOverlay,
        lp.compact,
        zoomRef.current,
        lp.corners,
        lp.marshalSectors,
        lp.sectorFlags,
        0,
        0,
      );

      const now = performance.now();
      const curr = driversRef.current;
      const interpolated: DriverMarker[] = curr.map((drv) => {
        const entry = posRef.current.get(drv.abbr);
        if (!entry) return drv;

        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / entry.duration, 1);
        const x = entry.prevX + (entry.targetX - entry.prevX) * t;
        const y = entry.prevY + (entry.targetY - entry.prevY) * t;

        return { ...drv, x, y };
      });

      drawDrivers(
        ctx,
        interpolated,
        trackPoints,
        w,
        h,
        rotation,
        highlightedDrivers,
        lp.showDriverNames,
        lp.compact,
        zoomRef.current,
        0,
        0,
      );

      ctx.restore();

      hostWindow.requestAnimationFrame(animate);
    }

    const hostWindow = getCanvasWindow(canvasRef.current);
    hostWindow.requestAnimationFrame(animate);
    return () => { running = false; };
  }, [trackPoints, rotation, highlightedDrivers]);

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hostWindow = el.ownerDocument?.defaultView || window;

    const rect = el.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };

    const observer = new hostWindow.ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pan: two-finger touch (tablet) or click-drag with mouse (PC).
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const clampPan = (x: number, y: number) => {
      const { w, h } = sizeRef.current;
      const z = Math.max(1, zoomRef.current);
      // Zoom enlarges the track in the padded box; allow proportionally more pan so edges stay reachable.
      const maxX = Math.max(56, w * 0.42 * z);
      const maxY = Math.max(56, h * 0.42 * z);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    };

    const midpoint = (t0: Touch, t1: Touch) => ({
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const mid = midpoint(e.touches[0], e.touches[1]);
      panSessionRef.current = {
        mode: "twofinger",
        originX: mid.x,
        originY: mid.y,
        baseX: panRef.current.x,
        baseY: panRef.current.y,
      };
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      const s = panSessionRef.current;
      if (e.touches.length !== 2 || !s || s.mode !== "twofinger") return;
      const mid = midpoint(e.touches[0], e.touches[1]);
      const dx = mid.x - s.originX;
      const dy = mid.y - s.originY;
      panRef.current = clampPan(s.baseX + dx, s.baseY + dy);
      e.preventDefault();
    };

    const onTouchEnd = () => {
      const s = panSessionRef.current;
      if (s?.mode === "twofinger") panSessionRef.current = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (panSessionRef.current?.mode === "twofinger") return;
      panSessionRef.current = {
        mode: "mouse",
        pointerId: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        baseX: panRef.current.x,
        baseY: panRef.current.y,
      };
      canvas.style.cursor = "grabbing";
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
    };

    const onWheel = (e: WheelEvent) => {
      // Desktop wheel zoom (mouse / trackpad) on map canvas
      const isMouseLike = e.deltaMode === 0 || e.deltaMode === 1;
      if (!isMouseLike) return;
      const base = zoom > 0 ? zoom : 1;
      const current = wheelZoomFactorRef.current;
      const next = current * Math.exp(-e.deltaY * 0.0015);
      wheelZoomFactorRef.current = Math.max(0.8 / base, Math.min(2.2 / base, next));
      zoomRef.current = base * wheelZoomFactorRef.current;
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = panSessionRef.current;
      if (!s || s.mode !== "mouse" || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.originX;
      const dy = e.clientY - s.originY;
      panRef.current = clampPan(s.baseX + dx, s.baseY + dy);
      e.preventDefault();
    };

    const endMousePan = (e: PointerEvent) => {
      const s = panSessionRef.current;
      if (!s || s.mode !== "mouse" || s.pointerId !== e.pointerId) return;
      panSessionRef.current = null;
      canvas.style.cursor = "";
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endMousePan);
    canvas.addEventListener("pointercancel", endMousePan);
    canvas.addEventListener("lostpointercapture", endMousePan);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endMousePan);
      canvas.removeEventListener("pointercancel", endMousePan);
      canvas.removeEventListener("lostpointercapture", endMousePan);
      canvas.removeEventListener("wheel", onWheel);
      canvas.style.cursor = "";
    };
  }, [zoom]);

  // Keep pan origin consistent when zoom buttons change; clear any stray CSS transform.
  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    wheelZoomFactorRef.current = 1;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.transform = "";
  }, [zoom]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full cursor-grab bg-f1-dark overflow-hidden touch-none active:cursor-grabbing"
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
