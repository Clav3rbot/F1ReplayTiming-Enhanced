"use client";

import { useRef, useEffect, useCallback } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  drivers: DriverMarker[];
  highlightedDriver: string | null;
}

export default function TrackCanvas({ trackPoints, rotation, drivers, highlightedDriver }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw track
    drawTrack(ctx, trackPoints, rect.width, rect.height, rotation);

    // Draw drivers
    drawDrivers(ctx, drivers, trackPoints, rect.width, rect.height, rotation, highlightedDriver);
  }, [trackPoints, rotation, drivers, highlightedDriver]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const observer = new ResizeObserver(() => render());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [render]);

  return (
    <div ref={containerRef} className="w-full h-full bg-f1-dark">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
