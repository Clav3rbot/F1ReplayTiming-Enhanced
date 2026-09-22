"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface TourStep {
  /** `data-tour` value of the element to spotlight; "a,b" tries a then b. Omit for a centred intro/outro card. */
  target?: string;
  title: string;
  /** A function gets `finish` to end the tour from inside the card (counts as completed, fires onFinish). */
  body: ReactNode | ((ctx: { finish: () => void }) => ReactNode);
  /** Hide the Next button when the body provides its own call to action. */
  hideNext?: boolean;
  /** Extra spotlight room above the target, for overlays drawn outside its box (e.g. the timeline curve). */
  padTop?: number;
}

interface Props {
  /** Storage id: the tour shows once per browser until finished or skipped. */
  id: string;
  steps: TourStep[];
  /** Delay before the first automatic start, so the page can settle. */
  startDelayMs?: number;
  /** Called when the tour is completed (not when skipped). */
  onFinish?: () => void;
}

/** Fired by "Replay tutorial" in settings; any mounted tour restarts. */
export const TOUR_RESTART_EVENT = "f1replay:tour-restart";

const STORAGE_PREFIX = "f1replay_tour_";
const PAD = 8; // spotlight padding around the target
const GAP = 14; // distance between spotlight and card
const EDGE = 16; // min distance from the viewport edge
const MISSING_TARGET_POLLS = 8; // ~1.6s waiting for a target (async content) before skipping its step

/** Clears every tour's "seen" flag (so the home tour shows again too) and restarts the mounted one. */
export function restartTours() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(TOUR_RESTART_EVENT));
}

function isDone(id: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === "done";
  } catch {
    return true; // no storage (private mode etc.): don't nag on every visit
  }
}

function markDone(id: string) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, "done");
  } catch {
    /* ignore */
  }
}

/** First visible element with this data-tour value (layouts render some regions twice, one hidden). */
function findTarget(names: string): HTMLElement | null {
  for (const name of names.split(",")) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name.trim()}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

type Rect = { top: number; left: number; width: number; height: number };

export default function GuidedTour({ id, steps, startDelayMs = 700, onFinish }: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<1 | -1>(1);
  const missesRef = useRef(0);

  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (isDone(id)) return;
    const t = window.setTimeout(() => setOpen(true), startDelayMs);
    return () => window.clearTimeout(t);
  }, [id, startDelayMs]);

  useEffect(() => {
    const restart = () => {
      directionRef.current = 1;
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_RESTART_EVENT, restart);
    return () => window.removeEventListener(TOUR_RESTART_EVENT, restart);
  }, []);

  const close = useCallback(() => {
    markDone(id);
    setOpen(false);
  }, [id]);

  const finish = useCallback(() => {
    close();
    onFinish?.();
  }, [close, onFinish]);

  const go = useCallback(
    (delta: 1 | -1) => {
      directionRef.current = delta;
      missesRef.current = 0;
      const next = index + delta;
      if (next >= steps.length) finish();
      else setIndex(Math.max(0, next));
    },
    [index, steps.length, finish],
  );

  // Track the target: position can change (layout, scroll, async content), so poll while open.
  useEffect(() => {
    if (!open || !step) return;
    missesRef.current = 0;
    let scrolled = false;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = findTarget(step.target);
      if (!el) {
        setRect(null);
        missesRef.current += 1;
        if (missesRef.current >= MISSING_TARGET_POLLS) {
          // Not on this layout (e.g. mobile): skip the step in the direction of travel
          if (index + directionRef.current < 0) go(1);
          else go(directionRef.current);
        }
        return;
      }
      missesRef.current = 0;
      let r = el.getBoundingClientRect();
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        r = el.getBoundingClientRect();
      }
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const iv = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("resize", measure);
    };
  }, [open, step, index, go]);

  // Expose the current step on <html> so components can reveal hover-only UI while it is explained.
  useEffect(() => {
    if (!open || !step?.target) return;
    document.documentElement.dataset.tourStep = step.target;
    return () => {
      delete document.documentElement.dataset.tourStep;
    };
  }, [open, step]);

  // Card placement: below the spotlight, else above, else centred in the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = card?.offsetWidth ?? 352;
    const h = card?.offsetHeight ?? 220;
    const centred = { top: Math.max(EDGE, (vh - h) / 2), left: Math.max(EDGE, (vw - w) / 2) };
    if (!rect || !step?.target) {
      setCardPos(centred);
      return;
    }
    const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - w / 2), vw - w - EDGE);
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - (step.padTop ?? 0) - GAP - h;
    if (below + h <= vh - EDGE) setCardPos({ top: below, left });
    else if (above >= EDGE) setCardPos({ top: above, left });
    else setCardPos(centred);
  }, [open, rect, step, index]);

  // Keyboard: capture phase on window so page shortcuts (Space = play) don't fire underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (!step?.hideNext) go(1);
      }
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, go, close, step]);

  if (!open || !step) return null;

  const spot = step.target && rect;

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
      {/* Click shield: the page stays visible but inert while the tour runs */}
      <div className="absolute inset-0" />
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            top: rect.top - PAD - (step.padTop ?? 0),
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2 + (step.padTop ?? 0),
            boxShadow:
              "0 0 0 9999px rgba(4,4,9,0.76), 0 0 0 1.5px rgba(225,6,0,0.9), 0 0 28px 2px rgba(225,6,0,0.35)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-[rgba(4,4,9,0.76)] transition-opacity duration-300" />
      )}

      <div
        ref={cardRef}
        key={index}
        className="absolute w-[min(22rem,calc(100vw-2rem))] animate-[tour-in_0.35s_cubic-bezier(0.22,1,0.36,1)] overflow-hidden rounded-2xl border border-white/10 bg-[#161620]/95 bg-glass-gradient shadow-2xl shadow-black/60 ring-1 ring-inset ring-white/[0.05] backdrop-blur-xl transition-[top,left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={cardPos ?? { top: -9999, left: -9999 }}
      >
        <div className="h-[2px] bg-white/[0.06]">
          <div
            className="h-full bg-f1-red shadow-[0_0_10px_rgba(225,6,0,0.6)] transition-[width] duration-500"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-f1-red">
              Tour · {index + 1}/{steps.length}
            </span>
            {!last && (
              <button
                onClick={close}
                className="text-[11px] font-bold uppercase tracking-wider text-f1-muted transition-colors hover:text-white"
              >
                Skip
              </button>
            )}
          </div>
          <h3 id="guided-tour-title" className="text-base font-extrabold tracking-tight text-white">
            {step.title}
          </h3>
          <div className="mt-1.5 text-sm leading-relaxed text-f1-muted">
            {typeof step.body === "function" ? step.body({ finish }) : step.body}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1" aria-hidden>
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-4 bg-f1-red" : i < index ? "w-1.5 bg-white/40" : "w-1.5 bg-white/15"
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  onClick={() => go(-1)}
                  className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/10"
                >
                  Back
                </button>
              )}
              {!step.hideNext && (
              <button
                onClick={() => go(1)}
                autoFocus
                className="rounded-full bg-f1-red px-4 py-1.5 text-xs font-bold text-white transition-shadow hover:shadow-[0_4px_15px_rgba(225,6,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {index === 0 ? "Start" : last ? "Got it" : "Next"}
              </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
