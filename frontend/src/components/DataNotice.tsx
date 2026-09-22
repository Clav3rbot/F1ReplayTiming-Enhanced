"use client";

interface Props {
  notes: string[];
  onClose: () => void;
}

/** Shown when a replay opens on a session whose F1 data has known gaps. */
export default function DataNotice({ notes, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-[rgba(4,4,9,0.76)] p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="data-notice-title"
    >
      <div className="w-[min(26rem,100%)] animate-[tour-in_0.35s_cubic-bezier(0.22,1,0.36,1)] overflow-hidden rounded-2xl border border-white/10 bg-[#161620]/95 bg-glass-gradient shadow-2xl shadow-black/60 ring-1 ring-inset ring-white/[0.05] backdrop-blur-xl">
        <div className="h-[2px] bg-yellow-400/80 shadow-[0_0_10px_rgba(245,197,24,0.5)]" />
        <div className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-400">Incomplete data</span>
          </div>
          <h2 id="data-notice-title" className="mb-2 text-base font-extrabold text-white">
            Some of this session&apos;s data is missing
          </h2>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n} className="text-sm leading-relaxed text-f1-muted">
                {n}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-f1-muted/80">
            Timing, gaps, laps and results are not affected.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              onClick={onClose}
              autoFocus
              className="rounded-lg bg-f1-red px-4 py-2 text-sm font-bold text-white shadow-lg shadow-f1-red/30 transition-colors hover:bg-red-700"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
