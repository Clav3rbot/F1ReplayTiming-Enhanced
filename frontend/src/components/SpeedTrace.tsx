"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ReplayDriver } from "@/hooks/useReplaySocket";
import type { LapEntry } from "@/components/Leaderboard";
import TyreIndicator from "@/components/TyreIndicator";

interface LapTelemetry {
  driver: string;
  lap: number;
  distance: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
}

interface Props {
  year: number;
  round: number;
  sessionType: string;
  /** Selected drivers; the first one gets the corner labels and sector cuts. */
  drivers: ReplayDriver[];
  laps: LapEntry[];
  /** Replay time (s). */
  now: number;
  useImperial?: boolean;
}

const W = 1000; // SVG x units
const SPEED_TOP = 22;
const SPEED_H = 120;
const STRIP_H = 22;
const STRIP_GAP = 6;
const STRIPS = ["throttle", "brake", "gear", "rpm"] as const;
const STRIP_LABEL: Record<(typeof STRIPS)[number], string> = { throttle: "THR", brake: "BRK", gear: "GEAR", rpm: "RPM" };
const H = SPEED_TOP + SPEED_H + 14 + STRIPS.length * (STRIP_H + STRIP_GAP);
const stripTop = (k: number) => SPEED_TOP + SPEED_H + 14 + k * (STRIP_H + STRIP_GAP);
// A speed swing this large (km/h) confirms a corner minimum or a straight-line maximum
const EXTREMUM_SWING = 12;
// Teammates share a team colour: the later-selected one is drawn dashed, as on the F1 graphics
const TEAMMATE_DASH = "6 4";

function secs(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = t.split(":");
  const v = p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : Number(p[0]);
  return Number.isFinite(v) ? v : null;
}

const fmtLap = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;

/** Confirmed local maxima/minima: zigzag with a fixed swing threshold. */
function extrema(v: number[]): { i: number; max: boolean }[] {
  const out: { i: number; max: boolean }[] = [];
  if (v.length < 2) return out;
  let lookingForMax = v[1] >= v[0];
  let ext = 0;
  for (let i = 1; i < v.length; i++) {
    if (lookingForMax) {
      if (v[i] >= v[ext]) ext = i;
      else if (v[ext] - v[i] >= EXTREMUM_SWING) { out.push({ i: ext, max: true }); lookingForMax = false; ext = i; }
    } else {
      if (v[i] <= v[ext]) ext = i;
      else if (v[i] - v[ext] >= EXTREMUM_SWING) { out.push({ i: ext, max: false }); lookingForMax = true; ext = i; }
    }
  }
  return out;
}

/** Whole-lap geometry: x and seconds-to-lap-end per sample, plus value ranges for shared scales. */
function buildGeo(tel: LapTelemetry) {
  const d = tel.distance;
  const len = d[d.length - 1] || 1;
  // Stored telemetry has no clock, so rebuild one counting back from the lap end,
  // which laps.json gives exactly (the start isn't: out-laps leave the garage at
  // an unknown time). Moving: distance / speed. Slow or stopped, distance stalls,
  // so use the mean moving sample interval (samples are evenly spaced in time).
  // Checked against replay frame speeds, race and qualifying: MAE 1-5 km/h.
  const step = d.slice(1).map((v, i) => {
    const kmh = (tel.speed[i + 1] + tel.speed[i]) / 2;
    return kmh > 30 ? Math.max(v - d[i], 0) / (kmh / 3.6) : null;
  });
  const moving = step.filter((v): v is number => v != null);
  const est = moving.length ? moving.reduce((a, b) => a + b, 0) / moving.length : 0.25;
  const rem = new Array<number>(d.length).fill(0);
  for (let i = d.length - 2; i >= 0; i--) rem[i] = rem[i + 1] + (step[i] ?? est);
  return {
    tel,
    // Each lap scaled to its own length so corners line up across drivers
    x: d.map((v) => (v / len) * W),
    rem,
    vMin: Math.min(...tel.speed),
    vMax: Math.max(...tel.speed),
    rpmMin: Math.min(...tel.rpm),
    rpmMax: Math.max(...tel.rpm),
  };
}

