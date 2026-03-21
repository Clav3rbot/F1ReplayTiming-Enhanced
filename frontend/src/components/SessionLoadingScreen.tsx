"use client";

import { useEffect, useState } from "react";

/**
 * Famous F1 lines in English — wording checked against primary/secondary sources
 * (Wikiquote, documented interviews & team radio, widely cited attributions).
 *
 * Sources include: en.wikiquote.org (Senna, Villeneuve, Murray Walker, Hunt on Senna);
 * Kimi Räikkönen Lotus radio, 2012 Abu Dhabi GP (BBC, Motorsport Magazine, etc.);
 * Enzo Ferrari line widely quoted as “Second is the first of the losers”;
 * Niki Lauda on success/failure (recurring in interviews / profile pieces).
 */
const F1_LOADING_QUOTES: readonly { quote: string; author: string }[] = [
  {
    quote: "If you no longer go for a gap that exists, you are no longer a racing driver.",
    author: "Ayrton Senna (1990 Australian GP interview, excerpt)",
  },
  {
    quote: "Just leave me alone, I know what I'm doing.",
    author: "Kimi Räikkönen (team radio, 2012 Abu Dhabi GP)",
  },
  {
    quote: "Anything happens in Grand Prix racing, and it usually does.",
    author: "Murray Walker (commentary catchphrase)",
  },
  {
    quote: "If you take away Eau Rouge, you take away the reason why I do this.",
    author: "Ayrton Senna (1993 interview)",
  },
  {
    quote: "From success, you learn absolutely nothing.",
    author: "Niki Lauda (interview)",
  },
  {
    quote: "Second is the first of the losers.",
    author: "Enzo Ferrari (widely attributed)",
  },
  {
    quote: "I will drive flat out all the time … I love racing.",
    author: "Gilles Villeneuve",
  },
  {
    quote: "I don't make mistakes. I make prophecies that immediately turn out to be wrong.",
    author: "Murray Walker",
  },
  {
    quote: "Ayrton Senna may be a genius, but he is a flawed genius.",
    author: "James Hunt (1990)",
  },
  {
    quote: "Box, box, box.",
    author: "F1 team radio (typical engineer call)",
  },
];

/** Fisher–Yates: random order of indices 0..length-1 (new array each call). */
function shuffledIndices(length: number): number[] {
  const a = Array.from({ length }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

type QuoteSeq = { order: number[]; pos: number };

type SessionLoadingScreenProps = {
  /** When true, plays exit animation before the replay UI is shown */
  exiting?: boolean;
};

/**
 * Full-viewport loading state for replay session bootstrap.
 * Minimal car animation — respects prefers-reduced-motion.
 */
export default function SessionLoadingScreen({ exiting = false }: SessionLoadingScreenProps) {
  const [quoteSeq, setQuoteSeq] = useState<QuoteSeq | null>(null);

  useEffect(() => {
    setQuoteSeq({
      order: shuffledIndices(F1_LOADING_QUOTES.length),
      pos: 0,
    });
    if (F1_LOADING_QUOTES.length < 2) return;
    const id = window.setInterval(() => {
      setQuoteSeq((s) => {
        if (!s) return s;
        const nextPos = s.pos + 1;
        if (nextPos >= s.order.length) {
          return { order: shuffledIndices(F1_LOADING_QUOTES.length), pos: 0 };
        }
        return { ...s, pos: nextPos };
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const active =
    quoteSeq != null
      ? F1_LOADING_QUOTES[quoteSeq.order[quoteSeq.pos]!]!
      : null;
  const quoteKey =
    quoteSeq != null ? `${quoteSeq.pos}-${quoteSeq.order[quoteSeq.pos]}` : "init";

  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center bg-f1-dark px-6 ${exiting ? "session-loading-exit-active" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
    >
      <div className="flex w-full max-w-md flex-col items-center">
        <h1 className="text-center text-lg font-bold tracking-tight text-white sm:text-xl">
          Loading session data
        </h1>

        <p className="mt-6 text-center text-sm leading-relaxed text-f1-muted">
          First load may take up to{" "}
          <span className="font-mono tabular-nums text-white/80">60</span>s while
          frames and track data are fetched.
        </p>

        <p className="mt-5 text-center text-[10px] font-extrabold uppercase tracking-[0.35em] text-f1-muted/55">
          Loading data
        </p>

        <div className="relative mx-auto mt-3 h-14 w-full max-w-[240px] overflow-hidden">
          <span
            className="session-loading-car absolute top-1/2 text-[1.75rem] leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
            aria-hidden
          >
            🏎️
          </span>
        </div>
      </div>

      {/* Larga quasi tutto lo schermo: citazione su una riga, senza taglio con ellissi */}
      <div className="mt-8 w-full max-w-[min(100vw-1.5rem,72rem)] border-t border-white/[0.06] px-3 pt-6 sm:px-4">
        {active ? (
          <figure key={quoteKey} className="session-loading-quote text-center">
            <div className="session-loading-quote-line overflow-x-auto overflow-y-visible [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <blockquote className="inline-block max-w-none whitespace-nowrap text-[0.78rem] italic leading-snug text-white/90 sm:text-[0.9rem] md:text-base">
                &ldquo;{active.quote}&rdquo;
              </blockquote>
            </div>
            <figcaption className="mt-2 whitespace-normal break-words px-1 text-xs font-bold uppercase tracking-wider text-f1-red/90">
              {active.author}
            </figcaption>
          </figure>
        ) : (
          <div className="min-h-[2.75rem]" aria-hidden />
        )}
      </div>
    </div>
  );
}
