"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { SPEED_OPTIONS } from "@/lib/constants";
import { QualiPhase, QualiPhaseInfo } from "@/hooks/useReplaySocket";
import { Maximize, Minimize, MoreHorizontal } from "lucide-react";

const SKIP_OPTIONS = [
  { label: "5s", seconds: 5 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];

const PLAYBAR_ICON_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-f1-muted shadow-sm transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white active:bg-white/[0.12]";

type RaceExtrasMenuClusterProps = {
  onSyncPhoto?: () => void;
  onPiP?: () => void;
  pipActive?: boolean;
};

/** Sync + PiP dietro un’unica icona (⋯), con menu portaled — istanza separata per mobile/desktop. */
function RaceExtrasMenuCluster({ onSyncPhoto, onPiP, pipActive }: RaceExtrasMenuClusterProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setCoords({ left: r.left + r.width / 2, top: r.top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popupRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  if (!onSyncPhoto && !onPiP) return null;

  const portal =
    open &&
    coords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={popupRef}
        className="fixed z-[300] min-w-[220px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1a26] py-1 shadow-2xl backdrop-blur-xl"
        style={{
          left: coords.left,
          top: coords.top,
          transform: "translate(-50%, calc(-100% - 8px))",
        }}
        onClick={(e) => e.stopPropagation()}
        role="menu"
      >
        {onSyncPhoto && (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onSyncPhoto();
              setOpen(false);
            }}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Sync with onboard
          </button>
        )}
        {onPiP && (
          <button
            type="button"
            role="menuitem"
            className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-bold transition-colors hover:bg-white/10 hover:text-white ${
              pipActive ? "bg-f1-red/15 text-white" : "text-f1-muted"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onPiP();
              setOpen(false);
            }}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="14" rx="2" ry="2" />
              <path d="M12 11h6v6h-6z" />
            </svg>
            Picture-in-Picture
            {pipActive && <span className="ml-auto text-[10px] font-extrabold uppercase tracking-wide text-f1-red">On</span>}
          </button>
        )}
      </div>,
      document.body,
    );

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`${PLAYBAR_ICON_BTN} relative ${open ? "border-white/20 bg-white/10 text-white" : ""} ${pipActive ? "ring-1 ring-f1-red/35" : ""}`}
        title="Sync, Picture-in-Picture…"
        aria-label="More race tools"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
      </button>
      {portal}
    </div>
  );
}

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
  const [speedMenuCoords, setSpeedMenuCoords] = useState<{ left: number; top: number } | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  /** Keeps bar + clock on the chosen time until the server frame updates `currentTime` (avoids snap-back after scrub/click). */
  const [committedTime, setCommittedTime] = useState<number | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const speedPopupRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubStateRef = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubClientXRef = useRef<number | null>(null);
  const ignoreNextClickRef = useRef(false);
  const prevCurrentTimeRef = useRef(currentTime);

  const timelineSeconds = scrubTime ?? committedTime ?? currentTime;
  const progress = totalTime > 0 ? (timelineSeconds / totalTime) * 100 : 0;
  const fillPct = Math.min(100, Math.max(0, progress));
  const isScrubbing = scrubTime !== null;
  const displayedSeconds = timelineSeconds;

  // Drop committed overlay once real playback time reflects the seek (or same-timestamp seek).
  useEffect(() => {
    if (committedTime === null) {
      prevCurrentTimeRef.current = currentTime;
      return;
    }
    const prev = prevCurrentTimeRef.current;
    if (Math.abs(currentTime - prev) > 0.001) {
      setCommittedTime(null);
    } else if (Math.abs(currentTime - committedTime) < 0.5) {
      setCommittedTime(null);
    }
    prevCurrentTimeRef.current = currentTime;
  }, [currentTime, committedTime]);

  function commitSeek(time: number) {
    const t = Math.max(0, Math.min(totalTime, time));
    setCommittedTime(t);
    onSeek(t);
  }

  const updateSpeedMenuPosition = useCallback(() => {
    if (!speedBtnRef.current) return;
    const r = speedBtnRef.current.getBoundingClientRect();
    setSpeedMenuCoords({ left: r.left + r.width / 2, top: r.top });
  }, []);

  useLayoutEffect(() => {
    if (!speedMenuOpen) {
      setSpeedMenuCoords(null);
      return;
    }
    updateSpeedMenuPosition();
  }, [speedMenuOpen, updateSpeedMenuPosition]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    window.addEventListener("scroll", updateSpeedMenuPosition, true);
    window.addEventListener("resize", updateSpeedMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateSpeedMenuPosition, true);
      window.removeEventListener("resize", updateSpeedMenuPosition);
    };
  }, [speedMenuOpen, updateSpeedMenuPosition]);

  // Close speed menu on outside click (popup is portaled, so check both roots)
  useEffect(() => {
    if (!speedMenuOpen) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (speedMenuRef.current?.contains(t)) return;
      if (speedPopupRef.current?.contains(t)) return;
      setSpeedMenuOpen(false);
    }
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
    commitSeek(target);
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
    setCommittedTime(null);
    const bar = progressBarRef.current;
    if (bar) {
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    const target = getSeekTimeFromClientX(e.clientX);
    setScrubTime(target);
    pendingScrubClientXRef.current = e.clientX;
    scrubStateRef.current = { pointerId: e.pointerId, startX: e.clientX, moved: false };

    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const flushScrubFromPending = () => {
      scrubRafRef.current = null;
      const x = pendingScrubClientXRef.current;
      if (x == null || !scrubStateRef.current) return;
      setScrubTime(getSeekTimeFromClientX(x));
    };

    const onMove = (ev: PointerEvent) => {
      const st = scrubStateRef.current;
      if (!st || st.pointerId !== ev.pointerId) return;
      if (!st.moved && Math.abs(ev.clientX - st.startX) > 3) st.moved = true;
      pendingScrubClientXRef.current = ev.clientX;
      if (scrubRafRef.current == null) {
        scrubRafRef.current = window.requestAnimationFrame(flushScrubFromPending);
      }
    };

    const finishScrub = (ev: PointerEvent) => {
      const st = scrubStateRef.current;
      if (!st || st.pointerId !== ev.pointerId) return;
      if (scrubRafRef.current != null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubClientXRef.current = null;
      if (bar) {
        try {
          bar.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      }
      const finalTime = getSeekTimeFromClientX(ev.clientX);
      commitSeek(finalTime);
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

  /** Desktop: < lg solo ±1m ±5m; da lg anche ±5s ±30s; etichette corte sotto lg. */
  function skipVisibility(label: string): string {
    if (label === "5s" || label === "30s") return "hidden lg:inline-flex";
    return "";
  }

  function skipButtonText(label: string, backward: boolean): { compact: string; full: string } {
    const s = backward ? "-" : "+";
    const full = `${s}${label}`;
    if (label === "1m") return { compact: `${s}1`, full };
    if (label === "5m") return { compact: `${s}5`, full };
    return { compact: full, full };
  }

  /** Desktop secondary row: clear “button” affordance (like earlier playbar). */
  const desktopToolBtn =
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-f1-muted shadow-sm transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white active:bg-white/[0.12]";
  const desktopToolIconBtn = PLAYBAR_ICON_BTN;
  const lapSelector = isRace && (
    <div
      className="group relative flex h-9 min-w-0 shrink-0 cursor-pointer items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 px-1.5 shadow-sm transition-colors hover:border-white/15 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-f1-red/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#14141f] sm:gap-1 sm:px-2"
      title="Select lap"
    >
      {/* Visual Overlay — compatto per restare sulla stessa riga degli altri tool */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 px-0.5 pointer-events-none sm:gap-1">
        <span className="text-[8px] font-extrabold uppercase leading-none tracking-tight text-f1-muted/90 sm:text-[9px]">
          Lap
        </span>
        <div className="flex items-baseline gap-px font-mono tabular-nums">
          <span className="text-[10px] font-extrabold leading-none text-white sm:text-[11px]">{currentLap}</span>
          <span className="text-[9px] font-semibold leading-none text-f1-muted/80 sm:text-[10px]">/{totalLaps}</span>
        </div>
        <svg
          className="h-2.5 w-2.5 shrink-0 text-f1-muted/70 transition-colors group-hover:text-white/80 sm:h-3 sm:w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
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
      className="w-full h-1.5 bg-white/10 rounded-full cursor-pointer relative group hover:h-2.5 transition-[height] duration-150 ease-out select-none"
      style={{ touchAction: "none" }}
      onPointerDown={startScrub}
      onClick={(e) => {
        if (ignoreNextClickRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        commitSeek(pct * totalTime);
      }}
    >
      <div
        className="h-full bg-f1-red rounded-full relative shadow-[0_0_10px_rgba(225,6,0,0.3)]"
        style={{ width: `${fillPct}%`, transition: "none" }}
      >
        <div
          className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full transition-opacity shadow-[0_0_8px_rgba(255,255,255,0.8)] ${
            isScrubbing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>
    </div>
  );

  /* ─── Speed selector popup ─── */
  const speedMenuPortal =
    speedMenuOpen &&
    speedMenuCoords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={speedPopupRef}
        className="fixed z-[300] min-w-[128px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1a26] shadow-2xl backdrop-blur-xl"
        style={{
          left: speedMenuCoords.left,
          top: speedMenuCoords.top,
          transform: "translate(-50%, calc(-100% - 8px))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5 p-1.5">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSpeedChange(s);
                setSpeedMenuOpen(false);
              }}
              className={`w-full rounded-lg px-4 py-2 text-left text-sm font-bold transition-colors sm:py-2 ${
                speed === s ? "bg-f1-red text-white" : "text-f1-muted hover:bg-white/10 hover:text-white"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );

  const speedSelector = (
    <div className="relative shrink-0" ref={speedMenuRef}>
      <button
        ref={speedBtnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSpeedMenuOpen((o) => !o);
        }}
        className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] font-bold text-f1-muted shadow-sm transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white active:bg-white/[0.12] touch-manipulation select-none lg:gap-1 lg:px-2.5"
      >
        <svg className="h-3.5 w-3.5 text-f1-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="tabular-nums text-white">{speed}x</span>
        <svg
          className={`h-3 w-3 opacity-70 transition-transform ${speedMenuOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {speedMenuPortal}
    </div>
  );

  /* ─── Mobile layout: niente PiP (solo desktop nel menu ⋯) ─── */
  const mobileLayout = (
    <div className="md:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0.5rem))" }}>
      <div className="px-3 pt-2 pb-1">
        {progressBar}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5">
        {playPauseBtn}
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-white font-mono tabular-nums-fixed">
          {formatTime(displayedSeconds)}
          {isRace && currentLap > 0 && <span className="ml-2 font-mono tabular-nums-fixed text-f1-muted">Lap {currentLap}</span>}
          {!isRace && qualiPhase && <span className="ml-2 font-sans text-f1-muted">{qualiPhase.phase}</span>}
        </span>
        {speedSelector}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-f1-muted transition-colors hover:bg-white/10"
          aria-expanded={expanded}
          aria-label={expanded ? "Nascondi controlli extra" : "Mostra controlli extra"}
        >
          <svg className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-white/5 px-3 pb-2 pt-2">
          <div className="flex flex-wrap items-center justify-center gap-1">
            {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => (
              <button
                key={`back-${label}`}
                type="button"
                onClick={() => skip(-seconds)}
                className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white"
              >
                -{label}
              </button>
            ))}
            <span className="w-2 shrink-0" />
            {SKIP_OPTIONS.map(({ label, seconds }) => (
              <button
                key={`fwd-${label}`}
                type="button"
                onClick={() => skip(seconds)}
                className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white"
              >
                +{label}
              </button>
            ))}
          </div>
          {qualiPhases && qualiPhases.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {qualiPhases.map((qp) => (
                <button
                  key={qp.phase}
                  type="button"
                  onClick={() => commitSeek(qp.timestamp)}
                  className={`rounded px-2.5 py-1.5 text-xs font-bold transition-colors ${
                    qualiPhase?.phase === qp.phase ? "bg-f1-red text-white" : "bg-white/5 text-f1-muted hover:text-white"
                  }`}
                >
                  {qp.phase}
                </button>
              ))}
            </div>
          )}
          {isRace && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {onSyncPhoto && (
                <button
                  type="button"
                  onClick={onSyncPhoto}
                  className="rounded border border-white/10 px-3 py-1.5 text-xs font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                  Sync
                </button>
              )}
              {onSeekToLap && (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-extrabold text-white">Lap</span>
                  <select
                    value={currentLap}
                    onChange={(e) => onSeekToLap(Number(e.target.value))}
                    className="cursor-pointer rounded bg-white/10 px-2 py-1 text-xs font-extrabold text-white outline-none"
                  >
                    {Array.from({ length: totalLaps }, (_, i) => i + 1).map((lap) => (
                      <option key={lap} value={lap} className="bg-f1-card text-white">
                        {lap}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs font-extrabold text-white">/{totalLaps}</span>
                </div>
              )}
            </div>
          )}
          {!isRace && qualiPhase && (
            <div className="flex items-center justify-center gap-4">
              <span className="text-xs font-extrabold text-white">{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="block text-[9px] font-bold uppercase text-f1-muted">Remaining</span>
                <span className="text-xs font-extrabold tabular-nums text-white">{formatTime(qualiPhase.remaining)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ─── Desktop layout ─── */
  const desktopLayout = (
    <div className="hidden min-w-0 max-w-full md:block px-5 py-3">
      <div className="mb-3">{progressBar}</div>

      {/* <lg: tutto centrato. lg+: griglia — centro comprimibile + skip scrollabili, destra `auto` così 1x/LAP/⋯/FS restano sempre visibili. */}
      <div className="flex w-full min-w-0 max-w-full flex-col gap-3 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-x-4">
        <div className="flex w-full min-w-0 items-center justify-center gap-4 lg:w-auto lg:justify-start">
          <span className="whitespace-nowrap font-mono text-sm font-extrabold tabular-nums-fixed tracking-tight text-white">
            {formatTime(displayedSeconds)}
            {showSessionTime && (
              <span className="ml-1 hidden font-normal text-f1-muted opacity-80 md:inline">/ {formatTime(totalTime)}</span>
            )}
          </span>
          {!isRace && qualiPhase && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate rounded bg-white/10 px-2 py-0.5 text-xs font-extrabold text-white">{qualiPhase.phase}</span>
              <span className="hidden font-mono text-xs font-bold text-f1-muted lg:inline">{formatTime(qualiPhase.remaining)}</span>
            </div>
          )}
          {!isRace && !qualiPhase && (
            <span className="hidden font-mono text-xs font-bold text-f1-muted lg:inline">
              {formatTime(Math.max(0, totalTime - currentTime))}
            </span>
          )}
        </div>

        <div className="flex w-full min-w-0 max-w-full items-center justify-center gap-2 sm:gap-3 lg:min-w-0">
          {/* rtl: scroll come a destra — i salti verso il play restano visibili, il resto è trascinabile */}
          <div className="min-w-0 flex-1 basis-0 overflow-x-auto overflow-y-visible" dir="rtl">
            <div className="inline-flex flex-nowrap items-center gap-0.5" dir="ltr">
              {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => {
                const t = skipButtonText(label, true);
                return (
                  <button
                    key={`back-${label}`}
                    type="button"
                    onClick={() => skip(-seconds)}
                    className={`shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white ${skipVisibility(label)}`}
                    title={`Back ${label}`}
                  >
                    <span className="lg:hidden">{t.compact}</span>
                    <span className="hidden lg:inline">{t.full}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {playPauseBtn}
          <div className="flex min-w-0 flex-1 basis-0 flex-nowrap items-center justify-start gap-0.5 overflow-x-auto overflow-y-visible">
            {SKIP_OPTIONS.map(({ label, seconds }) => {
              const t = skipButtonText(label, false);
              return (
              <button
                key={`fwd-${label}`}
                type="button"
                onClick={() => skip(seconds)}
                className={`shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-bold text-f1-muted transition-colors hover:bg-white/10 hover:text-white ${skipVisibility(label)}`}
                title={`Forward ${label}`}
              >
                <span className="lg:hidden">{t.compact}</span>
                <span className="hidden lg:inline">{t.full}</span>
              </button>
            );})}
          </div>
        </div>

        {/* <lg: centrato; lg+: colonna a larghezza contenuto — non competere con gli skip scrollabili */}
        <div className="flex w-full min-w-0 max-w-full justify-center py-0.5 lg:w-max lg:shrink-0 lg:justify-self-end">
          <div className="flex shrink-0 flex-nowrap items-center justify-center gap-1 overflow-x-auto overflow-y-visible py-0.5 sm:gap-1.5 lg:justify-end">
            <div className="shrink-0">{speedSelector}</div>

            {isRace && (
            <>
              {lapSelector}
              <RaceExtrasMenuCluster onSyncPhoto={onSyncPhoto} onPiP={onPiP} pipActive={pipActive} />
              {onFullscreen && (
                <button
                  type="button"
                  onClick={onFullscreen}
                  className={desktopToolIconBtn}
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              )}
            </>
            )}

            {!isRace && qualiPhase && (
            <div className="flex min-w-0 flex-nowrap items-end justify-end gap-3 overflow-x-auto overflow-y-visible sm:gap-4">
              <span className="text-sm font-extrabold text-white">{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="block text-[10px] font-bold uppercase text-f1-muted">Remaining</span>
                <span className="text-sm font-extrabold tabular-nums text-white">{formatTime(qualiPhase.remaining)}</span>
              </div>
              <div className="text-center">
                <span className="block text-[10px] font-bold uppercase text-f1-muted">Elapsed</span>
                <span className="text-sm font-extrabold tabular-nums text-f1-muted">{formatTime(currentTime)}</span>
              </div>
              {showSessionTime && (
                <div className="text-center">
                  <span className="block text-[10px] font-bold uppercase text-f1-muted">Total</span>
                  <span className="text-sm font-extrabold tabular-nums text-f1-muted">{formatTime(Math.max(0, totalTime - currentTime))}</span>
                </div>
              )}
            </div>
            )}

            {!isRace && !qualiPhase && qualiPhases && qualiPhases.length > 0 && (
            <div className="flex min-w-0 max-w-full flex-nowrap items-center justify-end gap-2 overflow-x-auto overflow-y-visible">
              {qualiPhases.map((qp) => (
                <button
                  key={qp.phase}
                  type="button"
                  onClick={() => commitSeek(qp.timestamp)}
                  className={desktopToolBtn + " px-3"}
                >
                  {qp.phase}
                </button>
              ))}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 min-w-0 max-w-full overflow-x-visible bg-f1-dark/95 border-t border-white/5 backdrop-blur-xl sm:relative sm:z-auto sm:flex-shrink-0 sm:mx-3 sm:mb-3 sm:overflow-x-visible sm:rounded-xl sm:border sm:border-white/[0.08] sm:bg-[rgba(20,20,30,0.75)] sm:shadow-[0_0_40px_rgba(0,0,0,0.6)] sm:backdrop-blur-2xl">
      {mobileLayout}
      {desktopLayout}
    </div>
  );
}