/** Sector cuts, counted back from the lap end: S1 ends S2+S3 before it, S2 ends S3 before. */
function sectorCuts(rem: number[], lap: LapEntry) {
  const [s1, s2] = [secs(lap.sector1), secs(lap.sector2)];
  const lapSecs = secs(lap.lap_time);
  const s3 = secs(lap.sector3) ?? (lapSecs != null && s1 != null && s2 != null ? lapSecs - s1 - s2 : null);
  return [
    { s: s1, before: s2 != null && s3 != null ? s2 + s3 : null },
    { s: s2, before: s3 },
  ].map(({ s, before }, k) => {
    if (s == null || before == null) return null;
    const i = rem.findIndex((v) => v <= before);
    return i > 0 ? { i, label: `S${k + 1} ${s.toFixed(3)}` } : null;
  });
}

export default function SpeedTrace({ year, round, sessionType, drivers, laps, now, useImperial }: Props) {
  // Per driver: the lap in progress is the first one whose completion time is still ahead
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return drivers.map((d) => {
      const mine = laps.filter((l) => l.driver === d.abbr).sort((a, b) => a.lap_number - b.lap_number);
      const lap = mine.find((l) => l.time != null && l.time > now) ?? mine[mine.length - 1] ?? null;
      const done = mine.filter((l) => l.time != null && l.time <= now);
      const bestSecs = done.map((l) => secs(l.lap_time)).filter((x): x is number => x != null);
      const dashed = seen.has(d.color.toLowerCase());
      seen.add(d.color.toLowerCase());
      return {
        d,
        lap,
        key: lap ? `${d.abbr}/${lap.lap_number}` : null,
        last: done.length ? done[done.length - 1].lap_time : null,
        best: bestSecs.length ? Math.min(...bestSecs) : null,
        dash: dashed ? TEAMMATE_DASH : undefined,
      };
    });
  }, [drivers, laps, now]);

  // Lap telemetry per driver/lap, dropped once no longer on screen so a long session doesn't pile up
  // Chart width in px, so corner labels can be thinned to what fits (phones)
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(1000);
  const hasDrivers = drivers.length > 0;
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setChartW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDrivers]);

  const [cache, setCache] = useState<Record<string, LapTelemetry | "error">>({});
  const requested = useRef(new Set<string>());
  const wantKey = rows.map((r) => r.key).filter(Boolean).join(",");
  useEffect(() => {
    const want = new Set(wantKey ? wantKey.split(",") : []);
    for (const k of requested.current) if (!want.has(k)) requested.current.delete(k);
    setCache((c) => Object.fromEntries(Object.entries(c).filter(([k]) => want.has(k))));
    for (const k of want) {
      if (requested.current.has(k)) continue;
      requested.current.add(k);
      const [abbr, lap] = k.split("/");
      apiFetch<LapTelemetry>(`/api/sessions/${year}/${round}/telemetry?type=${sessionType}&driver=${abbr}&lap=${lap}`)
        .catch(() => "error" as const)
        .then((v) => setCache((c) => (requested.current.has(k) ? { ...c, [k]: v } : c)));
    }
  }, [wantKey, year, round, sessionType]);

  const geos = useMemo(() => {
    const out: Record<string, ReturnType<typeof buildGeo>> = {};
    for (const [k, t] of Object.entries(cache)) if (t !== "error" && t.distance.length > 1) out[k] = buildGeo(t);
    return out;
  }, [cache]);

  const kmh = (v: number) => Math.round(useImperial ? v * 0.6214 : v);

  if (drivers.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-f1-muted">Select one or more drivers to see their speed traces</p>;
  }

  const traces = rows.flatMap((r) => {
    const geo = r.key ? geos[r.key] : undefined;
    if (!geo || !r.lap) return [];
    // Samples already driven: those at least as far from the lap end as the car is now
    const left = r.lap.time != null ? r.lap.time - now : 0;
    const shown = Math.max(1, geo.rem.filter((v) => v >= left).length);
    return [{ ...r, lap: r.lap, geo, shown, top: Math.max(...geo.tel.speed.slice(0, shown)) }];
  });

  // Shared scales so the drivers compare like for like
  const vMin = Math.min(...traces.map((t) => t.geo.vMin)) - 10;
  const vMax = Math.max(...traces.map((t) => t.geo.vMax)) + 10;
  const rpmMin = Math.min(...traces.map((t) => t.geo.rpmMin));
  const rpmMax = Math.max(...traces.map((t) => t.geo.rpmMax));
  const ySpeed = (v: number) => SPEED_TOP + (1 - (v - vMin) / (vMax - vMin || 1)) * SPEED_H;
  const norm: Record<(typeof STRIPS)[number], (tel: LapTelemetry, i: number) => number> = {
    throttle: (tel, i) => tel.throttle[i] / 100,
    brake: (tel, i) => tel.brake[i] / 100,
    gear: (tel, i) => tel.gear[i] / 8,
    rpm: (tel, i) => (tel.rpm[i] - rpmMin) / (rpmMax - rpmMin || 1),
  };
  const pts = (t: (typeof traces)[number], f: (i: number) => number) =>
    Array.from({ length: t.shown }, (_, i) => `${t.geo.x[i].toFixed(1)},${f(i).toFixed(1)}`).join(" ");

  // Corner labels and sector cuts only for the first driver: with several they'd overlap
  const lead = traces.find((t) => t.d.abbr === drivers[0].abbr);
  // Same-kind labels closer than a label's width would overlap: keep the more extreme one
  const minGap = (26 / Math.max(chartW, 1)) * W;
  const peaks: { i: number; max: boolean }[] = [];
  if (lead) {
    const v = lead.geo.tel.speed;
    for (const p of extrema(v.slice(0, lead.shown))) {
      const prev = peaks.findLast((q) => q.max === p.max);
      if (!prev || lead.geo.x[p.i] - lead.geo.x[prev.i] >= minGap) peaks.push(p);
      else if (p.max ? v[p.i] > v[prev.i] : v[p.i] < v[prev.i]) peaks[peaks.indexOf(prev)] = p;
    }
  }
  const cuts = lead ? sectorCuts(lead.geo.rem, lead.lap).filter((c): c is NonNullable<typeof c> => c != null && c.i < lead.shown) : [];
  const allFailed = rows.every((r) => !r.key || cache[r.key] === "error");

  return (
    // Phones: chart full width, stats below it; wider: stats in a side column
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:gap-3">
      <div ref={chartRef} className="relative w-full min-w-0 sm:w-auto sm:flex-1" style={{ height: H }}>
        {traces.length > 0 ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              {cuts.map((c) => (
                <line key={c.label} x1={lead!.geo.x[c.i]} x2={lead!.geo.x[c.i]} y1={10} y2={H} stroke={lead!.d.color} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              ))}
              {/* Reversed so the first-selected driver is drawn on top */}
              {[...traces].reverse().map((t) => (
                <g key={t.d.abbr} stroke={t.d.color} fill="none" strokeDasharray={t.dash}>
                  <polyline points={pts(t, (i) => ySpeed(t.geo.tel.speed[i]))} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  {STRIPS.map((k, s) => (
                    <polyline
                      key={k}
                      points={pts(t, (i) => stripTop(s) + (1 - norm[k](t.geo.tel, i)) * STRIP_H)}
                      strokeOpacity={0.75}
                      strokeWidth={1.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              ))}
            </svg>
            {STRIPS.map((k, s) => (
              <span key={k} className="absolute -left-0.5 text-[8px] font-bold text-f1-muted" style={{ top: stripTop(s) - 2 }}>
                {STRIP_LABEL[k]}
              </span>
            ))}
            {cuts.map((c) => (
              <span key={c.label} className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold text-f1-muted" style={{ left: `${lead!.geo.x[c.i] / 10}%` }}>
                {c.label}
              </span>
            ))}
            {lead && peaks.map((p) => (
              <span
                key={p.i}
                className={`absolute -translate-x-1/2 text-[10px] font-bold tabular-nums text-ink ${p.max ? "-translate-y-full" : ""}`}
                style={{ left: `${lead.geo.x[p.i] / 10}%`, top: ySpeed(lead.geo.tel.speed[p.i]) + (p.max ? -2 : 3) }}
              >
                {kmh(lead.geo.tel.speed[p.i])}
              </span>
            ))}
            {/* Where each car is now */}
            {traces.map((t) => (
              <span
                key={t.d.abbr}
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-f1-card"
                style={{ left: `${t.geo.x[t.shown - 1] / 10}%`, top: ySpeed(t.geo.tel.speed[t.shown - 1]), backgroundColor: t.d.color }}
              />
            ))}
          </>
        ) : (
          <p className="pt-10 text-center text-xs text-f1-muted">{allFailed ? "No telemetry for this lap" : "Loading lap telemetry…"}</p>
        )}
      </div>

      {rows.length === 1 ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 sm:flex sm:w-[92px] sm:shrink-0 sm:flex-col sm:text-right">
          <div className="col-span-3 flex items-center gap-1.5 sm:justify-end">
            <span className="h-3.5 w-1 rounded-sm" style={{ backgroundColor: rows[0].d.color }} />
            <span className="text-sm font-extrabold text-ink">{rows[0].d.abbr}</span>
            {rows[0].lap && <span className="text-[9px] font-bold text-f1-muted">L{rows[0].lap.lap_number}</span>}
          </div>
          {([
            ["Top speed", traces[0] ? kmh(traces[0].top) : "—"],
            ["Speed", rows[0].d.frozen || rows[0].d.speed == null ? "—" : kmh(rows[0].d.speed)],
            ["Tyre", <TyreIndicator key="t" compound={rows[0].d.compound} life={rows[0].d.tyre_life} />],
            ["Best lap", rows[0].best != null ? fmtLap(rows[0].best) : "—"],
            ["Last lap", rows[0].last ?? "—"],
          ] as const).map(([label, value]) => (
            <div key={label} className="border-t border-f1-border pt-0.5">
              <div className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">{label}</div>
              <div className="flex font-mono text-[13px] font-extrabold tabular-nums text-ink sm:justify-end">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full shrink-0 overflow-y-auto sm:w-auto" style={{ maxHeight: H }}>
          <table className="w-full font-mono text-[11px] tabular-nums text-ink sm:w-auto">
            <thead>
              <tr className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">
                <th />
                <th className="px-1 text-right font-bold">Spd</th>
                <th className="px-1 text-right font-bold">Top</th>
                <th className="pl-1 text-right font-bold">Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = traces.find((x) => x.d.abbr === r.d.abbr);
                return (
                  <tr key={r.d.abbr} className="border-t border-f1-border">
                    <td className="whitespace-nowrap py-1 pr-1">
                      <svg width="14" height="4" className="mr-1 inline-block align-middle">
                        <line x1="0" y1="2" x2="14" y2="2" stroke={r.d.color} strokeWidth="3" strokeDasharray={r.dash ? "4 2" : undefined} />
                      </svg>
                      <span className="font-sans font-extrabold">{r.d.abbr}</span>
                      {r.lap && <span className="ml-1 font-sans text-[9px] font-bold text-f1-muted">L{r.lap.lap_number}</span>}
                    </td>
                    <td className="px-1 text-right font-extrabold">{r.d.frozen || r.d.speed == null ? "—" : kmh(r.d.speed)}</td>
                    <td className="px-1 text-right">{t ? kmh(t.top) : "—"}</td>
                    <td className="pl-1 text-right">{r.last ?? "—"}</td>
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
