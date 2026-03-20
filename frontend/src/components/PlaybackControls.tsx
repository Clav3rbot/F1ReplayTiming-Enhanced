"use client";

import { useState, useRef, useEffect } from "react";
import { SPEED_OPTIONS } from "@/lib/constants";
import { QualiPhase, QualiPhaseInfo } from "@/hooks/useReplaySocket";
import { Maximize, Minimize } from "lucide-react";

const SKIP_OPTIONS = [
  { label: "5s", seconds: 5 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];

interface Props {
  playing: boolean;
  speed: number;
  currentTime: number;
  totalTime: number;
  currentLap: number;
  totalLaps: number;
  finished: boolean;
  showSessionTime: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (time: number) => void;
  onReset: () => void;
  onSeekToLap?: (lap: number) => void;
  isRace?: boolean;
  onSyncPhoto?: () => void;
  onPiP?: () => void;
  pipActive?: boolean;
  onFullscreen?: () => void;
  fullscreen?: boolean;
  qualiPhase?: QualiPhase | null;
  qualiPhases?: QualiPhaseInfo[];
}

export default function PlaybackControls({
  playing,
  speed,
  currentTime,
  totalTime,
  currentLap,
  totalLaps,
  finished,
  showSessionTime,
  onPlay,
  onPause,
  onSpeedChange,
  onSeek,
  onReset,
  onSeekToLap,
  isRace,
  onSyncPhoto,
  onPiP,
  pipActive,
  onFullscreen,
  fullscreen,
  qualiPhase,
  qualiPhases,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubStateRef = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
  const ignoreNextClickRef = useRef(false);
  const progress = totalTime > 0 ? ((scrubTime ?? currentTime) / totalTime) * 100 : 0;

  // Close speed menu on outside click
  useEffect(() => {
    if (!speedMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false);
      }
    }
    // Use 'click' instead of 'mousedown' to avoid race conditions with touch events
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [speedMenuOpen]);

  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function skip(delta: number) {
    const target = Math.max(0, Math.min(totalTime, currentTime + delta));
    onSeek(target);
  }

  function getSeekTimeFromClientX(clientX: number): number {
    const el = progressBarRef.current;
    if (!el || totalTime <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * totalTime;
  }

  const startScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (totalTime <= 0) return;
    const target = getSeekTimeFromClientX(e.clientX);
    setScrubTime(target);
    scrubStateRef.current = { pointerId: e.pointerId, startX: e.clientX, moved: false };

    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const st = scrubStateRef.current;
      if (!st || st.pointerId !== ev.pointerId) return;
      if (!st.moved && Math.abs(ev.clientX - st.startX) > 3) st.moved = true;
      const next = getSeekTimeFromClientX(ev.clientX);
      setScrubTime(next);
    };

    const finishScrub = (ev: PointerEvent) => {
      const st = scrubStateRef.current;
      if (!st || st.pointerId !== ev.pointerId) return;
      const finalTime = getSeekTimeFromClientX(ev.clientX);
      onSeek(finalTime);
      // Prevent synthetic click after pointer interaction from re-seeking.
      ignoreNextClickRef.current = true;
      window.setTimeout(() => { ignoreNextClickRef.current = false; }, 0);
      setScrubTime(null);
      scrubStateRef.current = null;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishScrub);
      window.removeEventListener("pointercancel", finishScrub);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishScrub);
    window.addEventListener("pointercancel", finishScrub);
  };

  // Control visibility of skip buttons at different widths to keep UI clean
  function skipVisibility(label: string): string {
    if (label === "5m") return "hidden xl:inline-flex";
    if (label === "1m") return "hidden lg:inline-flex";
    return "";
  }

  const lapSelector = isRace && (
    <div className="group relative flex items-center gap-2 bg-white/5 hover:bg-white/10 rounded-lg px-3 h-9 flex-shrink-0 border border-white/10 hover:border-white/20 transition-all duration-300 focus-within:ring-2 focus-within:ring-f1-red/50 focus-within:border-f1-red/40 focus-within:shadow-[0_0_15px_rgba(225,6,0,0.4)] cursor-pointer">
      {/* Visual Overlay - Content is non-interactive to let the select beneath capture clicks */}
      <div className="flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider mb-[1px]">
          Lap
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono font-extrabold text-white leading-none">
            {currentLap}
          </span>
          <span className="text-xs font-mono font-bold text-f1-muted whitespace-nowrap leading-none">
            / {totalLaps}
          </span>
          <svg
            className="w-3 h-3 text-f1-muted group-hover:text-white transition-colors ml-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Hidden Select - Covers the entire box to make everything clickable */}
      <select
        value={currentLap}
        onFocus={(e) => {
          e.currentTarget.setAttribute("data-was-focused", "true");
        }}
        onBlur={(e) => {
          e.currentTarget.removeAttribute("data-was-focused");
        }}
        onClick={(e) => {
          if (e.currentTarget.getAttribute("data-was-focused") === "already") {
            e.currentTarget.blur();
          } else {
            e.currentTarget.setAttribute("data-was-focused", "already");
          }
        }}
        onChange={(e) => {
          const lap = Number(e.target.value);
          if (onSeekToLap) onSeekToLap(lap);
          e.currentTarget.blur();
        }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 lap-select"
        title="Click to select lap"
        aria-label="Select lap"
      >
        {Array.from({ length: totalLaps }, (_, i) => i + 1).map((lap) => (
          <option key={lap} value={lap} className="bg-f1-card text-white">
            {lap}
          </option>
        ))}
      </select>
    </div>
  );

  /* ─── Shared sub-components ─── */

  const playPauseBtn = (
    <button
      onClick={finished ? onReset : playing ? onPause : onPlay}
      className="w-10 h-10 flex items-center justify-center bg-f1-red hover:bg-red-700 rounded-full transition-colors text-white flex-shrink-0 shadow-lg shadow-f1-red/30"
    >
      {finished ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
        </svg>
      ) : playing ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );

  const progressBar = (
    <div
      ref={progressBarRef}
      className="w-full h-1.5 bg-white/10 rounded-full cursor-pointer relative group hover:h-2.5 transition-all"
      style={{ touchAction: "none" }}
      onPointerDown={startScrub}
      onClick={(e) => {
        if (ignoreNextClickRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        onSeek(pct * totalTime);
      }}
    >
      <div
        className="h-full bg-f1-red rounded-full transition-all duration-100 relative shadow-[0_0_10px_rgba(225,6,0,0.3)]"
        style={{ width: `${progress}%` }}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
      </div>
    </div>
  );

  const pipButton = onPiP && (
    <button
      onClick={onPiP}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${pipActive
          ? "bg-f1-red text-white"
          : "text-f1-muted hover:text-white bg-white/5 hover:bg-white/10"
        }`}
      title="Picture-in-Picture"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="14" rx="2" ry="2" />
        <path d="M12 11h6v6h-6z" />
      </svg>
      PiP
    </button>
  );

  /* ─── Speed selector popup ─── */
  const speedSelector = (
    <div className="relative" ref={speedMenuRef}>
      <button
        onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
        className="flex items-center gap-1 px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/20 transition-colors text-xs font-bold text-white border border-white/10 touch-manipulation select-none"
      >
        <svg className="w-3.5 h-3.5 text-f1-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {speed}x
        <svg className={`w-3 h-3 text-f1-muted transition-transform ${speedMenuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Popup */}
      {speedMenuOpen && (
        <div 
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[#1a1a26] border border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl min-w-[120px] z-[60]"
          onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
        >
          <div className="p-1.5 flex flex-col gap-0.5">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={(e) => {
                  e.stopPropagation(); // Double ensure no propagation
                  onSpeedChange(s);
                  setSpeedMenuOpen(false);
                }}
                className={`w-full px-4 py-3 sm:py-2 text-sm font-bold rounded-lg transition-colors text-left ${speed === s
                    ? "bg-f1-red text-white"
                    : "text-f1-muted hover:text-white hover:bg-white/10"
                  }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  /* ─── Mobile layout ─── */
  const mobileLayout = (
    <div className="md:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0.5rem))" }}>
      <div className="px-3 pt-2 pb-1">
        {progressBar}
      </div>
      <div className="px-3 py-1.5 flex items-center gap-2">
        {playPauseBtn}
        <span className="text-sm font-extrabold text-white flex-1 font-mono tabular-nums-fixed">
          {formatTime(currentTime)}
          {isRace && currentLap > 0 && <span className="text-f1-muted ml-2 font-mono tabular-nums-fixed">Lap {currentLap}</span>}
          {!isRace && qualiPhase && <span className="text-f1-muted ml-2 font-sans">{qualiPhase.phase}</span>}
        </span>
        {speedSelector}
        {pipButton}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* Expanded mobile controls */}
      {expanded && (
        <div className="px-3 space-y-2 border-t border-white/5 pt-2 pb-2">
          <div className="flex items-center justify-center gap-1">
            {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => (
              <button key={`back-${label}`} onClick={() => skip(-seconds)}
                className="px-2.5 py-1.5 text-xs font-bold text-f1-muted hover:text-white rounded bg-white/5 hover:bg-white/10 transition-colors">
                -{label}
              </button>
            ))}
            <span className="w-2" />
            {SKIP_OPTIONS.map(({ label, seconds }) => (
              <button key={`fwd-${label}`} onClick={() => skip(seconds)}
                className="px-2.5 py-1.5 text-xs font-bold text-f1-muted hover:text-white rounded bg-white/5 hover:bg-white/10 transition-colors">
                +{label}
              </button>
            ))}
          </div>
          {qualiPhases && qualiPhases.length > 0 && (
            <div className="flex items-center justify-center gap-1">
              {qualiPhases.map((qp) => (
                <button key={qp.phase} onClick={() => onSeek(qp.timestamp)}
                  className={`px-2.5 py-1.5 text-xs font-bold rounded transition-colors ${qualiPhase?.phase === qp.phase ? "bg-f1-red text-white" : "bg-white/5 text-f1-muted hover:text-white"
                    }`}>
                  {qp.phase}
                </button>
              ))}
            </div>
          )}
          {isRace && (
            <div className="flex items-center justify-center gap-3">
              {onSyncPhoto && (
                <button onClick={onSyncPhoto} className="px-3 py-1.5 rounded border border-white/10 hover:bg-white/10 transition-colors text-f1-muted hover:text-white text-xs font-bold">
                  Sync
                </button>
              )}
              {onSeekToLap && lapSelector}
            </div>
          )}
          {!isRace && qualiPhase && (
            <div className="flex items-center justify-center gap-4">
              <span className="text-xs font-extrabold text-white">{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="text-[9px] font-bold text-f1-muted uppercase block">Remaining</span>
                <span className="text-xs font-extrabold text-white tabular-nums">{formatTime(qualiPhase.remaining)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ─── Desktop layout ─── */
  const desktopLayout = (
    <div className="hidden md:block px-5 py-3">
      {/* Progress bar */}
      <div className="mb-3">{progressBar}</div>

      {/* Controls row — column layout on md, 3-column grid on lg+ for predictable behavior */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-x-4 lg:gap-y-3 lg:items-center">

        {/* Left Column: Time & Session info */}
        <div className="col-span-12 lg:col-span-3 flex items-center justify-start gap-4 min-w-0">
          <span className="text-sm font-extrabold text-white font-mono tabular-nums-fixed tracking-tight whitespace-nowrap">
            {formatTime(currentTime)}
            {showSessionTime && (
              <span className="text-f1-muted ml-1 font-normal opacity-80 hidden md:inline">/ {formatTime(totalTime)}</span>
            )}
          </span>
          {!isRace && qualiPhase && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-extrabold text-white px-2 py-0.5 bg-white/10 rounded truncate">{qualiPhase.phase}</span>
              <span className="text-xs font-mono font-bold text-f1-muted hidden lg:inline">
                {formatTime(qualiPhase.remaining)}
              </span>
            </div>
          )}
          {!isRace && !qualiPhase && (
            <span className="text-xs font-mono font-bold text-f1-muted hidden lg:inline">
              {formatTime(Math.max(0, totalTime - currentTime))}
            </span>
          )}
        </div>

        {/* Center Column: Playback Controls */}
        <div className="col-span-12 lg:col-span-6 flex items-center justify-center gap-3 min-w-0">
          {/* Skip back */}
          <div className="flex items-center gap-0.5 flex-nowrap overflow-x-auto no-scrollbar min-w-0 max-w-[320px] lg:max-w-none">
            {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => (
              <button
                key={`back-${label}`}
                onClick={() => skip(-seconds)}
                className={`px-2 py-1.5 text-[11px] font-bold text-f1-muted hover:text-white rounded-lg hover:bg-white/10 transition-colors ${skipVisibility(label)}`}
                title={`Back ${label}`}
              >
                -{label}
              </button>
            ))}
          </div>

          {playPauseBtn}

          {/* Skip forward */}
          <div className="flex items-center gap-0.5 flex-nowrap overflow-x-auto no-scrollbar min-w-0 max-w-[320px] lg:max-w-none">
            {SKIP_OPTIONS.map(({ label, seconds }) => (
              <button
                key={`fwd-${label}`}
                onClick={() => skip(seconds)}
                className={`px-2 py-1.5 text-[11px] font-bold text-f1-muted hover:text-white rounded-lg hover:bg-white/10 transition-colors ${skipVisibility(label)}`}
                title={`Forward ${label}`}
              >
                +{label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Speed, Sync, PiP, Lap */}
        <div className="col-span-12 lg:col-span-3 flex flex-wrap items-center justify-center lg:justify-end gap-1.5 sm:gap-3 min-w-0">
          <div className="flex-shrink-0">{speedSelector}</div>

          {/* Dividing line if we have more tools */}
          {(isRace || (qualiPhases && qualiPhases.length > 0) || onSyncPhoto) && <div className="w-px h-4 bg-white/10 hidden xl:block" />}

          {isRace ? (
            <>
              {onSyncPhoto && (
                <button
                  onClick={onSyncPhoto}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-bold text-f1-muted hover:text-white hover:bg-white/10 transition-colors border border-transparent"
                  title="Sync with onboard video"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="hidden lg:inline">Sync</span>
                </button>
              )}
            </>
          ) : qualiPhase ? (
            <div className="flex items-end gap-4 ml-auto">
              <span className="text-sm font-extrabold text-white" style={{ marginBottom: 1, marginRight: -10 }}>{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Remaining</span>
                <span className="text-sm font-extrabold text-white tabular-nums">
                  {formatTime(qualiPhase.remaining)}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Elapsed</span>
                <span className="text-sm font-extrabold text-f1-muted tabular-nums">{formatTime(currentTime)}</span>
              </div>
              {showSessionTime && (
                <div className="text-center">
                  <span className="text-[10px] font-bold text-f1-muted uppercase block">Total</span>
                  <span className="text-sm font-extrabold text-f1-muted tabular-nums">{formatTime(Math.max(0, totalTime - currentTime))}</span>
                </div>
              )}
            </div>
          ) : (
            qualiPhases && qualiPhases.length > 0 && (
              <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar max-w-full">
                {qualiPhases.map((qp) => (
                  <button
                    key={qp.phase}
                    onClick={() => onSeek(qp.timestamp)}
                    className="px-2 py-1 text-xs font-bold rounded transition-colors whitespace-nowrap bg-white/5 text-f1-muted hover:text-white hover:bg-white/10"
                  >
                    {qp.phase}
                  </button>
                ))}
              </div>
            )
          )}

          <div className="flex-shrink-0 flex items-center gap-1.5">
            {onFullscreen && (
              <button
                onClick={onFullscreen}
                className="flex items-center justify-center w-9 h-9 rounded-lg text-f1-muted hover:text-white bg-white/5 hover:bg-white/10 transition-colors border border-transparent"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            )}
            {onPiP && (
              <button
                onClick={onPiP}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-bold transition-all ${pipActive
                    ? "bg-f1-red text-white border-f1-red"
                    : "text-f1-muted hover:text-white bg-white/5 hover:bg-white/10 border-transparent"
                  } border`}
                title="Picture-in-Picture"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="14" rx="2" ry="2" />
                  <path d="M12 11h6v6h-6z" />
                </svg>
                <span className="hidden lg:inline">PiP</span>
              </button>
            )}
          </div>

          {/* Dividing line before Lap */}
          {isRace && <div className="w-px h-4 bg-white/10 hidden xl:block" />}

          {/* Lap selector */}
          {lapSelector}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-f1-dark/95 border-t border-white/5 backdrop-blur-xl sm:relative sm:z-auto sm:flex-shrink-0 sm:mx-3 sm:mb-3 sm:rounded-xl sm:border sm:border-white/[0.08] sm:bg-[rgba(20,20,30,0.75)] sm:shadow-[0_0_40px_rgba(0,0,0,0.6)] sm:backdrop-blur-2xl">
      {mobileLayout}
      {desktopLayout}
    </div>
  );
}