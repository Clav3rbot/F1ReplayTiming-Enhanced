// Track outline geometry shared by the replay and live pages: where each
// outline point sits along the lap, and colouring parts of the lap on the map.

import type { SectorOverlay } from "@/lib/trackRenderer";

type Point = { x: number; y: number };

/** Each outline point's position along the lap (0–1), by distance rather than point index. */
export function outlineFractions(pts: Point[] | undefined): number[] {
  if (!pts?.length) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return cum.map((c) => c / total);
}

/** Corners as lap fractions, for the speed trace's distance axis. */
export function cornerFractions(
  pts: Point[] | undefined,
  corners: { x: number; y: number; number: number; letter?: string | null }[] | null | undefined,
  frac: number[],
): { frac: number; label: string }[] | undefined {
  if (!pts?.length || !corners?.length) return undefined;
  return corners
    .map((c) => {
      let best = 0;
      let bestD = Infinity;
      pts.forEach((p, i) => {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      return { frac: frac[best], label: `T${c.number}${c.letter ?? ""}` };
    })
    .sort((a, b) => a.frac - b.frac);
}

export const DEFAULT_SECTOR = "#3A3A4A";

/** Parts of the lap (0–1) as outline stretches: each from the first outline point at or past its start. */
export function partsOverlay(
  frac: number[],
  boundaries: SectorOverlay["boundaries"] | null | undefined,
  parts: { from: number; to: number; color: string }[],
): SectorOverlay | null {
  if (frac.length < 2) return null;
  const idx = (f: number) => {
    const i = frac.findIndex((v) => v >= f);
    return i < 0 ? frac.length - 1 : i;
  };
  return {
    boundaries: boundaries ?? { s1_end: 0, s2_end: 0, total: frac.length },
    colors: { s1: DEFAULT_SECTOR, s2: DEFAULT_SECTOR, s3: DEFAULT_SECTOR },
    segments: parts.map((p) => ({ start: idx(p.from), end: idx(p.to), color: p.color })),
  };
}
