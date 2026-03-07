"use client";

import { ReplayDriver } from "@/hooks/useReplaySocket";
import TyreIndicator from "./TyreIndicator";

interface Props {
  drivers: ReplayDriver[];
  highlightedDriver: string | null;
  onDriverClick: (abbr: string) => void;
}

export default function Leaderboard({ drivers, highlightedDriver, onDriverClick }: Props) {
  const sorted = [...drivers].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );

  return (
    <div className="bg-f1-card border-l border-f1-border h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-f1-border">
        <h2 className="text-sm font-bold text-f1-muted uppercase tracking-wider">
          Leaderboard
        </h2>
      </div>
      <div className="divide-y divide-f1-border">
        {sorted.map((drv) => {
          const isHighlighted = highlightedDriver === drv.abbr;
          return (
            <button
              key={drv.abbr}
              onClick={() => onDriverClick(drv.abbr)}
              className={`w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors text-left ${
                isHighlighted ? "bg-white/10" : ""
              }`}
            >
              {/* Position */}
              <span className="text-sm font-bold text-f1-muted w-6 text-right">
                {drv.position ?? "-"}
              </span>

              {/* Team color bar */}
              <span
                className="w-1 h-6 rounded-full"
                style={{ backgroundColor: drv.color }}
              />

              {/* Driver name */}
              <span className="text-sm font-bold text-white flex-1">
                {drv.abbr}
              </span>

              {/* Tyre */}
              <TyreIndicator compound={drv.compound} life={drv.tyre_life} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
