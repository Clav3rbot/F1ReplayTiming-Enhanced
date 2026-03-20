"use client";

import { ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  visible: boolean;
  driver: ReplayDriver | null;
  year?: number;
  isQualifying?: boolean;
  useImperial?: boolean;
}

function BarPips({
  value,
  max,
  color,
  pips = 5,
}: {
  value: number;
  max: number;
  color: string;
  pips?: number;
}) {
  const filled = Math.round((value / max) * pips);
  return (
    <div className="flex items-end gap-[2px] h-[18px]">
      {Array.from({ length: pips }, (_, i) => {
        const h = 6 + i * 3; // ascending heights: 6, 9, 12, 15, 18
        const active = i < filled;
        return (
          <div
            key={i}
            className="w-[4px] rounded-[1px] transition-colors duration-100"
            style={{
              height: `${h}px`,
              backgroundColor: active ? color : "#3A3A4A",
            }}
          />
        );
      })}
    </div>
  );
}

const SECTOR_COLORS: Record<string, string> = {
  purple: "#A855F7",
  green: "#22C55E",
  yellow: "#EAB308",
};

export default function TelemetryChart({ visible, driver, year, isQualifying, useImperial }: Props) {
  const hasDrs = !year || year < 2026;
  if (!visible) return null;

  if (!driver) {
    return (
      <div className="glass-panel-heavy border-f1-border rounded-xl px-3 py-2 shadow-2xl">
        <p className="text-[10px] text-f1-muted/70 font-bold uppercase tracking-wider">
        Select drivers to view telemetry
        </p>
      </div>
    );
  }

  const speedKmh = Math.round(driver.speed ?? 0);
  const speed = useImperial ? Math.round(speedKmh * 0.6214) : speedKmh;
  const throttle = driver.throttle ?? 0;
  const brake = driver.brake ? 100 : 0;
  const gear = driver.gear ?? 0;
  const rpm = driver.rpm ?? 0;
  const drs = driver.drs ?? 0;

  return (
    <div className="glass-panel-heavy border-f1-border rounded-xl px-3 sm:px-4 py-2 shadow-2xl overflow-hidden relative">
      <div className="flex items-center gap-2 sm:gap-4 relative z-10">
        {/* Driver */}
        <div className="w-[38px] sm:w-[42px] flex items-center gap-1 shrink-0">
          <span
            className="w-1 h-4 rounded-sm shrink-0"
            style={{ backgroundColor: driver.color }}
          />
          <span className="text-[10px] font-extrabold text-white">
            {driver.abbr}
          </span>
        </div>

        {/* Sector indicators (qualifying only) */}
        {isQualifying && (
          <div className="flex items-center gap-[2px] shrink-0 -ml-1.5 sm:-ml-3">
            {[1, 2, 3].map((sn) => {
              const sec = driver.sectors?.find((s) => s.num === sn);
              return (
                <span
                  key={sn}
                  className="w-[6px] h-[14px] rounded-[1px]"
                  style={{ backgroundColor: sec ? SECTOR_COLORS[sec.color] || "#3A3A4A" : "#3A3A4A" }}
                />
              );
            })}
          </div>
        )}

        {/* Speed */}
        <div className="w-[50px] sm:w-[85px] flex items-center shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto tracking-wider">Spd</span>
          <span className="text-[13px] font-extrabold text-white font-mono tabular-nums-fixed text-right w-[26px] sm:w-[28px] drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
            {speed}
          </span>
          <span className="text-[9px] font-bold text-f1-muted hidden sm:inline ml-1">{useImperial ? "mph" : "km/h"}</span>
        </div>

        {/* Throttle */}
        <div className="w-[52px] sm:w-[50px] flex items-center gap-[3px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto">Thr</span>
          <BarPips value={throttle} max={100} color="#22C55E" />
        </div>

        {/* Brake */}
        <div className="w-[52px] sm:w-[48px] flex items-center gap-[3px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto">Brk</span>
          <BarPips value={brake} max={100} color="#EF4444" />
        </div>

        {/* Gear */}
        <div className="w-[26px] sm:w-[42px] flex items-center gap-[3px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[10px] sm:hidden tracking-wider">G</span>
          <span className="text-[9px] font-bold text-f1-muted uppercase hidden sm:inline tracking-wider">Gear</span>
          <span className="text-[13px] font-extrabold text-white font-mono tabular-nums-fixed w-[12px] text-center drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
            {gear === 0 ? "N" : gear}
          </span>
        </div>

        {/* RPM */}
        <div className="w-[62px] sm:w-[94px] flex items-center gap-[5px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase hidden sm:inline tracking-wider">RPM</span>
          <span className="text-[11px] font-extrabold text-white font-mono tabular-nums-fixed text-right w-[28px] sm:w-[32px] drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
            {Math.round(rpm / 100) / 10}k
          </span>
          <BarPips value={rpm} max={15000} color="#F59E0B" />
        </div>

        {/* DRS (not available from 2026) */}
        {hasDrs && (
          <span
            className={`w-[28px] sm:w-[32px] text-center text-[9px] font-extrabold py-0.5 rounded shrink-0 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] transition-colors ${
              drs >= 10
                ? "text-f1-green bg-f1-green/20 border border-f1-green/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]"
                : "text-f1-muted/40 border border-f1-border bg-f1-card/40"
            }`}
          >
            DRS
          </span>
        )}
      </div>
    </div>
  );
}
