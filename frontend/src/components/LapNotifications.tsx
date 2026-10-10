"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";
import { lapColorClass, sectorBgClass, sessionBestSecs, toSecs, SectorInfo, LapData } from "@/lib/lapTiming";

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
  /** Seconds to the fastest lap before this one (negative = new fastest). */
  delta: number | null;
  sectors: SectorInfo[] | null;
}

function formatDelta(d: number): string {
  return `${d < 0 ? "-" : "+"}${Math.abs(d).toFixed(3)}`;
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
      const delta = toSecs(c.time) - sessionBestSecs(lapData, now, c);
      newBubbles.push({
        id: idRef.current++,
        abbr: c.abbr,
        teamColor: drv?.color || "#FFFFFF",
        lapTime: c.time,
        colorClass: lapColorClass(c.time, c.abbr, lapData, now, currentLap || 0, isRace, drv?.has_fastest_lap ?? false),
        delta: Number.isFinite(delta) ? delta : null,
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

  // Top-left is the one corner of the map no other overlay uses. Newest on top:
  // a new card pushes the stack down and the oldest leaves from the bottom, so
  // nothing jumps when a card is removed.
  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
      {[...bubbles].reverse().map((b) => {
        const position = drivers.find((d) => d.abbr === b.abbr)?.position ?? null;
        const fastest = b.colorClass === "text-purple-400";
        const pb = b.colorClass === "text-green-400";
        return (
          <div
            key={b.id}
            className={`lap-bubble lap-card flex h-[46px] w-[224px] overflow-hidden rounded-lg ${fastest ? "lap-card-fastest" : ""}`}
            // Second delay starts the exit just before the bubble is removed.
            style={{ animationDelay: `0ms, ${BUBBLE_MS - 350}ms`, "--team": b.teamColor } as CSSProperties}
          >
            <div className="flex w-9 flex-shrink-0 items-center justify-center border-r border-ink/[0.07] bg-ink/[0.04] font-mono text-[15px] font-bold tabular-nums-fixed text-ink">
              {position ?? "–"}
            </div>
            <div className="lap-card-team relative flex min-w-0 flex-1 items-center justify-between gap-3 px-3">
              <span className="lap-card-bar absolute inset-y-[9px] left-0 w-[3px] rounded-r-full" />
              <div className="flex flex-col gap-[7px]">
                <span className="font-display text-[17px] font-bold leading-none tracking-[0.06em] text-ink">{b.abbr}</span>
                <span className="flex gap-[3px]">
                  {[1, 2, 3].map((sn) => (
                    <span key={sn} className={`h-[3px] w-[13px] rounded-full ${sectorBgClass(b.sectors?.find((s) => s.num === sn))}`} />
                  ))}
                </span>
              </div>
              <div className="flex flex-col items-end gap-[5px]">
                <span className={`font-mono text-[16px] font-bold leading-none tabular-nums-fixed ${fastest || pb ? b.colorClass : "text-ink"}`}>
                  {b.lapTime}
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-bold leading-none tracking-[0.14em]">
                  {fastest && <span className="text-purple-400">FASTEST</span>}
                  {pb && <span className="text-green-400">PB</span>}
                  {b.delta !== null && (
                    <span className="font-mono text-[10px] tracking-normal tabular-nums-fixed text-f1-muted">{formatDelta(b.delta)}</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
