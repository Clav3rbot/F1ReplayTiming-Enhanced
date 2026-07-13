// Shared lap-timing display logic used by both the leaderboard timing tower
// and the qualifying lap-completion bubbles, so the two never diverge.

export type SectorColor = "purple" | "green" | "yellow";

export interface SectorInfo {
  num: number;
  color: SectorColor;
}

/** driver -> lap number -> { lap time, replay time the lap was completed at } */
export type LapData = Map<string, Map<number, { time: string; completedAt: number | null }>>;

/** Parse a lap time string ("1:34.567" or "94.567") into seconds. */
export function toSecs(t: string): number {
  const p = t.split(":");
  return p.length === 2 ? parseInt(p[0]) * 60 + parseFloat(p[1]) : parseFloat(p[0]) || Infinity;
}

/**
 * Tailwind text-colour class for a lap time, matching the timing tower:
 * purple = fastest overall, green = personal best, muted = anything else.
 */
export function lapColorClass(
  lapTime: string,
  abbr: string,
  lapData: LapData | undefined,
  currentTime: number,
  currentLap: number,
  isRace: boolean,
  hasFastestLap: boolean,
): string {
  const driverLaps = lapData?.get(abbr);
  const lastSecs = toSecs(lapTime);

  // Personal best: this driver's completed laps up to now
  let personalBest = Infinity;
  if (driverLaps) {
    for (const [lapNum, entry] of driverLaps) {
      if (lapNum < 2) continue;
      if (!isRace && entry.completedAt !== null && entry.completedAt > currentTime) continue;
      if (isRace && lapNum > (currentLap || 0)) continue;
      const s = toSecs(entry.time);
      if (s < personalBest) personalBest = s;
    }
  }
  const isPersonalBest = lastSecs <= personalBest + 0.0005;

  // Fastest overall: races use the backend flag, practice/qualifying compare
  // against every driver's laps completed so far.
  let isFastest = false;
  if (isRace) {
    isFastest = hasFastestLap && isPersonalBest;
  } else if (isPersonalBest && lapData) {
    let overallFastest = Infinity;
    for (const [, laps] of lapData) {
      for (const [lapNum, entry] of laps) {
        if (lapNum < 2) continue;
        if (entry.completedAt !== null && entry.completedAt > currentTime) continue;
        const s = toSecs(entry.time);
        if (s < overallFastest) overallFastest = s;
      }
    }
    isFastest = lastSecs <= overallFastest + 0.0005;
  }

  return isFastest ? "text-purple-400" : isPersonalBest ? "text-green-400" : "text-f1-muted";
}

const SECTOR_TITLE = "S1 · S2 · S3 sector times\nPurple: personal best · Green: fastest · Yellow: normal · Grey: no data";

/**
 * The three sector squares, rendered identically to the leaderboard. The
 * `className` styles the wrapper (width/margins) so callers can size it.
 */
export function SectorMarkers({ sectors, className = "" }: { sectors?: SectorInfo[] | null; className?: string }) {
  return (
    <span className={`flex items-center justify-center gap-[2px] ${className}`} title={SECTOR_TITLE}>
      {[1, 2, 3].map((sn) => {
        const sec = sectors?.find((s) => s.num === sn);
        const bg = sec
          ? sec.color === "purple" ? "bg-f1-magenta shadow-[0_0_8px_rgba(255,0,255,0.6)]"
          : sec.color === "green" ? "bg-f1-green shadow-[0_0_8px_rgba(0,255,65,0.6)]"
          : "bg-yellow-400"
          : "bg-white/10";
        return <span key={sn} className={`w-[6px] h-[14px] rounded-[1px] ${bg}`} />;
      })}
    </span>
  );
}
