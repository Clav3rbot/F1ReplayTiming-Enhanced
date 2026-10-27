"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReplayDriver, QualiPhaseInfo } from "@/hooks/useReplaySocket";
import { lapDeleted, type LapEntry } from "@/components/Leaderboard";
import type { LapOverlay } from "@/lib/trackRenderer";
import { TYRE_COLORS, TYRE_SHORT } from "@/lib/constants";
import { MINI_HEX, miniStatesAt, type MiniSectorData } from "@/lib/miniSectors";

interface Props {
  laps: LapEntry[];
  drivers: ReplayDriver[];
  /** Replay time (s): only laps completed by now count. */
  now: number;
  /** Driver whose laps are listed, shared with the panel's first driver pick. */
  driver: string | null;
  onDriver: (abbr: string) => void;
  /** The panel's driver dropdown, shown above the lap list. */
  picker: ReactNode;
  /** Qualifying segment starts; empty outside qualifying (no filter then). */
  phases: QualiPhaseInfo[];
  /** The session's mini-sectors, when it has them and they're switched on. */
  mini?: MiniSectorData | null;
  onMapOverlay?: (o: LapOverlay | null) => void;
}

const SECTOR_KEYS = ["sector1", "sector2", "sector3"] as const;
const SECTOR_HEX = { purple: "#A855F7", green: "#22C55E", yellow: "#EAB308", none: "#3A3A4A" };
// Two times this close are the same time (strings carry milliseconds)
const EPS = 0.0005;

function secs(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = t.split(":");
  const v = p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : Number(p[0]);
  return Number.isFinite(v) ? v : null;
}

const fmtLap = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
const fmtGap = (s: number) => (s < EPS ? "0.000" : `+${s.toFixed(3)}`);

