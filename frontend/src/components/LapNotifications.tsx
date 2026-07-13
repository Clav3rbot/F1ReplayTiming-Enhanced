"use client";

import { useEffect, useRef, useState } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";
import { lapColorClass, SectorMarkers, SectorInfo, LapData } from "@/lib/lapTiming";

// How long each bubble stays on screen (wall-clock ms).
const BUBBLE_MS = 4500;
// Most bubbles shown at once.
const MAX_BUBBLES = 6;
// If more than this many laps complete in a single step, treat it as a seek
// (skip/scrub) and don't fire a flood of bubbles.
const MAX_PER_STEP = 5;
// Delay (replay seconds) before a bubble fires, so it appears just after the
// car crosses the line rather than just before.
const FIRE_DELAY_S = 0.5;

interface Bubble {
  id: number;
  abbr: string;
  teamColor: string;
  lapTime: string;
  colorClass: string;
  sectors: SectorInfo[] | null;
}

interface Props {
  enabled: boolean;
  isQualifying: boolean;
  isRace: boolean;
  lapData: LapData | undefined;
  currentTime: number;
  currentLap: number;
  drivers: ReplayDriver[];
}

export default function LapNotifications({
  enabled,
  isQualifying,
  isRace,
  lapData,
  currentTime,
  currentLap,
  drivers,
}: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const lastTimeRef = useRef<number | null>(null);
  const seenRef = useRef<Map<string, number>>(new Map());
  const idRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Latest drivers, read at fire time without re-running detection every frame.
  const driversRef = useRef(drivers);
  driversRef.current = drivers;

  // Clear any pending removal timers on unmount.
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const active = enabled && isQualifying;

  // Reset detection state whenever the feature turns on/off or the session changes.
  useEffect(() => {
    lastTimeRef.current = null;
    seenRef.current = new Map();
    setBubbles([]);
  }, [active]);

  useEffect(() => {
    if (!active || !lapData) return;

    // Set the baseline of "already crossed" laps without firing bubbles.
    const baseline = (now: number) => {
      const m = new Map<string, number>();
      for (const [abbr, laps] of lapData) {
        let mx = 0;
        for (const [lapNum, entry] of laps) {
          if (entry.completedAt !== null && entry.completedAt <= now - FIRE_DELAY_S && lapNum > mx) mx = lapNum;
        }
        m.set(abbr, mx);
      }
      seenRef.current = m;
    };

    const prev = lastTimeRef.current;
    const now = currentTime;

    // First run: establish the baseline, don't fire.
    if (prev === null) {
      lastTimeRef.current = now;
      baseline(now);
      return;
    }
    // Backward movement: a real scrub re-baselines; tiny jitter is ignored so
    // it can't silently "eat" laps that haven't fired yet.
    if (now < prev) {
      if (prev - now > 2) {
        lastTimeRef.current = now;
        baseline(now);
      }
      return;
    }
    lastTimeRef.current = now;

    // Find each driver's newest flying lap completed since we last fired.
    const candidates: { abbr: string; lapNum: number; time: string }[] = [];
    for (const [abbr, laps] of lapData) {
      const seen = seenRef.current.get(abbr) ?? 0;
      let best: { lapNum: number; time: string } | null = null;
      for (const [lapNum, entry] of laps) {
        if (lapNum < 2 || entry.completedAt === null) continue;
        if (entry.completedAt <= now - FIRE_DELAY_S && lapNum > seen) {
          if (!best || lapNum > best.lapNum) best = { lapNum, time: entry.time };
        }
      }
      if (best) candidates.push({ abbr, ...best });
    }

    if (candidates.length === 0) return;

    // A big batch means we jumped forward: re-baseline instead of flooding.
    if (candidates.length > MAX_PER_STEP) {
      baseline(now);
      return;
    }

    const newBubbles: Bubble[] = [];
    for (const c of candidates) {
      seenRef.current.set(c.abbr, c.lapNum);
      const drv = driversRef.current.find((d) => d.abbr === c.abbr);
      newBubbles.push({
        id: idRef.current++,
        abbr: c.abbr,
        teamColor: drv?.color || "#FFFFFF",
        lapTime: c.time,
        colorClass: lapColorClass(c.time, c.abbr, lapData, now, currentLap || 0, isRace, drv?.has_fastest_lap ?? false),
        sectors: drv?.sectors ?? null,
      });
    }

    setBubbles((prevBubbles) => [...prevBubbles, ...newBubbles].slice(-MAX_BUBBLES));

    const ids = newBubbles.map((b) => b.id);
    const timer = setTimeout(() => {
      setBubbles((prevBubbles) => prevBubbles.filter((b) => !ids.includes(b.id)));
    }, BUBBLE_MS);
    timersRef.current.push(timer);
  }, [active, lapData, currentTime, currentLap, isRace]);

  // Sector 3 completes at the line, so it lands in the driver's live sectors a
  // frame or two after the lap registers complete. Backfill any bubble that's
  // still missing markers from live data until it has all three.
  useEffect(() => {
    if (!active) return;
    setBubbles((prev) => {
      let changed = false;
      const next = prev.map((b) => {
        if (b.sectors && b.sectors.length >= 3) return b;
        const live = driversRef.current.find((d) => d.abbr === b.abbr)?.sectors ?? null;
        if (live && (!b.sectors || live.length > b.sectors.length)) {
          changed = true;
          return { ...b, sectors: live };
        }
        return b;
      });
      return changed ? next : prev;
    });
  }, [active, currentTime]);

  if (!active || bubbles.length === 0) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 pointer-events-none">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="lap-bubble flex items-center gap-3 whitespace-nowrap pl-2 pr-4 py-2 rounded-lg glass-panel shadow-glass"
        >
          <span className="w-1.5 h-6 rounded-sm flex-shrink-0" style={{ backgroundColor: b.teamColor }} />
          <span className="text-base font-extrabold text-white tracking-wide flex-shrink-0">{b.abbr}</span>
          <span className={`text-base font-bold tabular-nums flex-shrink-0 ${b.colorClass}`}>{b.lapTime}</span>
          <SectorMarkers sectors={b.sectors} className="flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
