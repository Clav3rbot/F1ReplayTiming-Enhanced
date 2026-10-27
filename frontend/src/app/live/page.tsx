"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useSettings } from "@/hooks/useSettings";
import { apiFetch } from "@/lib/api";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import Leaderboard from "@/components/Leaderboard";
import PiPWindow from "@/components/PiPWindow";
import RadioCaption from "@/components/RadioCaption";
import LapAnalysisPanel from "@/components/LapAnalysisPanel";
import LapNotifications from "@/components/LapNotifications";
import TelemetryChart from "@/components/TelemetryChart";
import { qualiOrder, type LapData } from "@/lib/lapTiming";
import { MINI_HEX, miniMarkersWidth } from "@/lib/miniSectors";
import { outlineFractions, cornerFractions, partsOverlay, DEFAULT_SECTOR } from "@/lib/outline";
import type { LapOverlay, SectorOverlay } from "@/lib/trackRenderer";
import { Maximize, Minimize, ArrowUpRight } from "lucide-react";

interface TrackData {
  track_points: { x: number; y: number; z?: number }[];
  rotation: number;
  circuit_name: string;
  sector_boundaries?: { s1_end: number; s2_end: number; total: number } | null;
  corners?: { x: number; y: number; number: number; letter: string; angle: number }[] | null;
  elevation?: { range_m: number } | null;
  marshal_sectors?: { x: number; y: number; number: number }[] | null;
}

const SECTOR_HEX: Record<string, string> = { purple: "#A855F7", green: "#22C55E", yellow: "#EAB308" };

interface SessionData {
  year: number;
  round_number: number;
  event_name: string;
  circuit: string;
  country: string;
  session_type: string;
  drivers: Array<{
    abbreviation: string;
    driver_number: string;
    full_name: string;
    team_name: string;
    team_color: string;
  }>;
}

const DELAY_MIN = -300;
const DELAY_MAX = 10;
const DELAY_TICK_PERCENT = (-DELAY_MIN / (DELAY_MAX - DELAY_MIN)) * 100;

function clampDelay(value: number): number {
  return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.round(value * 2) / 2));
}

function formatDelayValue(s: number): string {
  if (Math.abs(s) < 60) return s.toFixed(1);
  const sign = s < 0 ? "−" : "+";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.round(abs % 60);
  return `${sign}${m}:${String(sec).padStart(2, "0")}`;
}

function formatDelayUnit(s: number): string {
  return Math.abs(s) < 60 ? "seconds" : "min:sec";
}

function formatDelayShort(s: number): string {
  if (s === 0) return "0s";
  if (Math.abs(s) < 60) return `${s > 0 ? "+" : ""}${s}s`;
  const sign = s < 0 ? "−" : "+";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.round(abs % 60);
  return sec === 0 ? `${sign}${m}m` : `${sign}${m}:${String(sec).padStart(2, "0")}`;
}

