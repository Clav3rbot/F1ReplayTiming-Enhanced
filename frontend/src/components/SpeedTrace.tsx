"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { ReplayDriver } from "@/hooks/useReplaySocket";
import { lapDeleted, type LapEntry } from "@/components/Leaderboard";
import TyreIndicator from "@/components/TyreIndicator";
import type { LapOverlay } from "@/lib/trackRenderer";

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
  /** "best": each driver's fastest lap completed so far; "current": the lap in progress, drawn as it's driven. */
  mode: "best" | "current";
  useImperial?: boolean;
  /** Corners along the lap (0–1), marked on the distance axis. */
  corners?: { frac: number; label: string }[];
  /** Where S1 and S2 end along the lap (0–1), to pin the lap clock to the official sector times. */
  sectorFracs?: [number, number];
  /** Track dominance on the map: parts of the lap in the faster driver's colour. */
  onMapOverlay?: (o: LapOverlay | null) => void;
  /** Live timing: traces recorded by the live session (/api/live/...). */
  live?: boolean;
}

const W = 1000; // SVG x units
// Left gutter (px) for each chart's y-axis values
const GUTTER = 30;
// Speed chart height (px), with room above and below the line for the max/min speed labels
const SPEED_H = 150;
const SPEED_PAD_T = 18;
const SPEED_PAD_B = 16;
const CHANNELS = ["throttle", "brake", "gear", "rpm"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_LABEL: Record<Channel, string> = { throttle: "Throttle", brake: "Brake", gear: "Gear", rpm: "RPM" };
const CHANNEL_H: Record<Channel, number> = { throttle: 46, brake: 18, gear: 46, rpm: 46 };
const CHANNEL_PAD = 4;
const DEFAULT_CHANNELS: Channel[] = ["throttle", "brake"];
const CHANNELS_KEY = "f1replay_trace_channels";
// A speed swing this large (km/h) confirms a corner minimum or a straight-line maximum
const EXTREMUM_SWING = 12;
// Teammates share a team colour: the later-selected one is drawn dashed, as on the F1 graphics
const TEAMMATE_DASH = "6 4";
// The map can't dash a line, so a teammate's track dominance takes this colour instead
const TEAMMATE_MAP_COLOR = "#06B6D4";
// Track dominance: equal parts of the lap, each won by the driver who took less time over it
const DOMINANCE_PARTS = 25;
// Gap chart height (px), between the readout and the speed chart
const GAP_H = 56;

function secs(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = t.split(":");
  const v = p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : Number(p[0]);
  return Number.isFinite(v) ? v : null;
}

const fmtLap = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;

/** Index of the sample nearest to x (xs ascending). */
function nearest(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid;
    else hi = mid;
  }
  return x - xs[lo] <= xs[hi] - x ? lo : hi;
}

/** Linear interpolation of ys over ascending xs. */
function lerpAt(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  const i = nearest(xs, x);
  const lo = xs[i] <= x ? i : i - 1;
  return ys[lo] + ((ys[lo + 1] - ys[lo]) * (x - xs[lo])) / (xs[lo + 1] - xs[lo] || 1);
}

/**
 * Seconds into the lap at each sample: distance over speed integrated forward, then stretched
 * piecewise so the official times hold at the sector lines and the finish. Samples are placed by
 * fraction of the lap's measured length, as the cars' distances differ by tens of metres.
 * Checked on every stored 2026 qualifying (neighbouring top-10 best laps): with the lap time
 * alone the gap at the sector lines was off by 0.04 s (median) and right about who led 90% of
 * the time; anchoring S1 too took that to 0.03 s and 95%.
 */
function lapClock(tel: LapTelemetry, lap: LapEntry, sectorFracs?: [number, number]): { f: number[]; t: number[] } | null {
  const d = tel.distance;
  const lapSecs = secs(lap.lap_time);
  if (lapSecs == null || d.length < 2) return null;
  const len = d[d.length - 1] || 1;
  const f = d.map((x) => x / len);
  const raw = [0];
  for (let i = 1; i < d.length; i++) {
    raw.push(raw[i - 1] + Math.max(0, d[i] - d[i - 1]) / Math.max(1, (tel.speed[i] + tel.speed[i - 1]) / 2 / 3.6));
  }
  const s1 = secs(lap.sector1);
  const s2 = secs(lap.sector2);
  // (lap fraction, official seconds) pins, joined by the integrated time in between
  const pins: [number, number][] = sectorFracs && s1 != null && s2 != null
    ? [[0, 0], [sectorFracs[0], s1], [sectorFracs[1], s1 + s2], [1, lapSecs]]
    : [[0, 0], [1, lapSecs]];
  const at = pins.map(([q]) => lerpAt(f, raw, q));
  let k = 0;
  const t = raw.map((x, i) => {
    while (k < pins.length - 2 && f[i] > pins[k + 1][0]) k++;
    return pins[k][1] + ((x - at[k]) * (pins[k + 1][1] - pins[k][1])) / (at[k + 1] - at[k] || 1);
  });
  return { f, t };
}

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

