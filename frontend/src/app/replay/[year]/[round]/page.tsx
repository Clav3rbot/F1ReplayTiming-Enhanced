"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useReplaySocket } from "@/hooks/useReplaySocket";
import { useSettings } from "@/hooks/useSettings";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import Leaderboard from "@/components/Leaderboard";
import PlaybackControls from "@/components/PlaybackControls";
import SessionLoadingScreen from "@/components/SessionLoadingScreen";
import TelemetryChart from "@/components/TelemetryChart";
import SyncPhoto from "@/components/SyncPhoto";
import PiPWindow from "@/components/PiPWindow";
import type { SectorOverlay } from "@/lib/trackRenderer";
import { Maximize, Minimize, ArrowUpRight } from "lucide-react";

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
  const [mobileTrackZoom, setMobileTrackZoom] = useState(1);
  const [isIOS, setIsIOS] = useState(false);

  const enableTrackZoom = isIOS && !fullscreen && !isMobile;

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
      return [...prev, abbr];
    });
  }
  const { settings, update: updateSetting } = useSettings();

  const { data: sessionData, loading: sessionLoading, error: sessionError } = useApi<SessionData>(
    `/api/sessions/${year}/${round}?type=${sessionType}`,
  );

  const { data: trackData, loading: trackLoading, error: trackError } = useApi<TrackData>(
    `/api/sessions/${year}/${round}/track?type=${sessionType}`,
  );

  const replay = useReplaySocket(year, round, sessionType);

  const lastRcCountRef = useRef(0);
  useEffect(() => {
    const msgs = replay.frame?.rc_messages || [];
    if (msgs.length > lastRcCountRef.current && lastRcCountRef.current > 0 && settings.rcSound) {
      try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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

  const isLoading = sessionLoading || trackLoading;
  const dataError = sessionError || trackError;
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

  if (dataError) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-bold mb-2">Session Unavailable</p>
          <p className="text-f1-muted mb-1">
            Data for this session is not available yet.
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
  const drivers = replay.frame?.drivers || [];
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
  const leaderboardWidth = (() => {
    let w = 106; // base: position(24) + team bar(12) + driver(30) + flags(16) + padding(16) + right padding(8)
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18; // pit indicator (P box + margin)
    if (isRace && settings.showGridChange) w += 24;
    if (!isRace && settings.showBestLapTime) w += 60; // best lap time column
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

  return (
    <div
      className="replay-page-enter h-dvh flex flex-col bg-f1-dark overflow-hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
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
              <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileTrackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className={`flex-1 relative bg-black/40 overflow-hidden transition-all duration-300 ${!mobileTrackOpen ? "hidden" : "block"}`}>
              {/* Mobile zoom controls */}
              <div className="absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-f1-card/90 backdrop-blur-sm shadow-lg">
                <button
                  type="button"
                  onClick={() => setMobileTrackZoom((z) => Math.min(2.2, Math.round((z + 0.15) * 100) / 100))}
                  className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                  aria-label="Zoom in"
                >
                  <span className="text-lg font-extrabold leading-none">+</span>
                </button>
                <div className="h-px bg-white/10" />
                <button
                  type="button"
                  onClick={() => setMobileTrackZoom((z) => Math.max(0.8, Math.round((z - 0.15) * 100) / 100))}
                  className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                  aria-label="Zoom out"
                >
                  <span className="text-lg font-extrabold leading-none">−</span>
                </button>
              </div>
              <TrackCanvas
                trackPoints={trackPoints}
                rotation={rotation}
                trackStatus={trackStatus}
                drivers={drivers.filter((d) => !d.retired && !d.no_timing && !d.finished && (d.x !== 0 || d.y !== 0) && d.x > -0.5 && d.x < 1.5 && d.y > -0.5 && d.y < 1.5).map((d) => ({
                  abbr: d.abbr,
                  x: d.x,
                  y: d.y,
                  color: d.color,
                  position: d.position,
                }))}
                highlightedDrivers={selectedDrivers}
                playbackSpeed={replay.speed}
                showDriverNames={settings.showDriverNames}
                sectorOverlay={sectorOverlay}
                zoom={mobileTrackZoom}
                corners={settings.showCorners ? trackData?.corners : null}
                marshalSectors={trackData?.marshal_sectors}
                sectorFlags={replay.frame?.sector_flags}
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
                  ? telemetryPosition === "left"
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
                          const upper = rc.message.toUpperCase();
                          const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
                          const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
                          const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
                          return (
                            <div key={i} className="px-3 py-2">
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
                  drivers={drivers.filter((d) => !d.retired && !d.no_timing && !d.finished && (d.x !== 0 || d.y !== 0) && d.x > -0.5 && d.x < 1.5 && d.y > -0.5 && d.y < 1.5).map((d) => ({
                    abbr: d.abbr,
                    x: d.x,
                    y: d.y,
                    color: d.color,
                    position: d.position,
                  }))}
                  highlightedDrivers={selectedDrivers}
                  playbackSpeed={replay.speed}
                  showDriverNames={settings.showDriverNames}
                  sectorOverlay={sectorOverlay}
                  zoom={enableTrackZoom ? mobileTrackZoom : 1}
                  corners={settings.showCorners ? trackData?.corners : null}
                  marshalSectors={trackData?.marshal_sectors}
                  sectorFlags={replay.frame?.sector_flags}
                />
                
                {/* iPad zoom controls (same UI as iPhone) */}
                {enableTrackZoom && (
                  <div className="absolute right-3 bottom-14 z-20 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-f1-card/90 backdrop-blur-sm shadow-lg">
                    <button
                      type="button"
                      onClick={() => setMobileTrackZoom((z) => Math.min(2.2, Math.round((z + 0.15) * 100) / 100))}
                      className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                      aria-label="Zoom in"
                    >
                      <span className="text-lg font-extrabold leading-none">+</span>
                    </button>
                    <div className="h-px bg-white/10" />
                    <button
                      type="button"
                      onClick={() => setMobileTrackZoom((z) => Math.max(0.8, Math.round((z - 0.15) * 100) / 100))}
                      className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                      aria-label="Zoom out"
                    >
                      <span className="text-lg font-extrabold leading-none">−</span>
                    </button>
                  </div>
                )}
                
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

                {/* Desktop telemetry toggle */}
                <div className="absolute bottom-0 right-3 z-20 flex items-center gap-1 pb-2">
                  <button
                    onClick={() => setShowTelemetry(!showTelemetry)}
                    className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                      showTelemetry ? "bg-f1-red/20 border-f1-red/50 text-f1-red hover:text-white" : "bg-f1-card/90 border-f1-border text-f1-muted hover:text-white backdrop-blur-sm"
                    }`}
                  >
                    {showTelemetry ? "Hide" : "Show"} Telemetry
                  </button>
                </div>
                </div>
              </div>

              {/* Expanded telemetry panel for 3+ drivers */}
              {showTelemetry && selectedDrivers.length > 2 && (
                <div
                className={`flex-shrink-0 relative ${
                  telemetryPosition === "left"
                    ? "h-full glass-panel-heavy border-r border-f1-border order-first px-3 py-2 overflow-y-auto overflow-x-hidden"
                    : "glass-panel-heavy border-t border-f1-border py-1 flex flex-col overflow-hidden h-56 max-h-[40vh]"
                }`}
                >
                  <div
                    ref={telemetryPanelRef}
                    className={
                      telemetryPosition === "bottom"
                        ? "inline-block glass-panel-heavy px-3 pt-1 flex flex-col flex-1 min-h-0"
                        : ""
                    }
                  >
                    <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-f1-muted uppercase">Telemetry</span>
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
                  <button
                    onClick={() => setShowTelemetry(false)}
                    className="px-1.5 py-0.5 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors ml-auto"
                  >
                    Hide
                  </button>
                </div>
                <div
                  className={`gap-1 ${
                    telemetryPosition === "bottom"
                      ? "flex flex-col overflow-y-auto flex-1 min-h-0 pr-1"
                      : "flex flex-col"
                  }`}
                >
                  {selectedDrivers.map((abbr) => {
                    const drv = drivers.find((d) => d.abbr === abbr) || null;
                    return (
                      <div key={abbr}>
                        <TelemetryChart visible driver={drv} year={year} isQualifying={isQualifying} useImperial={settings.useImperial} />
                      </div>
                    );
                  })}
                </div>
              </div>
              {!rcPinned && (
                <div className={`flex items-center justify-center ${
                  telemetryPosition === "bottom"
                    ? "border-l border-f1-border px-4"
                    : "border-t border-f1-border py-2 mt-2"
                }`}>
                  <button
                    onClick={() => { setRcPinned(true); setRcPanelOpen(false); setRcPosition(null); }}
                    className="px-2 py-1 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                  >
                    Show Race Control
                  </button>
                </div>
              )}
              {rcPinned && (
                <div
                  className={`glass-panel-heavy ${
                    telemetryPosition === "bottom"
                      ? "border-l border-f1-border px-3 pt-1 flex-1 overflow-hidden flex flex-col"
                      : "border-t border-f1-border px-3 py-2 mt-2"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-f1-muted uppercase">Race Control</span>
                    <button
                      onClick={() => setRcPinned(false)}
                      className="px-1.5 py-0.5 text-[9px] font-bold text-f1-muted hover:text-white border border-f1-border rounded transition-colors"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="divide-y divide-f1-border/50 flex-1 overflow-y-auto">
                    {(() => {
                      const allMsgs = replay.frame?.rc_messages || [];
                      if (allMsgs.length === 0) return <p className="text-f1-muted text-xs py-2 text-center">No messages yet</p>;
                      return allMsgs.map((rc, i) => {
                        const upper = rc.message.toUpperCase();
                        const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
                        const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
                        const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
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
              )}
            </div>
            </div>
          )}

          {/* Widgets that scroll below map on mobile */}
          <div
            className={
              isMobile ? "flex min-w-0 flex-1 flex-col overflow-y-auto pb-24" : "flex min-w-0 flex-shrink-0 flex-col overflow-x-visible"
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
                  <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileRcOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {mobileRcOpen && (() => {
                  const latest = (replay.frame?.rc_messages || [])[0];
                  if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
                  const upper = latest.message.toUpperCase();
                  const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
                  const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
                  const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
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
                  <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileTelemetryOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
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
            <div className="bg-f1-dark sticky bottom-0 z-50 sm:relative sm:z-10">
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
              />
            </div>

            {/* Leaderboard - Mobile Inline version */}
            {isMobile && settings.showLeaderboard && (
              <div className="border-t border-f1-border pb-10">
                <button
                  onClick={() => setMobileLeaderboardOpen(!mobileLeaderboardOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
                >
                  <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                  <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileLeaderboardOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
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
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Leaderboard Column */}
        {!isMobile && settings.showLeaderboard && (
          <div className="border-l border-f1-border flex-shrink-0" style={{ width: Math.ceil(leaderboardWidth * leaderboardScale) }}>
            <Leaderboard
              drivers={drivers}
              highlightedDrivers={selectedDrivers}
              onDriverClick={handleDriverClick}
              settings={settings}
              currentTime={replay.frame?.timestamp || 0}
              isRace={isRace}
              isQualifying={isQualifying}
              onScaleChange={setLeaderboardScale}
            />
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
                    drivers={drivers.filter((d) => !d.retired && !d.no_timing && !d.finished && (d.x !== 0 || d.y !== 0) && d.x > -0.5 && d.x < 1.5 && d.y > -0.5 && d.y < 1.5).map((d) => ({
                      abbr: d.abbr,
                      x: d.x,
                      y: d.y,
                      color: d.color,
                      position: d.position,
                    }))}
                    highlightedDrivers={selectedDrivers}
                    playbackSpeed={replay.speed}
                    showDriverNames={settings.showDriverNames}
                    sectorOverlay={sectorOverlay}
                    compact={true}
                    corners={settings.showCorners ? trackData?.corners : null}
                    marshalSectors={trackData?.marshal_sectors}
                    sectorFlags={replay.frame?.sector_flags}
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
                const latest = (replay.frame?.rc_messages || [])[0];
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
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipTelemetryOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
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
                    currentTime={replay.frame?.timestamp || 0}
                    isRace={isRace}
                    isQualifying={isQualifying}
                    compact
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
