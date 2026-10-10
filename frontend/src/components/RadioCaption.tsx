"use client";

import type { CSSProperties } from "react";
import type { RadioMessage, ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  /** Transcribed clips, oldest first. */
  messages: RadioMessage[];
  /** Current time on the messages' clock: replay seconds, or epoch seconds live. */
  now: number;
  /** Clock seconds per wall-clock second (replay speed; 1 live), so a card stays up as long whatever the speed. */
  speed: number;
  drivers: ReplayDriver[];
  /** Session driver list, for the surname and car number. */
  roster: { abbreviation: string; driver_number: string; full_name: string }[];
  /** Position classes, e.g. "top-1/2 right-3 -translate-y-1/2". */
  className: string;
  /** Small maps (phones, PiP): a lower-third strip instead of the tall card, so the track stays visible. */
  compact?: boolean;
}

// Equaliser bars: tallest in the middle, jittered so it reads as a voice
const WAVE = Array.from({ length: 56 }, (_, i) => {
  const envelope = Math.exp(-(((i - 27.5) / 15) ** 2));
  return (0.12 + 0.88 * envelope) * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7)));
});
// Wall-clock seconds on screen: enough to read the clip
const READ_BASE = 8;
const READ_PER_WORD = 0.35;
const FADE_OUT = 0.6; // exit animation (globals.css) runs 560 ms
// A queued clip still shows if it waited at most this long (wall-clock s): one card ahead of it
const MAX_QUEUE = 20;

/** Team radio card in the style of the F1 TV graphic (car number where the team logo sits). */
export default function RadioCaption({ messages, now, speed, drivers, roster, className, compact = false }: Props) {
  // Clips can land together (two drivers within a second): queue them as the broadcast does,
  // each starting when the previous one is off screen, so the newer doesn't hide the older.
  let card: { m: RadioMessage; start: number; hold: number } | null = null;
  let freeAt = -Infinity;
  for (const x of messages) {
    const hold = (READ_BASE + READ_PER_WORD * x.text.split(/\s+/).length) * speed;
    const start = Math.max(x.timestamp, freeAt);
    if (start - x.timestamp > MAX_QUEUE * speed) continue; // queued so long it's stale
    // -1 s slack: a live clip can be stamped just after the frame it rides in
    if (start - now > 1) break;
    freeAt = start + hold;
    card = now < freeAt ? { m: x, start, hold } : null;
  }
  if (!card) return null;
  const { m, hold } = card;
  const age = now - card.start;
  const words = m.text.split(/\s+/);

  const color = drivers.find((d) => d.abbr === m.driver)?.color ?? "#888888";
  const who = roster.find((r) => r.abbreviation === m.driver);
  const surname = who?.full_name.trim().split(/\s+/).pop() || m.driver || "Team";

  // Equaliser at 30% fill behind the name block
  const equaliser = (
    <div className="absolute inset-0 opacity-30">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(55% 120% at 50% 100%, ${color} 0%, ${color}66 45%, transparent 78%)` }}
      />
      <div className="radio-wave absolute inset-x-0 bottom-[2px] flex h-full items-end justify-center gap-[2px] [mask-image:linear-gradient(90deg,transparent,#000_18%,#000_82%,transparent)]">
        {WAVE.map((h, i) => (
          <span
            key={i}
            className="w-[2px] origin-bottom"
            style={{ height: `${h * 100}%`, backgroundColor: color, animationDelay: `${(i * 113) % 700}ms` }}
          />
        ))}
      </div>
    </div>
  );
  const quote = words.map((w, i) => (
    <span key={i} className="radio-word" style={{ animationDelay: `${520 + i * 45}ms` }}>
      {i === 0 ? '"' : " "}
      {w}
      {i === words.length - 1 ? '"' : ""}
    </span>
  ));

  return (
    // Position on the outer box, slide-in on the inner one: both use transform.
    // Keyed per clip so each new message replays the slide-in and the word reveal.
    <div
      key={`${m.timestamp}-${m.driver}`}
      className={`pointer-events-none absolute z-10 ${compact ? "" : "w-[min(17.5rem,calc(100%-1.5rem))]"} ${className}`}
    >
      <div
        className={`radio-card radio-card-enter overflow-hidden font-display italic ${
          compact ? "flex" : ""
        } ${age > hold - FADE_OUT * speed ? "radio-card-exit" : ""}`}
        style={{ "--team": color } as CSSProperties}
      >
        {compact ? (
          <>
            <div className="radio-header relative flex w-[5.5rem] shrink-0 flex-col justify-end px-2.5 pb-2 pt-3">
              {equaliser}
              <div className="relative">
                <div className="text-[13px] font-bold leading-none" style={{ color }}>{who?.driver_number}</div>
                <div className="mt-1 break-words pr-1 text-[13px] font-bold uppercase leading-[0.95] tracking-tight">
                  <div style={{ color }}>{surname}</div>
                  <div className="text-white">Radio</div>
                </div>
              </div>
            </div>
            <div className="radio-rule w-[2px] shrink-0" />
            <div className="radio-quote flex min-w-0 flex-1 items-center px-3 py-2">
              <p className="line-clamp-5 text-[11px] font-bold uppercase leading-[1.2]">
                {quote}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Header sits on the equaliser, which stands on a glowing rule */}
            <div className="radio-header relative">
              {equaliser}
              <div className="relative flex items-end justify-between gap-3 px-4 pb-2 pt-5">
                <span className="text-[20px] font-bold leading-none sm:text-[22px]" style={{ color }}>
                  {who?.driver_number}
                </span>
                {/* pr: room for the italic overhang */}
                <div className="min-w-0 break-words pr-1.5 text-right text-[19px] font-bold uppercase leading-[0.95] tracking-tight sm:text-[21px]">
                  <div style={{ color }}>{surname}</div>
                  <div className="text-white">Radio</div>
                </div>
              </div>
              <div className="radio-rule h-[2px]" />
            </div>
            <p className="radio-quote pb-5 pl-4 pr-5 pt-3.5 text-right text-[16px] font-bold uppercase leading-[1.18] sm:text-[18px]">
              {quote}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