export default function SectorAnalysis({ laps, drivers, now, driver, onDriver, picker, phases, mini, onMapOverlay }: Props) {
  const [phase, setPhase] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // "ABBR/lap" shown on the map

  // Laps completed by now, in the chosen qualifying segment (a lap counts for the segment it ended in)
  const done = useMemo(() => {
    const phaseOf = (t: number) => {
      let p: string | null = null;
      for (const ph of phases) if (ph.timestamp <= t) p = ph.phase;
      return p;
    };
    return laps.filter((l) => l.time != null && l.time <= now && (!phase || phaseOf(l.time) === phase));
  }, [laps, now, phase, phases]);

  // Bests come from valid flying laps: deleted laps and pit in/out laps don't count
  const stats = useMemo(() => {
    const valid = done.filter((l) => !lapDeleted(l, now) && !l.pit_in && !l.pit_out);
    const best = SECTOR_KEYS.map((k) => {
      let b: { s: number; driver: string } | null = null;
      for (const l of valid) {
        const s = secs(l[k]);
        if (s != null && (!b || s < b.s)) b = { s, driver: l.driver };
      }
      return b;
    });
    const personal = new Map<string, { sectors: (number | null)[]; lap: number | null }>();
    for (const l of valid) {
      const p = personal.get(l.driver) ?? { sectors: [null, null, null], lap: null };
      SECTOR_KEYS.forEach((k, i) => {
        const s = secs(l[k]);
        if (s != null && (p.sectors[i] == null || s < p.sectors[i]!)) p.sectors[i] = s;
      });
      const t = secs(l.lap_time);
      if (t != null && (p.lap == null || t < p.lap)) p.lap = t;
      personal.set(l.driver, p);
    }
    const bestLap = Math.min(...[...personal.values()].map((p) => p.lap ?? Infinity));
    const ideal = [...personal.entries()]
      .flatMap(([abbr, p]) => (p.sectors.every((s) => s != null)
        ? [{ abbr, ideal: p.sectors.reduce((a, b) => a! + b!, 0)!, lap: p.lap }]
        : []))
      .sort((a, b) => a.ideal - b.ideal);
    return { best, personal, bestLap, ideal };
  }, [done, now]);

  const theoretical = stats.best.every((b) => b) ? stats.best.reduce((a, b) => a + b!.s, 0) : null;
  const colorOf = (abbr: string) => drivers.find((d) => d.abbr === abbr)?.color ?? "#888";
  const tone = (s: number | null, i: number | "lap", abbr: string): "purple" | "green" | "yellow" | "none" => {
    if (s == null) return "none";
    const sessionBest = i === "lap" ? stats.bestLap : stats.best[i]?.s;
    const pb = i === "lap" ? stats.personal.get(abbr)?.lap : stats.personal.get(abbr)?.sectors[i];
    if (sessionBest != null && s <= sessionBest + EPS) return "purple";
    if (pb != null && s <= pb + EPS) return "green";
    return "yellow";
  };
  const TONE_CLASS = { purple: "text-purple-400", green: "text-green-400", yellow: "text-ink", none: "text-f1-muted" };

  const mine = driver ? done.filter((l) => l.driver === driver).sort((a, b) => a.lap_number - b.lap_number) : [];
  const focused = focus ? done.find((l) => `${l.driver}/${l.lap_number}` === focus) : undefined;

  // The focused lap on the track map: its mini-sectors as F1 coloured them when
  // the session has them, else its three sectors against the session's bests.
  // The lap's last mini-sector arrives just after the lap's end time, hence +1 s.
  const overlayRef = useRef(onMapOverlay);
  overlayRef.current = onMapOverlay;
  const focusMini = focused?.time != null && mini ? miniStatesAt(mini, focused.driver, focused.time + 1) : null;
  const focusColors = !focused
    ? ""
    : focusMini
      ? focusMini.map((s) => MINI_HEX[s] ?? SECTOR_HEX.none).join(",")
      : SECTOR_KEYS.map((k, i) => SECTOR_HEX[tone(secs(focused[k]), i, focused.driver)]).join(",");
  useEffect(() => {
    if (!focusColors) {
      overlayRef.current?.(null);
      return;
    }
    const colors = focusColors.split(",");
    if (mini && colors.length === mini.ends.length) {
      overlayRef.current?.({ stretches: mini.ends.map((to, k) => ({ from: k ? mini.ends[k - 1] : 0, to, color: colors[k] })) });
      return;
    }
    const [s1, s2, s3] = colors;
    overlayRef.current?.({ sectors: { s1, s2, s3 } });
  }, [focusColors, mini]);
  useEffect(() => () => overlayRef.current?.(null), []);

  return (
    <div className="space-y-2 px-3 py-2">
      {phases.length > 0 && (
        <div className="flex items-center gap-1">
          {[null, ...phases.map((p) => p.phase)].map((p) => (
            <button
              key={p ?? "all"}
              onClick={() => setPhase(p)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                phase === p ? "bg-f1-red text-white" : "bg-f1-dark border border-f1-border text-f1-muted hover:text-ink"
              }`}
            >
              {p ?? "All"}
            </button>
          ))}
        </div>
      )}

      {/* Best sectors and the theoretical lap they add up to */}
      <div>
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-f1-muted">Best sectors & ideal laps</div>
        <div className="grid grid-cols-4 gap-1">
          {stats.best.map((b, i) => (
            <div key={i} className="rounded border border-f1-border px-1.5 py-1">
              <div className="text-[8px] font-bold text-f1-muted">S{i + 1}</div>
              <div className="font-mono text-[11px] font-bold tabular-nums text-purple-400">{b ? b.s.toFixed(3) : "—"}</div>
              <div className="text-[8px] font-bold text-f1-muted">{b?.driver ?? ""}</div>
            </div>
          ))}
          <div className="rounded border border-f1-border px-1.5 py-1">
            <div className="text-[8px] font-bold text-f1-muted">THEORETICAL</div>
            <div className="font-mono text-[11px] font-bold tabular-nums text-ink">{theoretical != null ? fmtLap(theoretical) : "—"}</div>
            <div className="text-[8px] font-bold text-f1-muted">
              {theoretical != null && Number.isFinite(stats.bestLap) ? `${(theoretical - stats.bestLap).toFixed(3)} to best` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Each driver's ideal lap (their best sectors) against their best lap */}
      {stats.ideal.length > 0 && (
        <div className="max-h-[180px] overflow-y-auto">
          <table className="w-full font-mono text-[10px] tabular-nums text-ink">
            <thead className="sticky top-0 bg-f1-card">
              <tr className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">
                <th className="py-0.5 text-left font-bold">Driver</th>
                <th className="px-1 text-right font-bold">Ideal</th>
                <th className="px-1 text-right font-bold">Best lap</th>
                <th className="pl-1 text-right font-bold" title="Best lap minus ideal lap">Gap</th>
              </tr>
            </thead>
            <tbody>
              {stats.ideal.map((r) => (
                <tr
                  key={r.abbr}
                  onClick={() => onDriver(r.abbr)}
                  className={`cursor-pointer border-t border-f1-border hover:bg-ink/5 ${r.abbr === driver ? "bg-ink/10" : ""}`}
                >
                  <td className="py-0.5 text-left">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(r.abbr) }} />
                    <span className="font-sans font-extrabold">{r.abbr}</span>
                  </td>
                  <td className="px-1 text-right">{fmtLap(r.ideal)}</td>
                  <td className="px-1 text-right">{r.lap != null ? fmtLap(r.lap) : "—"}</td>
                  <td className="pl-1 text-right text-f1-muted">{r.lap != null ? fmtGap(r.lap - r.ideal) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picker}

      {!driver ? (
        <p className="py-4 text-center text-xs text-f1-muted">Pick a driver to see their laps</p>
      ) : mine.length === 0 ? (
        <p className="py-4 text-center text-xs text-f1-muted">No completed laps yet</p>
      ) : (
        <div>
          <p className="mb-1 text-[9px] text-f1-muted">
            {mini
              ? "Click a lap to see its mini-sectors on the map, coloured as F1 timed them."
              : "Click a lap to see its sectors on the map against the session’s best."}
          </p>
          <table className="w-full font-mono text-[10px] tabular-nums">
            <thead>
              <tr className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">
                <th className="py-0.5 text-left font-bold">Lap</th>
                <th className="px-1 text-left font-bold">Time</th>
                <th className="px-1 text-right font-bold">S1</th>
                <th className="px-1 text-right font-bold">S2</th>
                <th className="px-1 text-right font-bold">S3</th>
                <th className="w-4" />
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => {
                const key = `${l.driver}/${l.lap_number}`;
                const deleted = lapDeleted(l, now);
                const pit = l.pit_in || l.pit_out;
                const t = secs(l.lap_time);
                const compound = l.compound ?? "";
                return (
                  <tr
                    key={key}
                    onClick={() => setFocus(focus === key ? null : key)}
                    title={deleted ? `Deleted: ${l.deleted_reason ?? "by the stewards"}` : undefined}
                    className={`cursor-pointer border-t border-f1-border hover:bg-ink/5 ${focus === key ? "bg-ink/10" : ""} ${pit ? "opacity-50" : ""}`}
                  >
                    <td className="whitespace-nowrap py-0.5 text-left text-f1-muted">
                      {l.lap_number}
                      {l.pit_out && <span className="ml-1 font-sans text-[8px] font-bold">OUT</span>}
                      {l.pit_in && <span className="ml-1 font-sans text-[8px] font-bold">IN</span>}
                    </td>
                    <td className={`px-1 text-left font-bold ${deleted ? "text-f1-muted line-through" : pit ? "text-f1-muted" : TONE_CLASS[tone(t, "lap", l.driver)]}`}>
                      {t != null ? fmtLap(t) : "—"}
                    </td>
                    {SECTOR_KEYS.map((k, i) => {
                      const s = secs(l[k]);
                      return (
                        <td key={k} className={`px-1 text-right ${deleted ? "text-f1-muted line-through" : pit ? "text-f1-muted" : TONE_CLASS[tone(s, i, l.driver)]}`}>
                          {s != null ? s.toFixed(3) : "—"}
                        </td>
                      );
                    })}
                    <td className="pl-1">
                      {TYRE_SHORT[compound] && (
                        <span
                          className="tyre-badge flex h-3 w-3 items-center justify-center rounded-full border text-[6px] font-extrabold leading-none"
                          style={{ borderColor: TYRE_COLORS[compound], color: TYRE_COLORS[compound] }}
                        >
                          {TYRE_SHORT[compound]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