function LivePageInner() {
  const searchParams = useSearchParams();
  const year = Number(searchParams.get("year") || "0");
  const round = Number(searchParams.get("round") || "0");
  const sessionType = searchParams.get("type") || "R";
  const speed = Number(searchParams.get("speed") || "10");
  const devMode = searchParams.get("dev") === "1";

  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTrackOpen, setMobileTrackOpen] = useState(true);
  const [mobileLeaderboardOpen, setMobileLeaderboardOpen] = useState(true);
  const [mobileRcOpen, setMobileRcOpen] = useState(true);
  const [leaderboardScale, setLeaderboardScale] = useState(1);
  const [delayOffset, setDelayOffset] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = localStorage.getItem("f1live_delay");
      return saved ? Number(saved) : 0;
    } catch { return 0; }
  });
  const [showDelaySlider, setShowDelaySlider] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipTrackOpen, setPipTrackOpen] = useState(true);
  const [pipRcOpen, setPipRcOpen] = useState(true);
  const [pipLeaderboardOpen, setPipLeaderboardOpen] = useState(true);
  const [rcPanelOpen, setRcPanelOpen] = useState(false);
  const [rcPanelSize, setRcPanelSize] = useState<"sm" | "md" | "lg">("md");
  const [rcPosition, setRcPosition] = useState<{ x: number; y: number } | null>(null);
  const rcDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const rcPanelRef = useRef<HTMLDivElement>(null);
  const [lapAnalysisOpen, setLapAnalysisOpen] = useState(false);
  const [mobileLapAnalysisOpen, setMobileLapAnalysisOpen] = useState(false);
  // A lap's sectors or the track dominance, from Lap Analysis
  const [lapOverlay, setLapOverlay] = useState<LapOverlay | null>(null);
  const [showSectorOverlay, setShowSectorOverlay] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(true);

  useEffect(() => {
    try { localStorage.setItem("f1live_delay", String(delayOffset)); } catch {}
  }, [delayOffset]);

  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Prevent screen from sleeping while the live page is open
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try { lock = await navigator.wakeLock.request("screen"); } catch { /* not available */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") request(); };
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  const onRcDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const panel = rcPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    rcDragRef.current = { startX: clientX, startY: clientY, origX: rect.left, origY: rect.top };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault();
      if (!rcDragRef.current) return;
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - rcDragRef.current.startX;
      const dy = cy - rcDragRef.current.startY;
      setRcPosition({ x: rcDragRef.current.origX + dx, y: rcDragRef.current.origY + dy });
    };
    const onUp = () => {
      rcDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }, []);

  function handleDriverClick(abbr: string) {
    setSelectedDrivers((prev) => {
      if (prev.includes(abbr)) {
        return prev.filter((d) => d !== abbr);
      }
      if (prev.length >= 2) {
        return [prev[1], abbr];
      }
      return [...prev, abbr];
    });
  }

  const { settings, update: updateSetting } = useSettings();

  const { data: sessionData, loading: sessionLoading, error: sessionError } = useApi<SessionData>(
    `/api/sessions/${year}/${round}?type=${sessionType}`,
  );

  // A weekend nobody has processed yet has no outline until the backend draws
  // one from an earlier season (~1 min); keep asking until it is there.
  const { data: trackData, loading: trackLoading, error: trackError } = useApi<TrackData>(
    `/api/sessions/${year}/${round}/track?type=${sessionType}`,
    30_000,
  );

  const live = useLiveSocket(year, round, sessionType, speed, delayOffset);

  const outlineFrac = useMemo(() => outlineFractions(trackData?.track_points), [trackData]);
  const traceCorners = useMemo(
    () => cornerFractions(trackData?.track_points, trackData?.corners, outlineFrac),
    [trackData, outlineFrac],
  );
  // driver -> lap number -> { lap time, frame time it was completed at }, from the laps recorded live
  const lapData = useMemo<LapData | undefined>(() => {
    if (!live.laps) return undefined;
    const map: LapData = new Map();
    for (const lap of live.laps) {
      if (!lap.lap_time) continue;
      const laps = map.get(lap.driver) ?? new Map();
      laps.set(lap.lap_number, { time: lap.lap_time, completedAt: lap.time ?? null });
      map.set(lap.driver, laps);
    }
    return map;
  }, [live.laps]);

  const sessionTypeUpper = sessionType.toUpperCase();
  const isRace = sessionTypeUpper === "R" || sessionTypeUpper === "S";
  const isQualifying = sessionTypeUpper === "Q" || sessionTypeUpper === "SQ";

  // RC sound notification
  const lastRcCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const msgs = live.rcMessages || [];
    if (msgs.length > lastRcCountRef.current && lastRcCountRef.current > 0 && settings.rcSound) {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.stop(ctx.currentTime + 0.15);
      } catch {}
    }
    lastRcCountRef.current = msgs.length;
  }, [live.rcMessages?.length, settings.rcSound]);

  // Show loading only while the WebSocket is connecting
  if (live.loading) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin mb-6" />
          <p className="text-f1-muted text-lg">Connecting to live timing...</p>
        </div>
      </div>
    );
  }

  if (live.error) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-bold mb-2">Live Timing Unavailable</p>
          <p className="text-f1-muted mb-6 text-sm">{live.error}</p>
          <a href="/" className="inline-block px-4 py-2 bg-f1-red text-white font-bold text-sm rounded hover:bg-red-700 transition-colors">
            Back to session picker
          </a>
        </div>
      </div>
    );
  }

  // Session ended - no longer block the view; show inline banner instead

  const trackPoints = trackData?.track_points || [];
  const rotation = trackData?.rotation || 0;
  const driversRaw = live.frame?.drivers || [];
  const drivers = isQualifying ? qualiOrder(driversRaw.filter((d) => !d.retired)) : driversRaw;
  const trackStatus = live.frame?.status || "green";
  const weather = live.frame?.weather;
  const now = live.frame?.timestamp || 0;
  // Real positions and telemetry: the server is signed in to F1 TV
  const signedIn = live.frame?.signed_in === true;
  // Cars on track: no position yet, or parked in the garage, isn't shown
  const mapDrivers = drivers
    .filter((d) => !d.retired && !d.no_timing && d.on_track !== false && (d.x !== 0 || d.y !== 0))
    .map((d) => ({ abbr: d.abbr, x: d.x, y: d.y, color: d.color, position: d.position }));

  // Mini-sectors (practice and qualifying): leaderboard bars, Show Sectors and OUT
  const miniCounts = !isRace ? live.frame?.mini_counts : undefined;
  const miniSectors = miniCounts && settings.miniSectors
    ? { counts: miniCounts, states: new Map(drivers.map((d) => [d.abbr, d.mini_sectors ?? null])) }
    : null;
  // F1 colours the pit lane's mini-sectors (2064) until the lap ends: out of the pits, on an out-lap
  const outLap = new Set(!isRace ? drivers.filter((d) => !d.in_pit && d.mini_sectors?.includes(2064)).map((d) => d.abbr) : []);
  // mini_ends are fractions of the outline's points: as distance along the lap, like the replay's
  const nPts = outlineFrac.length;
  const miniEnds = live.frame?.mini_ends && nPts > 1
    ? live.frame.mini_ends.map((f) => (f >= 0.999 ? 1 : outlineFrac[Math.min(nPts - 1, Math.round(f * nPts))]))
    : null;

  // Show Sectors follows the first selected driver, else the leader
  const sectorTarget = selectedDrivers[0] ?? drivers[0]?.abbr ?? null;
  const sectorOverlay: SectorOverlay | null = (() => {
    if (lapOverlay?.sectors && trackData?.sector_boundaries) {
      return { boundaries: trackData.sector_boundaries, colors: lapOverlay.sectors };
    }
    if (lapOverlay?.stretches) return partsOverlay(outlineFrac, trackData?.sector_boundaries, lapOverlay.stretches);
    if (isRace || !showSectorOverlay || !trackData?.sector_boundaries || !sectorTarget) return null;
    const states = miniSectors?.states.get(sectorTarget);
    if (miniEnds && states && miniEnds.length === states.length) {
      return partsOverlay(outlineFrac, trackData.sector_boundaries, miniEnds.map((end, k) => ({
        from: k ? miniEnds[k - 1] : 0,
        to: end,
        color: MINI_HEX[states[k]] ?? DEFAULT_SECTOR,
      })));
    }
    const sectors = drivers.find((d) => d.abbr === sectorTarget)?.sectors;
    const colorOf = (n: number) => SECTOR_HEX[sectors?.find((x) => x.num === n)?.color ?? ""] ?? DEFAULT_SECTOR;
    return { boundaries: trackData.sector_boundaries, colors: { s1: colorOf(1), s2: colorOf(2), s3: colorOf(3) } };
  })();

  const hasLapAnalysis = !!live.laps?.length;
  const lapAnalysisPanel = (onClose?: () => void) => (
    <LapAnalysisPanel
      laps={live.laps ?? []}
      drivers={drivers}
      currentLap={live.frame?.lap || 0}
      year={year}
      round={round}
      sessionType={sessionType}
      now={now}
      isRace={isRace}
      useImperial={settings.useImperial}
      corners={traceCorners}
      sectorFracs={
        trackData?.sector_boundaries && nPts > 1
          ? [outlineFrac[trackData.sector_boundaries.s1_end], outlineFrac[trackData.sector_boundaries.s2_end]]
          : undefined
      }
      phases={[]}
      live
      onMapOverlay={setLapOverlay}
      onClose={onClose}
    />
  );

  // Session hasn't started yet (connected but no driver data)
  const waitingForSession = live.ready && drivers.length === 0;

  // Calculate leaderboard width — must stay in sync with replay's
  // leaderboardWidthFull, or the right-hand columns get clipped
  const leaderboardWidth = (() => {
    let w = 106;
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18;
    if (isRace && settings.showGridChange) w += 24;
    if (!isRace && settings.showBestLapTime) w += 60; // best lap time column
    if (settings.showLastLapTime) w += 60; // last lap time column
    if (settings.showGapToLeader) w += 56;
    if (isQualifying && settings.showSectors) w += miniSectors ? miniMarkersWidth(miniSectors.counts) + 8 : 36;
    if (isRace && settings.showPitStops) w += 24;
    if (isRace && settings.showTyreHistory) w += 36;
    if (settings.showTyreType) w += 24;
    if (settings.showTyreAge) w += 20;
    if (isRace && settings.showPitPrediction) w += 40;
    if (isRace && settings.showPitPrediction && settings.showPitFreeAir) w += 36;
    return w;
  })();

  return (
    <div className="h-dvh flex flex-col bg-f1-dark overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Banner */}
      {!fullscreen && sessionData && (
        <SessionBanner
          eventName={sessionData.event_name}
          circuit={sessionData.circuit}
          country={sessionData.country}
          sessionType={sessionType}
          year={year}
          settings={settings}
          onSettingChange={updateSetting}
          weather={weather}
          extraActions={
            <a
              href="/"
              className="px-2 py-1 sm:px-3 rounded text-[10px] sm:text-xs font-bold text-f1-muted hover:text-ink hover:bg-ink/10 transition-colors"
            >
              Exit
            </a>
          }
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-y-auto sm:overflow-hidden">
        {/* Track section */}
        <div className="sm:flex-1 relative">
          {/* Mobile section header */}
          {isMobile && (
            <button
              onClick={() => setMobileTrackOpen(!mobileTrackOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
            >
              <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
              <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileTrackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}

          {(!isMobile || mobileTrackOpen) && (
            <div className="h-[42vh] sm:h-full relative">
              {/* Waiting for session overlay */}
              {waitingForSession && (
                <div className="absolute inset-0 z-30 flex items-center justify-center">
                  <div className="bg-f1-card/95 border border-f1-border rounded-lg px-8 py-6 backdrop-blur-sm text-center">
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-sm font-bold text-red-400 uppercase">Live</span>
                    </div>
                    <p className="text-ink text-lg font-bold mb-2">
                      {live.feedError ? "Can't connect to F1's live timing" : "Waiting for session to start"}
                    </p>
                    <p className="text-f1-muted text-sm max-w-sm">
                      {live.feedError ?? "Live timing data will appear automatically when the session begins."}
                    </p>
                  </div>
                </div>
              )}

              {/* Flag badge */}
              {trackStatus !== "green" && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
                  <div
                    className={`px-3 py-1 rounded text-xs font-extrabold uppercase ${
                      trackStatus === "red"
                        ? "bg-red-600 text-white"
                        : trackStatus === "sc"
                        ? "bg-yellow-500 text-black"
                        : trackStatus === "vsc"
                        ? "bg-yellow-500/80 text-black"
                        : "bg-yellow-400 text-black"
                    }`}
                  >
                    {trackStatus === "red"
                      ? "Red Flag"
                      : trackStatus === "sc"
                      ? "Safety Car"
                      : trackStatus === "vsc"
                      ? "Virtual Safety Car"
                      : "Yellow Flag"}
                  </div>
                </div>
              )}

              {/* LIVE badge + Race Control toggle */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <button
                  onClick={() => setRcPanelOpen(!rcPanelOpen)}
                  className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors ${
                    rcPanelOpen
                      ? "bg-orange-500 text-white"
                      : "bg-f1-card/90 border border-f1-border text-f1-muted hover:text-ink backdrop-blur-sm"
                  }`}
                  title="Race Control Messages"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
                  </svg>
                  RC
                </button>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded text-xs font-extrabold text-white uppercase">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  LIVE
                </div>
              </div>

              {/* Race Control Messages panel */}
              {rcPanelOpen && (
                <div
                  ref={rcPanelRef}
                  className={`z-20 w-80 bg-f1-card/95 border border-f1-border rounded-lg shadow-xl backdrop-blur-sm overflow-hidden flex flex-col ${
                    rcPanelSize === "sm" ? "max-h-[25%]" : rcPanelSize === "md" ? "max-h-[50%]" : "max-h-[85%]"
                  }`}
                  style={rcPosition
                    ? { position: "fixed", left: rcPosition.x, top: rcPosition.y }
                    : { position: "absolute", top: 48, right: 12 }
                  }
                >
                  <div
                    className="flex items-center justify-between px-3 py-2 border-b border-f1-border flex-shrink-0 cursor-grab active:cursor-grabbing"
                    style={{ touchAction: "none" }}
                    onMouseDown={onRcDragStart}
                    onTouchStart={onRcDragStart}
                  >
                    <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
                    <div className="flex items-center gap-1">
                      {(["sm", "md", "lg"] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setRcPanelSize(size)}
                          className={`w-5 h-4 flex items-center justify-center rounded text-[8px] font-bold transition-colors ${
                            rcPanelSize === size ? "bg-f1-muted/30 text-ink" : "text-f1-muted hover:text-ink"
                          }`}
                          title={size === "sm" ? "Compact" : size === "md" ? "Medium" : "Expanded"}
                        >
                          {size === "sm" ? (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="6" width="10" height="5" rx="1" /></svg>
                          ) : size === "md" ? (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="3" width="10" height="8" rx="1" /></svg>
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="1" width="10" height="10" rx="1" /></svg>
                          )}
                        </button>
                      ))}
                      {rcPosition && (
                        <button onClick={() => setRcPosition(null)} className="text-f1-muted hover:text-ink ml-1" title="Reset position">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setRcPanelOpen(false)} className="text-f1-muted hover:text-ink ml-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-f1-border/50">
                    {(live.rcMessages || []).length === 0 ? (
                      <p className="text-f1-muted text-xs p-3 text-center">No race control messages yet</p>
                    ) : (
                      (rcPanelSize === "sm" ? (live.rcMessages || []).slice(0, 1) : (live.rcMessages || [])).map((rc, i) => {
                        const isInvestigation = rc.message.toUpperCase().includes("INVESTIGATION") || rc.message.toUpperCase().includes("NOTED");
                        const isPenalty = rc.message.toUpperCase().includes("PENALTY") && !rc.message.toUpperCase().includes("NO FURTHER");
                        const isCleared = rc.message.toUpperCase().includes("NO FURTHER") || rc.message.toUpperCase().includes("NO INVESTIGATION");
                        return (
                          <div key={i} className="px-3 py-2 rc-msg-enter">
                            <div className="flex items-start gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                              }`} />
                              <div className="min-w-0">
                                <p className="text-[11px] text-ink leading-tight">{rc.message}</p>
                                {rc.lap && (
                                  <span className="text-[9px] text-f1-muted">Lap {rc.lap}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* F1 refused the connection after the session had started (it reconnects by itself) */}
              {live.feedError && !waitingForSession && (
                <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 max-w-md pointer-events-none">
                  <p className="text-[11px] text-ink bg-f1-card/95 border border-f1-red/50 rounded px-3 py-1.5 text-center">{live.feedError}</p>
                </div>
              )}

              {live.frame?.positions_estimated && drivers.some((d) => d.x !== 0 || d.y !== 0) && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                  <span className="text-[10px] text-f1-muted bg-f1-card/80 border border-f1-border rounded px-2 py-0.5">
                    Car positions estimated from mini-sector timing
                    {!signedIn && ". Sign the server in to F1 TV for real positions and telemetry"}
                  </span>
                </div>
              )}

              {/* Live positions unavailable overlay — only when no car has a
                  live position yet (F1 streams Position.z during green-flag
                  running; absent when cars are in the pits / between runs). */}
              {mapDrivers.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-end justify-center pointer-events-none pb-4">
                  <div className="bg-f1-card/90 border border-f1-border rounded-lg px-4 py-2.5 backdrop-blur-sm text-center max-w-sm">
                    <p className="text-f1-muted text-xs leading-relaxed">
                      Live track positions appear when cars are running. They are
                      not available while cars are in the pits or between runs.
                    </p>
                  </div>
                </div>
              )}

              {trackPoints.length > 0 ? (
                <TrackCanvas
                  trackPoints={trackPoints}
                  rotation={rotation}
                  trackStatus={trackStatus}
                  drivers={mapDrivers}
                  highlightedDrivers={selectedDrivers}
                  playbackSpeed={1}
                  showDriverNames={settings.showDriverNames}
                  sectorOverlay={sectorOverlay}
                  corners={settings.showCorners ? trackData?.corners : null}
                  marshalSectors={trackData?.marshal_sectors}
                  sectorFlags={live.frame?.sector_flags}
                  showElevation={settings.showElevation}
                  elevationRangeM={trackData?.elevation?.range_m ?? null}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-f1-muted text-sm">Track data not available</p>
                </div>
              )}

              {/* Fullscreen toggle - top-left */}
              {!isMobile && (
                <button
                  onClick={() => {
                    const next = !fullscreen;
                    setFullscreen(next);
                    if (next && document.documentElement.requestFullscreen) {
                      document.documentElement.requestFullscreen();
                    } else if (!next && document.fullscreenElement) {
                      document.exitFullscreen();
                    }
                  }}
                  className="absolute top-3 left-3 z-20 px-2 py-1 bg-f1-card/90 border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-ink transition-colors backdrop-blur-sm"
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                </button>
              )}
              {settings.showTeamRadio && (
                <RadioCaption
                  messages={live.frame?.radio_messages ?? []}
                  now={live.frame?.timestamp || 0}
                  speed={1}
                  drivers={drivers}
                  roster={sessionData?.drivers ?? []}
                  compact={isMobile}
                  className={isMobile ? "inset-x-2 bottom-2" : "top-1/2 right-3 -translate-y-1/2"}
                  audioPath={(name) => `/api/live/${year}/${round}/radio/${name}?type=${sessionType}`}
                  playAudio={settings.teamRadioAudio && !pipActive}
                />
              )}

              {/* Qualifying lap-completion bubbles */}
              <LapNotifications
                enabled={settings.showLapNotifications}
                isQualifying={isQualifying}
                isRace={isRace}
                lapData={lapData}
                currentTime={now}
                currentLap={live.frame?.lap || 0}
                drivers={drivers}
              />

              {/* Telemetry for the selected drivers (F1 TV sign-in only) */}
              {!isMobile && signedIn && showTelemetry && selectedDrivers.length > 0 && (
                <div className="absolute bottom-10 left-8 z-10">
                  {selectedDrivers.map((abbr) => (
                    <TelemetryChart key={abbr} visible driver={drivers.find((d) => d.abbr === abbr) || null} year={year} isQualifying={isQualifying} useImperial={settings.useImperial} />
                  ))}
                </div>
              )}

              {/* Desktop bottom controls: sectors, telemetry, lap analysis */}
              {!isMobile && (
                <div className="absolute bottom-0 right-3 z-20 flex items-center gap-1 pb-2">
                  {!isRace && trackData?.sector_boundaries && (
                    <>
                      {showSectorOverlay && selectedDrivers.length === 0 && sectorTarget && (
                        <span className="text-[10px] text-f1-muted mr-1">Leader: {sectorTarget}</span>
                      )}
                      {miniCounts && showSectorOverlay && (
                        <button
                          onClick={() => updateSetting("miniSectors", !settings.miniSectors)}
                          className="px-2 py-1 rounded text-[10px] font-bold bg-f1-card/90 border border-f1-border text-f1-muted hover:text-ink backdrop-blur-sm"
                        >
                          {settings.miniSectors ? "Mini-sectors" : "Sectors"}
                        </button>
                      )}
                      <button
                        onClick={() => setShowSectorOverlay(!showSectorOverlay)}
                        className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                          showSectorOverlay ? "bg-f1-red/20 border-f1-red/50 text-f1-red hover:text-ink" : "bg-f1-card/90 border-f1-border text-f1-muted hover:text-ink backdrop-blur-sm"
                        }`}
                      >
                        {showSectorOverlay ? "Hide" : "Show"} Sectors
                      </button>
                    </>
                  )}
                  {signedIn && (
                    <button
                      onClick={() => setShowTelemetry(!showTelemetry)}
                      className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                        showTelemetry ? "bg-f1-red/20 border-f1-red/50 text-f1-red hover:text-ink" : "bg-f1-card/90 border-f1-border text-f1-muted hover:text-ink backdrop-blur-sm"
                      }`}
                    >
                      {showTelemetry ? "Hide" : "Show"} Telemetry
                    </button>
                  )}
                  {hasLapAnalysis && (
                    <button
                      onClick={() => setLapAnalysisOpen(!lapAnalysisOpen)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                        lapAnalysisOpen ? "bg-f1-red text-white" : "bg-f1-card/90 border border-f1-border text-f1-muted hover:text-ink backdrop-blur-sm"
                      }`}
                    >
                      Laps
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Race Control section - mobile only */}
        <div className="sm:hidden">
          <button
            onClick={() => setMobileRcOpen(!mobileRcOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
          >
            <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
            <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileRcOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {mobileRcOpen && (() => {
            const latest = (live.rcMessages || [])[0];
            if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
            const upper = latest.message.toUpperCase();
            const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
            const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
            const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
            return (
              <div className="px-3 py-2 bg-f1-card border-b border-f1-border">
                <div className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                  }`} />
                  <div className="min-w-0">
                    <p className="text-[11px] text-ink leading-tight">{latest.message}</p>
                    {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Lap Analysis panel - desktop, left of the leaderboard */}
        {!isMobile && hasLapAnalysis && lapAnalysisOpen && (
          <div className="w-[440px] flex-shrink-0 border-l border-f1-border overflow-hidden">
            {lapAnalysisPanel(() => setLapAnalysisOpen(false))}
          </div>
        )}

        {/* Leaderboard section */}
        {settings.showLeaderboard && (
          <div className={`flex-shrink-0 ${isMobile ? "" : "border-l"} border-f1-border`} style={{ width: isMobile ? "100%" : Math.ceil(leaderboardWidth * leaderboardScale) }}>
            {/* Mobile section header */}
            {isMobile && (
              <button
                onClick={() => setMobileLeaderboardOpen(!mobileLeaderboardOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileLeaderboardOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}

            {(!isMobile || mobileLeaderboardOpen) && (
              <Leaderboard
                drivers={drivers}
                highlightedDrivers={selectedDrivers}
                onDriverClick={handleDriverClick}
                settings={settings}
                currentTime={live.frame?.timestamp || 0}
                isRace={isRace}
                isQualifying={isQualifying}
                qualiPhase={live.frame?.quali_phase?.phase}
                onScaleChange={setLeaderboardScale}
                lapData={lapData}
                currentLap={live.frame?.lap || 0}
                outLap={outLap}
                miniSectors={miniSectors}
              />
            )}
          </div>
        )}

        {/* Lap Analysis section - mobile only */}
        {isMobile && hasLapAnalysis && (
          <div className="border-t border-f1-border">
            <button
              onClick={() => setMobileLapAnalysisOpen(!mobileLapAnalysisOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
            >
              <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Lap Analysis</span>
              <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileLapAnalysisOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {mobileLapAnalysisOpen && <div className="bg-f1-card">{lapAnalysisPanel()}</div>}
          </div>
        )}
      </div>

      {/* Live info bar (replaces playback controls) */}
      <div className="flex-shrink-0 bg-f1-card border-t border-f1-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Lap counter */}
          {isRace && live.frame && (
            <div className="text-sm">
              <span className="text-f1-muted">Lap </span>
              <span className="text-ink font-bold">{live.frame.lap}</span>
              {live.frame.total_laps > 0 && (
                <span className="text-f1-muted">/{live.frame.total_laps}</span>
              )}
            </div>
          )}

          {/* Dev controls (test replayer only — add ?dev=1 to URL) */}
          {devMode && live.frame && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-f1-muted">
                {(() => {
                  const t = live.frame.timestamp;
                  const h = Math.floor(t / 3600);
                  const m = Math.floor((t % 3600) / 60);
                  const s = Math.floor(t % 60);
                  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                })()}
              </span>
              <div className="flex items-center gap-1">
                {[60, 300, 600, 1800].map((s) => (
                  <button
                    key={s}
                    onClick={() => live.send(JSON.stringify({ command: "skip", seconds: s }))}
                    className="px-1.5 py-0.5 bg-f1-dark border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-ink hover:border-f1-muted transition-colors"
                  >
                    +{s >= 60 ? `${s / 60}m` : `${s}s`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Qualifying phase */}
          {isQualifying && (() => {
            const qPhase = live.frame?.quali_phase;
            const phases = sessionTypeUpper === "SQ" ? ["SQ1", "SQ2", "SQ3"] : ["Q1", "Q2", "Q3"];
            const currentIdx = qPhase ? phases.indexOf(qPhase.phase) : -1;
            return (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  {phases.map((phase, i) => (
                    <span
                      key={phase}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        i === currentIdx
                          ? "bg-ink text-f1-dark"
                          : i < currentIdx
                          ? "bg-ink/20 text-ink/50"
                          : "bg-ink/5 text-ink/25"
                      }`}
                    >
                      {phase}
                    </span>
                  ))}
                </div>
                {qPhase && qPhase.remaining > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-f1-muted">
                    {Math.floor(qPhase.remaining / 60)}:{String(Math.floor(qPhase.remaining % 60)).padStart(2, "0")}
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-3">
          {/* Broadcast delay */}
          <div className="relative">
            <button
              onClick={() => setShowDelaySlider(!showDelaySlider)}
              className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                delayOffset !== 0
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                  : "bg-f1-dark border-f1-border text-f1-muted hover:text-ink"
              }`}
            >
              Delay: {formatDelayShort(delayOffset)}
            </button>
            {showDelaySlider && (
              <div className="absolute bottom-full right-0 mb-2 bg-f1-card border border-f1-border rounded-lg p-3 shadow-xl z-50 w-56">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-f1-muted uppercase">Broadcast Delay</span>
                  <button
                    onClick={() => { setDelayOffset(0); }}
                    className="text-[10px] text-f1-muted hover:text-ink"
                  >
                    Reset
                  </button>
                </div>
                <div className="text-center">
                  <span className="text-3xl font-extrabold text-ink tabular-nums">{formatDelayValue(delayOffset)}</span>
                  <span className="text-lg text-f1-muted ml-1">{formatDelayUnit(delayOffset)}</span>
                </div>
                {/* Slider with zero tick mark */}
                <div className="relative">
                  <input
                    type="range"
                    min={DELAY_MIN}
                    max={DELAY_MAX}
                    step={0.5}
                    value={delayOffset}
                    onChange={(e) => setDelayOffset(Number(e.target.value))}
                    className="w-full h-1 bg-f1-border rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  {/* Zero tick — positioned absolutely over the slider */}
                  <div
                    className="absolute pointer-events-none z-20"
                    style={{ left: `calc(${DELAY_TICK_PERCENT}% - 7px)`, top: "calc(50% + 3px)", transform: "translate(-50%, -50%)" }}
                  >
                    <div className="w-px h-4 bg-ink/40" />
                  </div>
                </div>
                <div className="relative flex justify-between text-[10px] text-f1-muted mt-1">
                  <span>-5m</span>
                  <span>0s</span>
                  <span>+10s</span>
                </div>
                {/* Quick adjust buttons */}
                <div className="flex items-center justify-center gap-1 mt-2">
                  {[
                    { label: "-30s", delta: -30 },
                    { label: "-5s", delta: -5 },
                    { label: "-1s", delta: -1 },
                    { label: "-0.5s", delta: -0.5 },
                    { label: "+0.5s", delta: 0.5 },
                    { label: "+1s", delta: 1 },
                    { label: "+5s", delta: 5 },
                    { label: "+30s", delta: 30 },
                  ].map(({ label, delta }) => (
                    <button
                      key={label}
                      onClick={() => setDelayOffset(clampDelay(delayOffset + delta))}
                      className="px-1.5 py-1 bg-f1-dark border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-ink hover:border-blue-500/50 transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-[9px] text-f1-muted flex-shrink-0">Exact (s):</label>
                  <input
                    type="number"
                    min={DELAY_MIN}
                    max={DELAY_MAX}
                    step={0.5}
                    value={delayOffset}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!isNaN(v)) setDelayOffset(clampDelay(v));
                    }}
                    className="w-20 px-1.5 py-0.5 bg-f1-dark border border-f1-border rounded text-[10px] text-ink text-center focus:outline-none focus:border-blue-500"
                  />
                </div>
                <p className="text-[9px] text-f1-muted mt-2 leading-relaxed">
                  Pauses the live data feed until it aligns with your broadcast. Set this to match the delay of your streaming service so the leaderboard updates at the same time as the TV coverage.
                </p>
                <button
                  onClick={() => setShowDelaySlider(false)}
                  className="w-full mt-2 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold rounded transition-colors"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>

          {/* Live indicator + PiP */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-red-400 uppercase">Live</span>
            </div>
            {!isMobile && !isIOS && (
              <button
                onClick={() => setPipActive(!pipActive)}
                className={`px-3 py-1.5 rounded border transition-colors text-xs font-bold ${
                  pipActive
                    ? "border-f1-red text-f1-red hover:bg-f1-red/10"
                    : "border-f1-border text-f1-muted hover:text-ink hover:bg-ink/10"
                }`}
                title="Picture-in-Picture"
              >
                <svg className="w-4 h-4 inline-block mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <rect x="12" y="10" width="10" height="10" rx="1" fill="currentColor" opacity="0.3" />
                </svg>
                PiP
              </button>
            )}
          </div>
        </div>
      </div>

      {/* PiP window */}
      {pipActive && !isMobile && !isIOS && (
        <PiPWindow onClose={() => setPipActive(false)} width={400} height={720}>
          <div className="flex flex-col h-full bg-f1-dark">
            {/* PiP Track Map */}
            <div>
              <button
                onClick={() => setPipTrackOpen(!pipTrackOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipTrackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipTrackOpen && (
                <div className="relative" style={{ height: "40vh" }}>
                  {trackStatus !== "green" && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                      <div
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          trackStatus === "red"
                            ? "bg-red-600 text-white"
                            : trackStatus === "sc"
                            ? "bg-yellow-500 text-black"
                            : trackStatus === "vsc"
                            ? "bg-yellow-500/80 text-black"
                            : "bg-yellow-400 text-black"
                        }`}
                      >
                        {trackStatus === "red"
                          ? "Red Flag"
                          : trackStatus === "sc"
                          ? "Safety Car"
                          : trackStatus === "vsc"
                          ? "Virtual Safety Car"
                          : "Yellow Flag"}
                      </div>
                    </div>
                  )}
                  <TrackCanvas
                    trackPoints={trackPoints}
                    rotation={rotation}
                    trackStatus={trackStatus}
                    drivers={mapDrivers}
                    highlightedDrivers={selectedDrivers}
                    showDriverNames={settings.showDriverNames}
                    sectorOverlay={sectorOverlay}
                    marshalSectors={trackData?.marshal_sectors}
                    sectorFlags={live.frame?.sector_flags}
                    compact={true}
                    corners={settings.showCorners ? trackData?.corners : null}
                    showElevation={settings.showElevation}
                  />
                </div>
              )}
            </div>

            {/* PiP Race Control */}
            <div className="border-t border-f1-border">
              <button
                onClick={() => setPipRcOpen(!pipRcOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipRcOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipRcOpen && (() => {
                const latest = (live.rcMessages || [])[0];
                if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
                const upper = latest.message.toUpperCase();
                const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
                const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
                const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
                return (
                  <div className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-xs font-mono tracking-tight text-ink leading-tight">{latest.message}</p>
                        {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* PiP Leaderboard */}
            <div className="flex-1 min-h-0 flex flex-col border-t border-f1-border">
              <button
                onClick={() => setPipLeaderboardOpen(!pipLeaderboardOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border flex-shrink-0"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipLeaderboardOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipLeaderboardOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <Leaderboard
                    drivers={drivers}
                    highlightedDrivers={selectedDrivers}
                    onDriverClick={handleDriverClick}
                    settings={settings}
                    currentTime={live.frame?.timestamp || 0}
                    isRace={isRace}
                    isQualifying={isQualifying}
                    qualiPhase={live.frame?.quali_phase?.phase}
                    compact
                    lapData={lapData}
                    currentLap={live.frame?.lap || 0}
                    outLap={outLap}
                    miniSectors={miniSectors}
                  />
                </div>
              )}
            </div>
          </div>
        </PiPWindow>
      )}
    </div>
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-f1-dark" />}>
      <LivePageInner />
    </Suspense>
  );
}
