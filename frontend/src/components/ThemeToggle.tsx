"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

// The theme lives in the "light" class on <html>, set before paint by the
// inline script in layout.tsx. Dark is the default.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getLight = () => document.documentElement.classList.contains("light");
// React can re-create <html> (dev Fast Refresh, hydration fallback) and drop
// the class the inline script added; put it back before paint.
export function ThemeSync() {
  useLayoutEffect(() => {
    try {
      document.documentElement.classList.toggle("light", localStorage.getItem("theme") === "light");
    } catch {}
  });
  return null;
}

// Animate the icon only after a real switch, not on first load
let switched = false;

const REVEAL_MS = 700;
// cubic-bezier control points of the reveal's easing
const EASE = [0.65, 0, 0.35, 1] as const;
// iOS Safari animates the status-bar colour itself after we change it; start
// that much before the band has covered the screen so both end together.
const STATUS_BAR_LEAD_MS = 200;

// Time fraction at which the reveal's easing reaches progress p
function easeTime(p: number) {
  const [x1, y1, x2, y2] = EASE;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    const y = 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
    if (y < p) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
}

// Clip-path for the theme reveal: a band slanted like "/" whose two long
// edges are chequered-flag teeth, q px squares in two columns. lc and rc are
// the edge positions at mid-height, t the tooth width (0 hides the teeth).
// Every call returns the same number of points, so the browser can
// interpolate between them; moving lc/rc slides each edge rigidly.
function flagBand(w: number, h: number, q: number, lc: number, rc: number, t: number) {
  const slant = h * 0.18;
  const rows = Math.ceil(h / q) + 1;
  const edge = (c: number, y: number) => c + slant * (0.5 - y / h);
  const pts: string[] = [];
  const p = (x: number, y: number) => pts.push(`${x.toFixed(1)}px ${y}px`);
  // Right edge, top to bottom. Even rows fill the inner column; odd rows
  // fill the outer one, joined to their neighbours only at the corners.
  for (let k = 0; k < rows; k++) {
    const ya = k * q, yb = ya + q, a = edge(rc, ya), b = edge(rc, yb);
    if (k % 2 === 0) {
      p(a + t, ya); p(b + t, yb);
    } else {
      p(a + t, ya); p(a + 2 * t, ya); p(b + 2 * t, yb); p(b + t, yb);
      p(a + t, ya); p(a, ya); p(b, yb); p(b + t, yb);
    }
  }
  // Left edge, bottom to top, mirrored
  for (let k = rows - 1; k >= 0; k--) {
    const ya = (k + 1) * q, yb = k * q, a = edge(lc, ya), b = edge(lc, yb);
    if (k % 2 === 0) {
      p(a - t, ya); p(b - t, yb);
    } else {
      p(a - t, ya); p(a - 2 * t, ya); p(b - 2 * t, yb); p(b - t, yb);
      p(a - t, ya); p(a, ya); p(b, yb); p(b - t, yb);
    }
  }
  return `polygon(${pts.join(",")})`;
}

// The new theme opens from the centre in a slanted chequered band, like a
// flag unfurling. Without View Transitions, or with reduced motion: instant swap.
function switchTheme() {
  const root = document.documentElement;
  const next = !getLight();
  switched = true;
  const swap = () => {
    root.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {}
    flushSync(() => listeners.forEach((cb) => cb()));
  };
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    swap();
    return;
  }
  // iOS Safari paints the status bar with the page's background-color (html
  // and body, read from style on every frame; background images and the
  // glass header are ignored). The swap flips it at once, while the reveal
  // is still mostly the old theme. --pin-bg holds the old colour until the
  // band has covered the screen; globals.css paints the new theme over it.
  root.style.setProperty("--pin-bg", getComputedStyle(root).getPropertyValue("--f1-dark"));
  root.classList.add("theme-switching");
  const transition = document.startViewTransition(swap);
  transition.ready
    .then(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const q = Math.round(Math.min(26, Math.max(16, Math.min(w, h) * 0.03)));
      const halfSlant = h * 0.09; // the band's edges at the top and bottom, from flagBand
      // Far enough out that the slanted edge and its teeth clear both sides
      const reach = halfSlant + 2 * q + 4;
      const mid = w / 2;
      const reveal = root.animate(
        {
          clipPath: [
            flagBand(w, h, q, mid, mid, 0),
            flagBand(w, h, q, mid, mid, q),
            flagBand(w, h, q, -reach, w + reach, q),
          ],
          offset: [0, 0.08, 1],
        },
        { duration: REVEAL_MS, easing: `cubic-bezier(${EASE.join(", ")})`, pseudoElement: "::view-transition-new(root)" },
      );
      // The screen is fully covered when the left edge reaches the top-left
      // corner (lc = -halfSlant), about 70% in; the rest is the easing tail
      // sliding off-screen. Release the status-bar colour a little before.
      const covered = 0.08 + (0.92 * (mid + halfSlant)) / (mid + reach);
      const releaseAt = easeTime(covered) * REVEAL_MS - STATUS_BAR_LEAD_MS;
      const tick = () => {
        if (Number(reveal.currentTime ?? Infinity) >= releaseAt) root.style.removeProperty("--pin-bg");
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
    .catch(() => {});
  transition.finished.finally(() => {
    root.classList.remove("theme-switching");
    root.style.removeProperty("--pin-bg");
  });
}

// Shows the theme the click leads to: sun on dark, moon on light.
// Sun and moon are one shape: the disc grows and a second circle "bites"
// it into a crescent while the rays pull in. Speed streaks trail behind
// on every switch, like a car leaving the grid.
function ThemeIcon({ light }: { light: boolean }) {
  const maskId = useId();
  return (
    <svg
      key={light ? "moon" : "sun"}
      className={`tt-icon ${light ? "is-moon" : "is-sun"}${switched ? "" : " tt-static"}`}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <mask id={maskId}>
        <rect x="-4" y="-4" width="32" height="32" fill="#fff" />
        <circle className="tt-bite" cx="17" cy="7" r="7" fill="#000" />
      </mask>
      <circle className="tt-core" cx="12" cy="12" r="9" fill="currentColor" mask={`url(#${maskId})`} />
      <g className="tt-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </g>
      <g className="tt-streaks" stroke="currentColor" strokeLinecap="round">
        <line x1="-3" y1="7" x2="-9" y2="7" strokeWidth="1.5" style={{ animationDelay: "0.05s" }} />
        <line x1="-2" y1="12" x2="-11" y2="12" strokeWidth="1.75" />
        <line x1="-3" y1="17" x2="-8" y2="17" strokeWidth="1.5" style={{ animationDelay: "0.1s" }} />
      </g>
    </svg>
  );
}

// className sets the look (size, colours); defaults to the home header style
export default function ThemeToggle({
  className = "w-9 h-9 rounded-md bg-ink/5 text-f1-text hover:bg-ink/10 hover:text-ink border border-transparent hover:border-ink/10",
}: {
  className?: string;
}) {
  // Server render has no <html> class to read: assume dark, the default
  const light = useSyncExternalStore(subscribe, getLight, () => false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.vibrate?.(8);
        switchTheme();
      }}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={light}
      title={light ? "Dark theme" : "Light theme"}
      className={`flex flex-shrink-0 items-center justify-center transition-[background-color,border-color,color,transform] active:scale-90 ${className}`}
    >
      <ThemeIcon light={light} />
    </button>
  );
}
