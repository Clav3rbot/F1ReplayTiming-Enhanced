"use client";

import { SplitFlapDisplay } from "./SplitFlapDisplay";
import { CSSProperties, useEffect, useMemo, useState } from "react";

// Reversed so countdown decrements are 1-step forward transitions (0→9 wrap = 1 step).
const countdownChars = [
  "9876543210", // days tens
  "9876543210", // days units
  ":",
  "210",        // hours tens
  "9876543210", // hours units
  ":",
  "543210",     // minutes tens
  "9876543210", // minutes units
  ":",
  "543210",     // seconds tens
  "9876543210", // seconds units
];

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const dd = String(Math.min(days, 99)).padStart(2, "0");
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${dd}:${hh}:${mm}:${ss}`;
}

interface RaceCountdownProps {
  targetDate: Date;
  raceName?: string;
}

export default function RaceCountdown({ targetDate, raceName }: RaceCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    function tick() { setNow(Date.now()); }
    let id = setInterval(tick, 1000);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        // Clear queued catchup firings, jump to current time immediately
        clearInterval(id);
        tick();
        id = setInterval(tick, 1000);
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const ms = targetDate.getTime() - now;

  // Applied to the inner rotator so label + display rotate together.
  const rotatorStyle = useMemo<CSSProperties>(
    () => ({
      transform: hovered ? "rotateY(-45deg) translateX(-12%)" : undefined,
    }),
    [hovered]
  );

  if (ms <= 0) return null;

  return (
    // Outer: filter only (filter on a perspective/preserve-3d ancestor flattens 3D)
    <div
      className="race-countdown-filter"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Middle: perspective only — Root must see this as nearest perspective ancestor */}
      <div className="race-countdown-perspective">
        {/* Inner: rotateY transform — label + Root rotate together */}
        <div className="race-countdown-rotator" style={rotatorStyle}>
          {raceName && (
            <span className="race-countdown-label">{raceName}</span>
          )}
          <SplitFlapDisplay.Root
            value={formatCountdown(ms)}
            length={11}
            characters={countdownChars}
            flipDuration={800}
            className="race-countdown"
          />
        </div>
      </div>
    </div>
  );
}