export default function SpeedTrace({ year, round, sessionType, drivers, laps, now, mode, useImperial, corners, sectorFracs, onMapOverlay, live }: Props) {
  const [dominance, setDominance] = useState(false);
  // Point on the lap (0–1) under the pointer, read out for every driver
  const [hover, setHover] = useState<number | null>(null);
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHANNELS_KEY) ?? "null");
      if (Array.isArray(saved)) return CHANNELS.filter((c) => saved.includes(c));
    } catch {}
    return DEFAULT_CHANNELS;
  });
  const toggleChannel = (c: Channel) =>
    setChannels((cur) => {
      const next = CHANNELS.filter((k) => (k === c ? !cur.includes(k) : cur.includes(k)));
      try { localStorage.setItem(CHANNELS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

  // Per driver: the lap in progress is the first one whose completion time is still ahead
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return drivers.map((d) => {
      const mine = laps.filter((l) => l.driver === d.abbr).sort((a, b) => a.lap_number - b.lap_number);
      const done = mine.filter((l) => l.time != null && l.time <= now);
      const valid = done.filter((l) => !lapDeleted(l, now));
      // Best so far only, so a replay never shows a lap that hasn't been driven yet
      const fastest = valid.reduce<LapEntry | null>((b, l) => {
        const s = secs(l.lap_time);
        return s != null && (b == null || s < secs(b.lap_time)!) ? l : b;
      }, null);
      const lap = mode === "best" ? fastest : mine.find((l) => l.time != null && l.time > now) ?? mine[mine.length - 1] ?? null;
      const bestSecs = valid.map((l) => secs(l.lap_time)).filter((x): x is number => x != null);
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
  }, [drivers, laps, now, mode]);

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
    // The chart div is remounted when the mode moves it in the layout
  }, [hasDrivers, mode]);

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
      // Live: a lap's trace is cut a couple of seconds after the lap ends, so retry a few times
      const load = (attempt: number) =>
        apiFetch<LapTelemetry>(`/api/${live ? "live" : "sessions"}/${year}/${round}/telemetry?type=${sessionType}&driver=${abbr}&lap=${lap}`)
          .catch(() => "error" as const)
          .then((v) => {
            if (v === "error" && live && attempt < 5 && requested.current.has(k)) {
              setTimeout(() => load(attempt + 1), 3000);
              return;
            }
            setCache((c) => (requested.current.has(k) ? { ...c, [k]: v } : c));
          });
      load(0);
    }
  }, [wantKey, year, round, sessionType, live]);

  const geos = useMemo(() => {
    const out: Record<string, ReturnType<typeof buildGeo>> = {};
    for (const [k, t] of Object.entries(cache)) if (t !== "error" && t.distance.length > 1) out[k] = buildGeo(t);
    return out;
  }, [cache]);

  const kmh = (v: number) => Math.round(useImperial ? v * 0.6214 : v);

  // Two best laps on one clock each: the gap along the lap and track dominance come from these
  const clocks = useMemo(() => {
    if (mode !== "best" || rows.length !== 2) return null;
    const out = rows.map((r) => {
      const g = r.key ? geos[r.key] : undefined;
      return g && r.lap ? lapClock(g.tel, r.lap, sectorFracs) : null;
    });
    return out[0] && out[1] ? (out as [NonNullable<(typeof out)[0]>, NonNullable<(typeof out)[0]>]) : null;
  }, [mode, rows, geos, sectorFracs]);

  const dominanceParts = useMemo(() => {
    if (!dominance || !clocks) return null;
    const [a, b] = clocks;
    const colors = [rows[0].d.color, rows[1].d.color.toLowerCase() === rows[0].d.color.toLowerCase() ? TEAMMATE_MAP_COLOR : rows[1].d.color];
    const won = [0, 0];
    const parts: { from: number; to: number; color: string }[] = [];
    for (let i = 0; i < DOMINANCE_PARTS; i++) {
      const f0 = i / DOMINANCE_PARTS;
      const f1 = (i + 1) / DOMINANCE_PARTS;
      const who = lerpAt(a.f, a.t, f1) - lerpAt(a.f, a.t, f0) <= lerpAt(b.f, b.t, f1) - lerpAt(b.f, b.t, f0) ? 0 : 1;
      won[who]++;
      parts.push({ from: f0, to: f1, color: colors[who] });
    }
    return { parts, won, colors };
  }, [dominance, clocks, rows]);
  const overlayRef = useRef(onMapOverlay);
  overlayRef.current = onMapOverlay;
  const dominanceKey = dominanceParts ? JSON.stringify(dominanceParts.parts) : "";
  useEffect(() => {
    overlayRef.current?.(dominanceKey ? { stretches: JSON.parse(dominanceKey) } : null);
  }, [dominanceKey]);
  useEffect(() => () => overlayRef.current?.(null), []);

  if (drivers.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-f1-muted">Select a driver to see their speed trace</p>;
  }

  const traces = rows.flatMap((r) => {
    const geo = r.key ? geos[r.key] : undefined;
    if (!geo || !r.lap) return [];
    // Samples already driven: those at least as far from the lap end as the car is now
    const left = mode === "current" && r.lap.time != null ? r.lap.time - now : 0;
    const shown = Math.max(1, geo.rem.filter((v) => v >= left).length);
    return [{ ...r, lap: r.lap, geo, shown, top: Math.max(...geo.tel.speed.slice(0, shown)) }];
  });

  // Shared scales so the drivers compare like for like
  const sMin = Math.min(...traces.map((t) => t.geo.vMin));
  const sMax = Math.max(...traces.map((t) => t.geo.vMax));
  const rpmMin = Math.min(...traces.map((t) => t.geo.rpmMin));
  const rpmMax = Math.max(...traces.map((t) => t.geo.rpmMax));
  const ySpeed = (v: number) => SPEED_PAD_T + (1 - (v - sMin) / (sMax - sMin || 1)) * (SPEED_H - SPEED_PAD_T - SPEED_PAD_B);
  const norm: Record<Channel, (tel: LapTelemetry, i: number) => number> = {
    throttle: (tel, i) => tel.throttle[i] / 100,
    brake: (tel, i) => tel.brake[i] / 100,
    gear: (tel, i) => Math.max(0, tel.gear[i] - 1) / 7,
    rpm: (tel, i) => (tel.rpm[i] - rpmMin) / (rpmMax - rpmMin || 1),
  };
  const yChannel = (k: Channel, n: number) => CHANNEL_PAD + (1 - n) * (CHANNEL_H[k] - 2 * CHANNEL_PAD);
  // Brake is on/off: no scale needed
  const channelTicks: Record<Channel, string[]> = {
    throttle: ["100%", "0%"],
    brake: [],
    gear: ["8", "1"],
    rpm: [`${Math.round(rpmMax / 1000)}k`, `${Math.round(rpmMin / 1000)}k`],
  };
  const pts = (t: (typeof traces)[number], f: (i: number) => number) =>
    Array.from({ length: t.shown }, (_, i) => `${t.geo.x[i].toFixed(1)},${f(i).toFixed(1)}`).join(" ");
  // Gap along the two best laps: the first driver's clock minus the second's at the same point
  const gap = clocks && traces.length === 2
    ? clocks[0].f.map((f, i) => clocks[0].t[i] - lerpAt(clocks[1].f, clocks[1].t, f))
    : null;
  const gMax = gap ? Math.max(0.05, ...gap.map(Math.abs)) : 1;
  const yGap = (g: number) => CHANNEL_PAD + ((1 - g / gMax) / 2) * (GAP_H - 2 * CHANNEL_PAD);

  // Speed labels and sector cuts only for the first driver: with several they'd overlap
  const lead = traces.find((t) => t.d.abbr === drivers[0].abbr);
  const plotW = Math.max(chartW - GUTTER, 1);
  // Same-kind labels closer than a label's width would overlap: keep the more extreme one
  const minGap = (26 / plotW) * W;
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
  // Corner numbers that fit side by side on the axis
  const cornerLabels: { frac: number; label: string }[] = [];
  for (const c of corners ?? []) {
    const prev = cornerLabels[cornerLabels.length - 1];
    if (!prev || (c.frac - prev.frac) * plotW >= 18) cornerLabels.push(c);
  }
  const allFailed = rows.every((r) => !r.key || cache[r.key] === "error");
  const noLap = rows.every((r) => !r.lap);

  // Each driver's sample at the hovered point; none past what's been driven (current lap)
  const hoverAt = new Map<string, number>();
  if (hover != null) {
    for (const t of traces) {
      const i = nearest(t.geo.x, hover * W);
      if (i < t.shown) hoverAt.set(t.d.abbr, i);
    }
  }
  const hoverLeadI = lead ? hoverAt.get(lead.d.abbr) : undefined;
  const trackPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(1, Math.max(0, (e.clientX - r.left - GUTTER) / Math.max(r.width - GUTTER, 1))));
  };

  const readout = (
    <div className="rounded border border-f1-border px-2 py-1.5">
      <table className="w-full font-mono text-[10px] tabular-nums text-ink">
        <thead>
          <tr className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">
            <th className="text-left font-bold">
              {lead && hoverLeadI != null
                ? `At ${Math.round(lead.geo.tel.distance[hoverLeadI])} m${
                    gap && lead === traces[0] ? ` · gap ${gap[hoverLeadI] >= 0 ? "+" : "−"}${Math.abs(gap[hoverLeadI]).toFixed(2)}s` : ""
                  }`
                : "Point on lap"}
            </th>
            <th className="px-1 text-right font-bold">Speed</th>
            <th className="px-1 text-right font-bold">Gear</th>
            <th className="px-1 text-right font-bold">Throttle</th>
            <th className="pl-1 text-right font-bold">Brake</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t) => {
            const i = hoverAt.get(t.d.abbr);
            const tel = t.geo.tel;
            return (
              <tr key={t.d.abbr}>
                <td className="whitespace-nowrap py-0.5 pr-1">
                  <svg width="12" height="4" className="mr-1 inline-block align-middle">
                    <line x1="0" y1="2" x2="12" y2="2" stroke={t.d.color} strokeWidth="3" strokeDasharray={t.dash ? "4 2" : undefined} />
                  </svg>
                  <span className="font-sans font-extrabold">{t.d.abbr}</span>
                </td>
                <td className="px-1 text-right font-bold">{i == null ? "—" : kmh(tel.speed[i])}</td>
                <td className="px-1 text-right">{i == null ? "—" : tel.gear[i]}</td>
                <td className="px-1 text-right">{i == null ? "—" : `${Math.round(tel.throttle[i])}%`}</td>
                <td className="pl-1 text-right">{i == null ? "—" : tel.brake[i] > 0 ? "On" : "Off"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Kept in the layout while hovering, so the charts below don't jump */}
      <p className={`mt-0.5 text-[9px] text-f1-muted ${hover != null ? "invisible" : ""}`}>
        Hover, tap or drag along the charts to compare at that point
      </p>
    </div>
  );

  const lines = (f: (t: (typeof traces)[number], i: number) => number, width: number) =>
    // Reversed so the first-selected driver is drawn on top
    [...traces].reverse().map((t) => (
      <polyline
        key={t.d.abbr}
        points={pts(t, (i) => f(t, i))}
        fill="none"
        stroke={t.d.color}
        strokeDasharray={t.dash}
        strokeWidth={width}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    ));

  // One chart: title, y-axis values in the gutter, faint grid, corner and sector guides
  const panel = (title: ReactNode, h: number, ticks: { y: number; label: string | number }[], content: ReactNode, overlay?: ReactNode) => (
    <div>
      {/* Title starts after the gutter, so the top y-axis value never runs into it */}
      <div className="relative mb-1.5 h-3" style={{ marginLeft: GUTTER }}>
        <span className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">{title}</span>
      </div>
      <div className="relative" style={{ height: h, marginLeft: GUTTER }}>
        {ticks.map((t, i) => (
          <span key={i} className="absolute right-full mr-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[8px] tabular-nums text-f1-muted" style={{ top: t.y }}>
            {t.label}
          </span>
        ))}
        <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible text-f1-muted">
          {ticks.map((t, i) => (
            <line key={i} x1={0} x2={W} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.18} vectorEffect="non-scaling-stroke" />
          ))}
          {corners?.map((c) => (
            <line key={c.label} x1={c.frac * W} x2={c.frac * W} y1={0} y2={h} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />
          ))}
          {cuts.map((c) => (
            <line key={c.label} x1={lead!.geo.x[c.i]} x2={lead!.geo.x[c.i]} y1={0} y2={h} stroke={lead!.d.color} strokeOpacity={0.45} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          ))}
          {content}
          {hover != null && (
            <line x1={hover * W} x2={hover * W} y1={0} y2={h} className="text-ink" stroke="currentColor" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {overlay}
      </div>
    </div>
  );

  const chart = (
    <div ref={chartRef} className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {CHANNELS.map((c) => (
          <button
            key={c}
            onClick={() => toggleChannel(c)}
            className={`rounded border px-2 py-0.5 text-[9px] font-bold transition-colors ${
              channels.includes(c) ? "border-ink/20 bg-ink/10 text-ink" : "border-f1-border text-f1-muted hover:text-ink"
            }`}
          >
            {CHANNEL_LABEL[c]}
          </button>
        ))}
        {mode === "best" && rows.length === 2 && (
          <button
            onClick={() => setDominance(!dominance)}
            className={`ml-auto rounded px-2 py-0.5 text-[9px] font-bold transition-colors ${
              dominance ? "bg-f1-red text-white" : "border border-f1-border text-f1-muted hover:text-ink"
            }`}
          >
            Track dominance
          </button>
        )}
      </div>
      {dominanceParts && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-f1-border px-2 py-1 text-[9px]">
          <span className="text-f1-muted">Map: faster driver in each of {DOMINANCE_PARTS} parts of the lap</span>
          {rows.map((r, k) => (
            <span key={r.d.abbr} className="flex items-center gap-1 whitespace-nowrap">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: dominanceParts.colors[k] }} />
              <span className="font-bold text-ink">{r.d.abbr}</span>
              <span className="font-mono text-f1-muted">{dominanceParts.won[k]}</span>
            </span>
          ))}
        </div>
      )}
      {traces.length > 0 ? (
        <>
          {readout}
          {/* pan-y: a sideways drag reads the charts, an up/down one still scrolls the page */}
          <div
            className="flex flex-col gap-1.5"
            style={{ touchAction: "pan-y" }}
            onPointerDown={trackPointer}
            onPointerMove={trackPointer}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          >
            {gap && clocks && panel(
              <>
                Gap{" "}
                <span className="normal-case tracking-normal">
                  (approx.; above 0 {rows[0].d.abbr} is behind {rows[1].d.abbr})
                </span>
              </>,
              GAP_H,
              [
                { y: yGap(gMax), label: `+${gMax.toFixed(2)}` },
                { y: yGap(0), label: "0" },
                { y: yGap(-gMax), label: `−${gMax.toFixed(2)}` },
              ],
              <polyline
                points={clocks[0].f.map((f, i) => `${(f * W).toFixed(1)},${yGap(gap[i]).toFixed(1)}`).join(" ")}
                fill="none"
                stroke="currentColor"
                className="text-ink"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />,
            )}
            {panel(
              <>
                Speed <span className="normal-case tracking-normal">({useImperial ? "mph" : "km/h"})</span>
              </>,
              SPEED_H,
              [sMax, (sMax + sMin) / 2, sMin].map((v) => ({ y: ySpeed(v), label: kmh(v) })),
              lines((t, i) => ySpeed(t.geo.tel.speed[i]), 1.75),
              <>
                {cuts.map((c) => (
                  <span key={c.label} className="absolute -top-3.5 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold text-f1-muted" style={{ left: `${lead!.geo.x[c.i] / 10}%` }}>
                    {c.label}
                  </span>
                ))}
                {lead && peaks.map((p) => (
                  <span
                    key={p.i}
                    // Card-coloured backing so the value stays readable where it crosses a line
                    className={`absolute -translate-x-1/2 rounded-sm bg-f1-card/90 px-0.5 text-[9px] font-semibold leading-none tabular-nums text-ink ${p.max ? "-translate-y-full" : ""}`}
                    style={{ left: `${lead.geo.x[p.i] / 10}%`, top: ySpeed(lead.geo.tel.speed[p.i]) + (p.max ? -2 : 3) }}
                  >
                    {kmh(lead.geo.tel.speed[p.i])}
                  </span>
                ))}
                {/* Where each car is now */}
                {mode === "current" && traces.map((t) => (
                  <span
                    key={t.d.abbr}
                    className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-f1-card"
                    style={{ left: `${t.geo.x[t.shown - 1] / 10}%`, top: ySpeed(t.geo.tel.speed[t.shown - 1]), backgroundColor: t.d.color }}
                  />
                ))}
                {/* Each driver at the hovered point */}
                {traces.map((t) => {
                  const i = hoverAt.get(t.d.abbr);
                  return i == null ? null : (
                    <span
                      key={`hover-${t.d.abbr}`}
                      className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-f1-card"
                      style={{ left: `${t.geo.x[i] / 10}%`, top: ySpeed(t.geo.tel.speed[i]), backgroundColor: t.d.color }}
                    />
                  );
                })}
              </>,
            )}
            {channels.map((k) => (
              <div key={k}>
                {panel(
                  CHANNEL_LABEL[k],
                  CHANNEL_H[k],
                  channelTicks[k].map((label, i) => ({ y: yChannel(k, i === 0 ? 1 : 0), label })),
                  lines((t, i) => yChannel(k, norm[k](t.geo.tel, i)), 1.25),
                )}
              </div>
            ))}
            {cornerLabels.length > 0 && (
              <div className="relative h-3" style={{ marginLeft: GUTTER }}>
                {cornerLabels.map((c) => (
                  <span key={c.label} className="absolute top-0 -translate-x-1/2 text-[8px] font-bold text-f1-muted" style={{ left: `${c.frac * 100}%` }}>
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-xs text-f1-muted">
          {noLap ? "No completed lap yet" : allFailed ? "No telemetry for this lap" : "Loading lap telemetry…"}
        </p>
      )}
    </div>
  );

  if (mode === "best") {
    const parts = [["S1", "sector1"], ["S2", "sector2"], ["S3", "sector3"], ["Lap", "lap_time"]] as const;
    return (
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
        <table className="w-full font-mono text-[11px] tabular-nums text-ink">
          <thead>
            <tr className="text-[8px] font-bold uppercase tracking-wider text-f1-muted">
              <th />
              {rows.map((r) => (
                <th key={r.d.abbr} className="whitespace-nowrap px-1 text-right font-bold">
                  <svg width="14" height="4" className="mr-1 inline-block align-middle">
                    <line x1="0" y1="2" x2="14" y2="2" stroke={r.d.color} strokeWidth="3" strokeDasharray={r.dash ? "4 2" : undefined} />
                  </svg>
                  <span className="font-sans text-[10px] font-extrabold text-ink">{r.d.abbr}</span>
                  {r.lap && <span className="ml-1 font-sans normal-case">L{r.lap.lap_number}</span>}
                </th>
              ))}
              {rows.length === 2 && <th className="pl-1 text-right font-bold">Delta</th>}
            </tr>
          </thead>
          <tbody>
            {parts.map(([label, key]) => {
              const v = rows.map((r) => secs(r.lap?.[key]));
              const both = v.length === 2 && v[0] != null && v[1] != null;
              // First driver's minus second's, as in the lap list: negative = first driver faster
              const delta = both ? v[0]! - v[1]! : null;
              return (
                <tr key={key} className="border-t border-f1-border">
                  <td className="py-1 pr-1 font-sans text-[9px] font-bold text-f1-muted">{label}</td>
                  {v.map((s, j) => (
                    <td key={j} className={`px-1 text-right ${both && s === Math.min(v[0]!, v[1]!) ? "font-extrabold" : ""}`}>
                      {s == null ? "—" : key === "lap_time" ? fmtLap(s) : s.toFixed(3)}
                    </td>
                  ))}
                  {rows.length === 2 && (
                    <td className={`pl-1 text-right font-bold ${delta == null || Math.abs(delta) < 0.0005 ? "text-f1-muted" : delta < 0 ? "text-green-400" : "text-red-400"}`}>
                      {delta == null ? "—" : `${delta >= 0.0005 ? "+" : delta <= -0.0005 ? "-" : ""}${Math.abs(delta).toFixed(3)}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {chart}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
      {chart}
      {rows.length === 1 ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          <div className="col-span-3 flex items-center gap-1.5">
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
              <div className="flex font-mono text-[13px] font-extrabold tabular-nums text-ink">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full font-mono text-[11px] tabular-nums text-ink">
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
      )}
    </div>
  );
}
