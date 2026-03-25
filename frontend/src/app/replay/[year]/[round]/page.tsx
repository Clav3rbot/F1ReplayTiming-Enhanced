"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useReplaySocket } from "@/hooks/useReplaySocket";
import { useSettings } from "@/hooks/useSettings";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import Leaderboard, { type LapEntry } from "@/components/Leaderboard";
import LapAnalysisPanel from "@/components/LapAnalysisPanel";
import PlaybackControls from "@/components/PlaybackControls";
import SessionLoadingScreen from "@/components/SessionLoadingScreen";
import TelemetryChart from "@/components/TelemetryChart";
import SyncPhoto from "@/components/SyncPhoto";
import PiPWindow from "@/components/PiPWindow";
import type { SectorOverlay } from "@/lib/trackRenderer";
import { Maximize, Minimize, ArrowUpRight } from "lucide-react";

/** Classify a Race Control message for indicator coloring. */
function classifyRcMessage(message: string) {
  const upper = message.toUpperCase();
  return {
    isPenalty: upper.includes("PENALTY") && !upper.includes("NO FURTHER"),
    isInvestigation: upper.includes("INVESTIGATION") || upper.includes("NOTED"),
    isCleared: upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION"),
  };
}

/** Reusable chevron arrow for collapsible sections. */
function ChevronToggle({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-f1-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

interface TrackData {
  track_points: { x: number; y: number }[];
  rotation: number;
  circuit_name: string;
  sector_boundaries?: { s1_end: number; s2_end: number; total: number } | null;
  corners?: { x: number; y: number; number: number; letter: string; angle: number }[] | null;
  marshal_sectors?: { x: number; y: number; number: number }[] | null;
}

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

export default function ReplayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const year = Number(params.year);
  const round = Number(params.round);
  const sessionType = searchParams.get("type") || "R";

  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [telemetryPosition, setTelemetryPosition] = useState<"left" | "bottom">("left");
  const [showSyncPhoto, setShowSyncPhoto] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTrackOpen, setMobileTrackOpen] = useState(true);
  const [mobileLeaderboardOpen, setMobileLeaderboardOpen] = useState(true);
  const [mobileTelemetryOpen, setMobileTelemetryOpen] = useState(false);
  const [mobileRcOpen, setMobileRcOpen] = useState(true);
  const [lapAnalysisOpen, setLapAnalysisOpen] = useState(false);
  const [mobileLapAnalysisOpen, setMobileLapAnalysisOpen] = useState(false);
  // Force telemetry to bottom when lap analysis panel is open to avoid squashing the track map
  const effectiveTelemetryPosition = lapAnalysisOpen && telemetryPosition === "left" ? "bottom" : telemetryPosition;
  const [leaderboardScale, setLeaderboardScale] = useState(1);
  const [pipTrackOpen, setPipTrackOpen] = useState(true);
  const [pipTelemetryOpen, setPipTelemetryOpen] = useState(false);
  const [pipRcOpen, setPipRcOpen] = useState(true);
  const [pipLeaderboardOpen, setPipLeaderboardOpen] = useState(true);
  const [showSectorOverlay, setShowSectorOverlay] = useState(false);
  const [sectorFocusDriver, setSectorFocusDriver] = useState<string | null>(null);
  const [rcPanelOpen, setRcPanelOpen] = useState(false);
  const [rcPinned, setRcPinned] = useState(false);
  const [rcPanelSize, setRcPanelSize] = useState<"sm" | "md" | "lg">("md");
  const [rcPosition, setRcPosition] = useState<{ x: number; y: number } | null>(null);
  const rcDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const rcPanelRef = useRef<HTMLDivElement>(null);
  const telemetryPanelRef = useRef<HTMLDivElement>(null);
  const [isIOS, setIsIOS] = useState(false);

  const enableTrackZoom = false; // iPad uses pinch-to-zoom gesture directly on the canvas

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

  // Prevent screen from sleeping while the replay page is open
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

  const handleDriverClick = useCallback((abbr: string) => {
    setSelectedDrivers((prev) => {
      if (prev.includes(abbr)) {
        return prev.filter((d) => d !== abbr);
      }
      return [...prev, abbr];
    });
  }, []);
  const { settings, update: updateSetting } = useSettings();

  const { data: sessionData, loading: sessionLoading, error: sessionError } = useApi<SessionData>(
    `/api/sessions/${year}/${round}?type=${sessionType}`,
  );

  // retryKey: forces track/laps re-fetch after WebSocket finishes on-demand processing
  const [retryKey, setRetryKey] = useState(0);

  // WebSocket for replay data (must be declared before useApp hooks that depend on it)
  const replay = useReplaySocket(year, round, sessionType);

  const { data: trackData, loading: trackLoading } = useApi<TrackData>(
    replay.ready ? `/api/sessions/${year}/${round}/track?type=${sessionType}${retryKey ? `&_r=${retryKey}` : ''}` : null,
  );

  // Fetch lap data for last lap time column (race/sprint only)
  const { data: lapsResponse } = useApi<{ laps: LapEntry[] }>(
    (sessionType === "R" || sessionType === "S") && replay.ready
      ? `/api/sessions/${year}/${round}/laps?type=${sessionType}${retryKey ? `&_r=${retryKey}` : ''}`
      : null,
  );

  // Build lookup: driver -> lap_number -> lap_time
  const lapData = useMemo(() => {
    if (!lapsResponse?.laps) return undefined;
    const map = new Map<string, Map<number, string>>();
    for (const lap of lapsResponse.laps) {
      if (!lap.lap_time) continue;
      let driverMap = map.get(lap.driver);
      if (!driverMap) {
        driverMap = new Map();
        map.set(lap.driver, driverMap);
      }
      driverMap.set(lap.lap_number, lap.lap_time);
    }
    return map;
  }, [lapsResponse]);

  // When WebSocket finishes on-demand processing and track data is still missing,
  // re-fetch track/laps (the WebSocket just created them in storage)
  const prevReady = useRef(false);
  useEffect(() => {
    if (replay.ready && !prevReady.current) {
      prevReady.current = true;
      if (!trackData) {
        setRetryKey((k) => k + 1);
      }
    }
  }, [replay.ready, trackData]);

  const lastRcCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const msgs = replay.frame?.rc_messages || [];
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
  }, [replay.frame?.rc_messages?.length, settings.rcSound]);

  const isLoading = sessionLoading;
  const dataError = sessionError || replay.error;
  const blockingLoad = isLoading || (!dataError && replay.loading);

  const [loadPhase, setLoadPhase] = useState<"loading" | "exit" | "ready">("loading");

  useEffect(() => {
    if (dataError) return;
    if (blockingLoad) {
      setLoadPhase("loading");
    } else {
      setLoadPhase((p) => (p === "loading" ? "exit" : p));
    }
  }, [blockingLoad, dataError]);

  useEffect(() => {
    if (dataError || loadPhase !== "exit") return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduced ? 0 : 560;
    const id = window.setTimeout(() => setLoadPhase("ready"), ms);
    return () => window.clearTimeout(id);
  }, [dataError, loadPhase]);

  const drivers = replay.frame?.drivers || [];

  // Filter & map drivers for the track canvas — single source of truth
  // Must be declared before early returns to comply with Rules of Hooks
  const visibleDriverMarkers = useMemo(() =>
    drivers
      .filter((d) => !d.retired && !d.no_timing && !d.finished && (d.x !== 0 || d.y !== 0) && d.x > -0.5 && d.x < 1.5 && d.y > -0.5 && d.y < 1.5)
      .map((d) => ({ abbr: d.abbr, x: d.x, y: d.y, color: d.color, position: d.position })),
    [drivers],
  );

  if (dataError) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-bold mb-2">Session Unavailable</p>
          <p className="text-f1-muted mb-1">
            {typeof dataError === 'string' ? dataError : "Data for this session is not available yet."}
          </p>
          <p className="text-f1-muted text-sm mb-6">
            If the session just finished, data typically becomes available 1–2 hours after the chequered flag.
          </p>
          <a href="/" className="inline-block px-4 py-2 bg-f1-red text-white font-bold text-sm rounded hover:bg-red-700 transition-colors">
            Back to session picker
          </a>
        </div>
      </div>
    );
  }

  if (loadPhase === "loading" || loadPhase === "exit") {
    return <SessionLoadingScreen exiting={loadPhase === "exit"} />;
  }

  const trackPoints = trackData?.track_points || [];
  const rotation = trackData?.rotation || 0;
  const trackStatus = replay.frame?.status || "green";
  const redFlagEnd = replay.frame?.red_flag_end ?? null;
  const redFlagCountdown = redFlagEnd !== null && replay.frame
    ? Math.max(0, redFlagEnd - replay.frame.timestamp)
    : null;
  const weather = replay.frame?.weather;
  const isRace = sessionType === "R" || sessionType === "S";
  const isQualifying = sessionType === "Q" || sessionType === "SQ";

  // Compute sector overlay for track map
  const SECTOR_HEX: Record<string, string> = { purple: "#A855F7", green: "#22C55E", yellow: "#EAB308" };
  const DEFAULT_SECTOR = "#3A3A4A";
  const sectorOverlay: SectorOverlay | null = (() => {
    if (!isQualifying || !showSectorOverlay || !trackData?.sector_boundaries) return null;
    const target = sectorFocusDriver && selectedDrivers.includes(sectorFocusDriver)
      ? sectorFocusDriver
      : selectedDrivers[0] ?? null;
    if (!target) return null;
    const drv = drivers.find((d) => d.abbr === target);
    const sectors = drv?.sectors;
    return {
      boundaries: trackData.sector_boundaries,
      colors: {
        s1: SECTOR_HEX[sectors?.find((s) => s.num === 1)?.color ?? ""] ?? DEFAULT_SECTOR,
        s2: SECTOR_HEX[sectors?.find((s) => s.num === 2)?.color ?? ""] ?? DEFAULT_SECTOR,
        s3: SECTOR_HEX[sectors?.find((s) => s.num === 3)?.color ?? ""] ?? DEFAULT_SECTOR,
      },
    };
  })();

  // Calculate leaderboard width based on active columns
  const leaderboardWidthFull = (() => {
    let w = 106; // base: position(24) + team bar(12) + driver(30) + flags(16) + padding(16) + right padding(8)
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18; // pit indicator (P box + margin)
    if (isRace && settings.showGridChange) w += 24;
    if (!isRace && settings.showBestLapTime) w += 60; // best lap time column
    if (isRace && settings.showLastLapTime) w += 60; // last lap time column
    if (settings.showGapToLeader) w += 56;
    if (isQualifying && settings.showSectors) w += 36; // sector indicators (28 + 8 margin)
    if (isRace && settings.showPitStops) w += 24;
    if (isRace && settings.showTyreHistory) w += 36;
    if (settings.showTyreType) w += 24;
    if (settings.showTyreAge) w += 20;
    if (isRace && settings.showPitPrediction) w += 40; // pit prediction
    if (isRace && settings.showPitPrediction && settings.showPitFreeAir) w += 36; // pit gaps (ahead/behind)
    return w;
  })();

  // On mobile, auto-hide team abbreviation if columns overflow the screen
  const mobileTeamAbbrHidden = isMobile && settings.showTeamAbbr && leaderboardWidthFull > (typeof window !== "undefined" ? window.innerWidth : 400);
  const leaderboardWidth = mobileTeamAbbrHidden ? leaderboardWidthFull - 28 : leaderboardWidthFull;

  return (
    <div
      className="replay-page-enter h-dvh flex flex-col bg-f1-dark overflow-hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Reconnecting banner */}
      {replay.reconnecting && (
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-3 py-1.5 bg-yellow-500/90 text-black text-xs font-bold">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Reconnecting...
        </div>
      )}
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
          mobileTeamAbbrHidden={mobileTeamAbbrHidden}
        />
      )}
      {/* Main content grid */}
      <div
        className={`flex min-h-0 flex-1 min-w-0 ${
          isMobile ? "flex-col overflow-hidden" : "overflow-hidden"
        }`}
      >
        {/* Mobile: Map is fixed height at top, rest scrolls */}
        {isMobile && (
          <div className="flex-shrink-0 z-40 bg-f1-bg border-b border-f1-border flex flex-col" style={{ height: '40vh' }}>
            <button
              onClick={() => setMobileTrackOpen(!mobileTrackOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
            >
              <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
              <ChevronToggle open={mobileTrackOpen} />
            </button>
            <div className={`flex-1 relative bg-black/40 overflow-hidden transition-all duration-300 ${!mobileTrackOpen ? "hidden" : "block"}`}>
              <TrackCanvas
                trackPoints={trackPoints}
                rotation={rotation}
                trackStatus={trackStatus}
                drivers={visibleDriverMarkers}
                highlightedDrivers={selectedDrivers}
                playbackSpeed={replay.speed}
                showDriverNames={settings.showDriverNames}
                sectorOverlay={sectorOverlay}
                zoom={1}
                corners={settings.showCorners ? trackData?.corners : null}
                marshalSectors={trackData?.marshal_sectors}
                sectorFlags={replay.frame?.sector_flags}
                playing={replay.playing}
              />
            </div>
          </div>
        )}

        {/* Map/telemetry: overflow nascosto; widget + playbar nella colonna centrale */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isMobile && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div
              className={`min-w-0 flex min-h-0 flex-1 overflow-hidden ${
                showTelemetry && selectedDrivers.length > 2
                  ? effectiveTelemetryPosition === "left"
                    ? "flex-row"
                    : "flex-col"
                  : "flex-col"
              }`}
            >
              {/* Desktop Left Column */}
              <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden relative">
                <div className="flex-1 min-h-0 relative bg-black/40 overflow-hidden">
                {/* RC toggle */}
                <div className="absolute top-3 right-3 z-10">
                  <button
                    onClick={() => {
                      if (rcPinned) {
                        setRcPinned(false);
                      } else {
                        setRcPanelOpen(!rcPanelOpen);
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors ${
                      rcPanelOpen || rcPinned ? "bg-orange-500 text-white" : "bg-f1-card/90 border border-f1-border text-f1-muted hover:text-white backdrop-blur-sm"
                    }`}
                    title="Race Control Messages"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
                    </svg>
                    RC
                  </button>
                </div>

                {/* RC floating panel (draggable) */}
                {rcPanelOpen && !rcPinned && (
                  <div
                    ref={rcPanelRef}
                    className={`z-20 w-80 bg-f1-card/95 border border-f1-border rounded-lg shadow-xl backdrop-blur-sm overflow-hidden flex flex-col ${
                      rcPanelSize === "sm" ? "max-h-[25%]" : rcPanelSize === "md" ? "max-h-[50%]" : "max-h-[85%]"
                    }`}
                    style={rcPosition
                      ? { position: "fixed", left: rcPosition.x, top: rcPosition.y }
                      : { position: "fixed", top: 72, right: 12 }
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
                              rcPanelSize === size ? "bg-f1-muted/30 text-white" : "text-f1-muted hover:text-white"
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
                          <button onClick={() => setRcPosition(null)} className="text-f1-muted hover:text-white ml-1" title="Reset position">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRcPanelOpen(false);
                            setRcPosition(null);
                          }}
                          className="text-f1-muted hover:text-white ml-1"
                          title="Close"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-f1-border/50">
                      {(() => {
                        const allMsgs = replay.frame?.rc_messages || [];
                        const msgs = rcPanelSize === "sm" ? allMsgs.slice(0, 1) : allMsgs;
                        if (allMsgs.length === 0) return <p className="text-f1-muted text-xs p-3 text-center">No race control messages yet</p>;
                        return msgs.map((rc, i) => {
                          const { isPenalty, isInvestigation, isCleared } = classifyRcMessage(rc.message);
                          return (
                            <div key={i} className="px-3 py-2 rc-msg-enter">
                              <div className="flex items-start gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                  isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                                }`} />
                                <div className="min-w-0">
                                  <p className="text-[11px] text-white leading-tight">{rc.message}</p>
                                  {rc.lap && <span className="text-[9px] text-f1-muted">Lap {rc.lap}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                <TrackCanvas
                  trackPoints={trackPoints}
                  rotation={rotation}
                  trackStatus={trackStatus}
                  drivers={visibleDriverMarkers}
                  highlightedDrivers={selectedDrivers}
                  playbackSpeed={replay.speed}
                  showDriverNames={settings.showDriverNames}
                  sectorOverlay={sectorOverlay}
                  zoom={1}
                  corners={settings.showCorners ? trackData?.corners : null}
                  marshalSectors={trackData?.marshal_sectors}
                  sectorFlags={replay.frame?.sector_flags}
                  playing={replay.playing}
                />
                
                {showTelemetry && selectedDrivers.length <= 2 && (
                  <div className="absolute bottom-2 left-8 z-10">
                    {selectedDrivers.map((abbr) => {
                      const drv = drivers.find((d) => d.abbr === abbr) || null;
                      return <TelemetryChart key={abbr} visible driver={drv} year={year} isQualifying={isQualifying} useImperial={settings.useImperial} />;
                    })}
                    {selectedDrivers.length === 0 && <TelemetryChart visible driver={null} year={year} useImperial={settings.useImperial} />}
                  </div>
                )}

                {/* Sector overlay controls - desktop qualifying only */}
                {!isMobile && isQualifying && trackData?.sector_boundaries && (
                  <div className="absolute bottom-2 right-36 z-20 flex items-center gap-1">
                    {showSectorOverlay && selectedDrivers.length === 0 && (
                      <span className="text-[10px] text-f1-muted mr-1">Select a driver to view sectors</span>
                    )}
                    {showSectorOverlay && selectedDrivers.length > 0 && (
                      selectedDrivers.map((abbr) => {
                        const drv = drivers.find((d) => d.abbr === abbr);
                        const isActive = sectorFocusDriver === abbr;
                        return (
                          <button
                            key={abbr}
                            onClick={() => setSectorFocusDriver(isActive ? null : abbr)}
                            className={`px-1.5 py-1 border rounded text-[10px] font-bold transition-colors ${
                              isActive
                                ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                                : "bg-f1-card border-f1-border text-f1-muted hover:text-white"
                            }`}
                          >
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: drv?.color }} />
                            {abbr}
                          </button>
                        );
                      })
                    )}
                    <button
                      onClick={() => setShowSectorOverlay(!showSectorOverlay)}
                      className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                        showSectorOverlay
                          ? "bg-purple-500/20 border-purple-500/50 text-purple-300 hover:text-purple-200"
                          : "bg-f1-card border-f1-border text-f1-muted hover:text-white"
                      }`}
                    >
                      {showSectorOverlay ? "Hide" : "Show"} Sectors
                    </button>
                  </div>
                )}

                {/* Desktop telemetry toggle + lap analysis */}
                <div className="absolute bottom-0 right-3 z-20 flex items-center gap-1 pb-2">
                  <button
                    onClick={() => setShowTelemetry(!showTelemetry)}
                    className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                      showTelemetry ? "bg-f1-red/20 border-f1-red/50 text-f1-red hover:text-white" : "bg-f1-card/90 border-f1-border text-f1-muted hover:text-white backdrop-blur-sm"
                    }`}
                  >
                    {showTelemetry ? "Hide" : "Show"} Telemetry
                  </button>
                  {isRace && lapsResponse?.laps && (
                    <button
                      onClick={() => setLapAnalysisOpen(!lapAnalysisOpen)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                        lapAnalysisOpen
                          ? "bg-f1-red text-white"
                          : "bg-f1-card/90 border border-f1-border text-f1-muted hover:text-white backdrop-blur-sm"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Laps
                    </button>
                  )}
                </div>
                </div>
              </div>

              {/* Expanded telemetry panel for 3+ drivers */}
              {showTelemetry && selectedDrivers.length > 2 && (() => {
                const telRowsPerCol = Math.max(Math.min(4, Math.ceil(drivers.length / 4)), Math.ceil(selectedDrivers.length / 4));
                const telNumCols = Math.ceil(selectedDrivers.length / telRowsPerCol);
                return (
                <div
                className={`flex-shrink-0 relative min-h-0 ${
                  effectiveTelemetryPosition === "left"
                    ? "flex h-full max-h-full min-w-0 flex-col overflow-hidden glass-panel-heavy border-r border-f1-border order-first px-3 py-2 w-fit max-w-[100vw]"
                    : "glass-panel-heavy border-t border-f1-border py-1 flex flex-row overflow-hidden h-56 max-h-[40vh]"
                }`}
                >
                  <div
                    ref={telemetryPanelRef}
                    className={
                      effectiveTelemetryPosition === "bottom"
                        ? "flex-1 min-w-0 glass-panel-heavy px-3 pt-1 flex flex-col min-h-0 overflow-auto"
                        : "flex min-h-0 min-w-0 flex-col overflow-hidden"
                    }
                  >
                    <div className="mb-1 flex flex-shrink-0 items-center gap-2 pr-1.5">
                  <span className="text-[10px] font-bold text-f1-muted uppercase">Telemetry</span>
                  {lapAnalysisOpen ? (
                    <span className="text-[9px] text-f1-muted italic">Shown at bottom while Lap Analysis is open</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (telemetryPosition === "left") {
                          setTelemetryPosition("bottom");
                        } else {
                          setTelemetryPosition("left");
                        }
                      }}
                      className="px-1.5 py-0.5 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                    >
                      {telemetryPosition === "left" ? "Move to bottom" : "Move to left"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowTelemetry(false)}
                    className="px-1.5 py-0.5 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors ml-auto"
                  >
                    Hide
                  </button>
                </div>
                <div
                  className={`gap-1 ${
                    effectiveTelemetryPosition === "bottom"
                      ? "relative z-10 flex flex-row min-h-0 overflow-auto overscroll-contain pr-1.5 pb-2"
                      : "flex max-h-[42vh] flex-col overflow-y-auto overscroll-y-contain pr-1.5"
                  }`}
                >
                  {effectiveTelemetryPosition === "bottom" ? (() => {
                    const columns = [
                      selectedDrivers.slice(0, telRowsPerCol),
                      selectedDrivers.slice(telRowsPerCol, telRowsPerCol * 2),
                      selectedDrivers.slice(telRowsPerCol * 2, telRowsPerCol * 3),
                      selectedDrivers.slice(telRowsPerCol * 3),
                    ].filter(c => c.length > 0);
                    return columns.map((col, colIdx) => (
                      <div key={colIdx} className="flex flex-col gap-1">
                        {col.map((abbr) => {
                          const drv = drivers.find((d) => d.abbr === abbr) || null;
                          return (
                            <div key={abbr}>
                              <TelemetryChart
                                visible
                                driver={drv}
                                year={year}
                                isQualifying={isQualifying}
                                useImperial={settings.useImperial}
                                sidebar
                              />
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })() : selectedDrivers.map((abbr) => {
                    const drv = drivers.find((d) => d.abbr === abbr) || null;
                    return (
                      <div key={abbr}>
                        <TelemetryChart
                          visible
                          driver={drv}
                          year={year}
                          isQualifying={isQualifying}
                          useImperial={settings.useImperial}
                          sidebar={effectiveTelemetryPosition === "left" || effectiveTelemetryPosition === "bottom"}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              {!rcPinned && !(rcPanelOpen && effectiveTelemetryPosition === "bottom") && (
                <div className={`flex flex-shrink-0 flex-col items-center justify-center gap-1 ${
                  effectiveTelemetryPosition === "bottom"
                    ? `border-l border-f1-border px-4 ${telNumCols >= 4 ? "w-48" : telNumCols >= 3 ? "w-[30%]" : "w-[50%]"}`
                    : "border-t border-f1-border py-2 mt-2"
                }`}>
                  <button
                    onClick={() => { setRcPinned(true); setRcPanelOpen(false); setRcPosition(null); }}
                    className="px-2 py-1 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                  >
                    Show Race Control
                  </button>
                  {effectiveTelemetryPosition === "bottom" && (
                    <button
                      onClick={() => { setRcPanelOpen(true); setRcPosition(null); }}
                      className="px-2 py-1 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                    >
                      Open Popup
                    </button>
                  )}
                </div>
              )}
              {rcPinned && (
                <div
                  className={`glass-panel-heavy ${
                    effectiveTelemetryPosition === "bottom"
                      ? `border-l border-f1-border px-3 pt-1 ${telNumCols >= 4 ? "w-48" : telNumCols >= 3 ? "w-[30%]" : "w-[50%]"} flex-shrink-0 overflow-hidden flex flex-col min-h-0`
                      : "mt-2 flex max-h-[min(38vh,22rem)] min-h-0 flex-shrink-0 flex-col overflow-hidden border-t border-f1-border px-3 py-2"
                  }`}
                >
                  <div className="mb-1 flex flex-shrink-0 items-center justify-between">
                    <span className="text-[10px] font-bold text-f1-muted uppercase">Race Control</span>
                    <button
                      onClick={() => setRcPinned(false)}
                      className="px-1.5 py-0.5 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 divide-y divide-f1-border/50 overflow-y-auto overscroll-y-contain">
                    {(() => {
                      const allMsgs = replay.frame?.rc_messages || [];
                      if (allMsgs.length === 0) return <p className="text-f1-muted text-xs py-2 text-center">No messages yet</p>;
                      return allMsgs.map((rc, i) => {
                        const { isPenalty, isInvestigation, isCleared } = classifyRcMessage(rc.message);
                        return (
                          <div key={i} className="py-1.5">
                            <div className="flex items-start gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                              }`} />
                              <div className="min-w-0">
                                <p className="text-[11px] text-white leading-tight">{rc.message}</p>
                                {rc.lap && <span className="text-[9px] text-f1-muted">Lap {rc.lap}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
                </div>
              );
              })()}
            </div>
            </div>
          )}

          {/* Widgets that scroll below map on mobile */}
          <div
            className={
              isMobile ? "flex min-w-0 flex-1 flex-col overflow-y-auto pb-24 [overflow-anchor:none]" : "flex min-w-0 flex-shrink-0 flex-col overflow-x-visible"
            }
          >
            {/* Race Control - Mobile with colored indicators */}
            {isMobile && (
              <div className="border-b border-f1-border">
                <button
                  onClick={() => setMobileRcOpen(!mobileRcOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
                >
                  <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
                  <ChevronToggle open={mobileRcOpen} />
                </button>
                {mobileRcOpen && (() => {
                  const latest = (replay.frame?.rc_messages || [])[0];
                  if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
                  const { isPenalty, isInvestigation, isCleared } = classifyRcMessage(latest.message);
                  return (
                    <div className="px-3 py-2 bg-f1-card/50">
                      <div className="flex items-start gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                          isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                        }`} />
                        <div className="min-w-0">
                          <p className="text-[11px] text-white leading-tight">{latest.message}</p>
                          {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Telemetry - Mobile */}
            {isMobile && (
              <div className="border-b border-f1-border">
                <button
                  onClick={() => setMobileTelemetryOpen(!mobileTelemetryOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
                >
                  <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Telemetry</span>
                  <ChevronToggle open={mobileTelemetryOpen} />
                </button>
                {mobileTelemetryOpen && (
                  <div className="bg-f1-card px-3 py-2 space-y-1">
                    {selectedDrivers.length > 0 ? (
                      selectedDrivers.map((abbr) => {
                        const drv = drivers.find((d) => d.abbr === abbr) || null;
                        return <TelemetryChart key={abbr} visible driver={drv} year={year} isQualifying={isQualifying} useImperial={settings.useImperial} />;
                      })
                    ) : (
                      <TelemetryChart visible driver={null} year={year} useImperial={settings.useImperial} />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Playback Controls */}
            <div className="fixed bottom-0 inset-x-0 z-50 overflow-visible bg-f1-dark sm:relative sm:inset-auto sm:z-10">
              <PlaybackControls
                playing={replay.playing}
                speed={replay.speed}
                currentTime={replay.frame?.timestamp || 0}
                totalTime={replay.totalTime}
                currentLap={replay.frame?.lap || 0}
                totalLaps={replay.totalLaps}
                finished={replay.finished}
                showSessionTime={settings.showSessionTime}
                onPlay={replay.play}
                onPause={replay.pause}
                onSpeedChange={replay.setSpeed}
                onSeek={replay.seek}
                onSeekToLap={replay.seekToLap}
                onReset={replay.reset}
                isRace={isRace}
                onSyncPhoto={() => setShowSyncPhoto(true)}
                onPiP={!isMobile && !isIOS ? () => setPipActive(true) : undefined}
                pipActive={pipActive}
                onFullscreen={!isMobile ? () => {
                  if (fullscreen) {
                    document.exitFullscreen().catch(() => {});
                  } else {
                    document.documentElement.requestFullscreen().catch(() => {});
                  }
                  setFullscreen(!fullscreen);
                } : undefined}
                fullscreen={fullscreen}
                qualiPhase={replay.frame?.quali_phase}
                qualiPhases={replay.qualiPhases}
                lapStarts={replay.lapStarts}
                totalFrames={replay.totalFrames}
                frameLapsRle={replay.frameLapsRle}
                replaySampleInterval={replay.replaySampleInterval}
              />
            </div>

            {/* Leaderboard - Mobile Inline version */}
            {isMobile && settings.showLeaderboard && (
              <div className="border-t border-f1-border">
                <button
                  onClick={() => setMobileLeaderboardOpen(!mobileLeaderboardOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
                >
                  <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                  <ChevronToggle open={mobileLeaderboardOpen} />
                </button>
                {mobileLeaderboardOpen && (
                  <div className="bg-f1-bg">
                    <Leaderboard
                      drivers={drivers}
                      highlightedDrivers={selectedDrivers}
                      onDriverClick={handleDriverClick}
                      settings={settings}
                      currentTime={replay.frame?.timestamp || 0}
                      isRace={isRace}
                      isQualifying={isQualifying}
                      onScaleChange={setLeaderboardScale}
                      lapData={lapData}
                      currentLap={replay.frame?.lap || 0}
                      mobileTeamAbbrHidden={mobileTeamAbbrHidden}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Lap Analysis section - mobile only */}
            {isMobile && isRace && lapsResponse?.laps && (
              <div className="border-t border-f1-border" ref={(el) => {
                if (el && mobileLapAnalysisOpen) {
                  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                }
              }}>
                <button
                  onClick={() => setMobileLapAnalysisOpen(!mobileLapAnalysisOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
                >
                  <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Lap Analysis</span>
                  <ChevronToggle open={mobileLapAnalysisOpen} />
                </button>
                {mobileLapAnalysisOpen && (
                  <div className="bg-f1-card">
                    <LapAnalysisPanel laps={lapsResponse.laps} drivers={drivers} currentLap={replay.frame?.lap || 0} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Leaderboard Column (with optional lap analysis panel) */}
        {!isMobile && settings.showLeaderboard && (
          <div className="border-l border-f1-border flex-shrink-0 flex">
            {/* Lap Analysis Panel - desktop only, left of leaderboard */}
            {isRace && lapAnalysisOpen && lapsResponse?.laps && (
              <div className="w-[300px] h-full border-r border-f1-border overflow-hidden flex-shrink-0">
                <LapAnalysisPanel laps={lapsResponse.laps} drivers={drivers} currentLap={replay.frame?.lap || 0} onClose={() => setLapAnalysisOpen(false)} />
              </div>
            )}
            <div style={{ width: Math.ceil(leaderboardWidth * leaderboardScale) }}>
              <Leaderboard
                drivers={drivers}
                highlightedDrivers={selectedDrivers}
                onDriverClick={handleDriverClick}
                settings={settings}
                currentTime={replay.frame?.timestamp || 0}
                isRace={isRace}
                isQualifying={isQualifying}
                onScaleChange={setLeaderboardScale}
                lapData={lapData}
                currentLap={replay.frame?.lap || 0}
                mobileTeamAbbrHidden={mobileTeamAbbrHidden}
              />
            </div>
          </div>
        )}
      </div>

      {/* Document PiP window — visible across tabs */}
      {pipActive && !isMobile && !isIOS && (
        <PiPWindow onClose={() => setPipActive(false)} width={400} height={780}>
          <div className="flex flex-col h-full bg-f1-dark">
            {/* PiP Track Map */}
            <div>
              <button
                onClick={() => setPipTrackOpen(!pipTrackOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
                <ChevronToggle open={pipTrackOpen} />
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
                    drivers={visibleDriverMarkers}
                    highlightedDrivers={selectedDrivers}
                    playbackSpeed={replay.speed}
                    showDriverNames={settings.showDriverNames}
                    sectorOverlay={sectorOverlay}
                    compact={true}
                    corners={settings.showCorners ? trackData?.corners : null}
                    marshalSectors={trackData?.marshal_sectors}
                    sectorFlags={replay.frame?.sector_flags}
                    playing={replay.playing}
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
                <ChevronToggle open={pipRcOpen} />
              </button>
              {pipRcOpen && (() => {
                const latest = (replay.frame?.rc_messages || [])[0];
                if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
                const { isPenalty, isInvestigation, isCleared } = classifyRcMessage(latest.message);
                return (
                  <div className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-xs font-mono tracking-tight text-white leading-tight">{latest.message}</p>
                        {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* PiP Telemetry */}
            <div className="border-t border-f1-border">
              <button
                onClick={() => setPipTelemetryOpen(!pipTelemetryOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Telemetry</span>
                <ChevronToggle open={pipTelemetryOpen} />
              </button>
              {pipTelemetryOpen && (
                <div className="bg-f1-card px-3 py-2 space-y-1">
                  {selectedDrivers.length > 0 ? (
                    selectedDrivers.map((abbr) => {
                      const drv = drivers.find((d) => d.abbr === abbr) || null;
                      return <TelemetryChart key={abbr} visible driver={drv} year={year} isQualifying={isQualifying} useImperial={settings.useImperial} />;
                    })
                  ) : (
                    <TelemetryChart visible driver={null} year={year} useImperial={settings.useImperial} />
                  )}
                </div>
              )}
            </div>

            {/* PiP Leaderboard */}
            <div className="flex-1 min-h-0 flex flex-col border-t border-f1-border">
              <button
                onClick={() => setPipLeaderboardOpen(!pipLeaderboardOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border flex-shrink-0"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                <ChevronToggle open={pipLeaderboardOpen} />
              </button>
              {pipLeaderboardOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <Leaderboard
                    drivers={drivers}
                    highlightedDrivers={selectedDrivers}
                    onDriverClick={handleDriverClick}
                    settings={settings}
                    currentTime={replay.frame?.timestamp || 0}
                    isRace={isRace}
                    isQualifying={isQualifying}
                    compact
                    lapData={lapData}
                    currentLap={replay.frame?.lap || 0}
                  />
                </div>
              )}
            </div>

            {/* PiP Playback Controls */}
            <div className="flex-shrink-0">
              <PlaybackControls
                playing={replay.playing}
                speed={replay.speed}
                currentTime={replay.frame?.timestamp || 0}
                totalTime={replay.totalTime}
                currentLap={replay.frame?.lap || 0}
                totalLaps={replay.totalLaps}
                finished={replay.finished}
                showSessionTime={settings.showSessionTime}
                onPlay={replay.play}
                onPause={replay.pause}
                onSpeedChange={replay.setSpeed}
                onSeek={replay.seek}
                onSeekToLap={replay.seekToLap}
                onReset={replay.reset}
                isRace={isRace}
                qualiPhase={replay.frame?.quali_phase}
                qualiPhases={replay.qualiPhases}
                lapStarts={replay.lapStarts}
                totalFrames={replay.totalFrames}
                frameLapsRle={replay.frameLapsRle}
                replaySampleInterval={replay.replaySampleInterval}
              />
            </div>
          </div>
        </PiPWindow>
      )}

      {/* Sync with photo modal */}
      {showSyncPhoto && (
        <SyncPhoto
          year={year}
          round={round}
          sessionType={sessionType}
          onSync={(timestamp) => replay.seek(timestamp)}
          onClose={() => setShowSyncPhoto(false)}
        />
      )}
    </div>
  );
}
