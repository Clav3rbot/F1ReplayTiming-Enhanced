"use client";

import { useEffect, useRef, useState } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  visible: boolean;
  driver: ReplayDriver | null;
  year?: number;
  isQualifying?: boolean;
  useImperial?: boolean;
  sidebar?: boolean;
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
  const fill = Math.max(0, Math.min(pips, (value / Math.max(max, 1)) * pips));
  return (
    <div className="flex items-end justify-end gap-[2px] h-[18px] w-[28px] overflow-hidden rounded-[1px]">
      {Array.from({ length: pips }, (_, i) => {
        const h = 6 + i * 3; // ascending heights: 6, 9, 12, 15, 18
        // Per-pip fractional fill for smoother transitions (no hard on/off jump)
        const level = Math.max(0, Math.min(1, fill - i));
        const opacity = 0.18 + level * 0.82;
        const scaleY = 0.82 + level * 0.18;
        return (
          <div
            key={i}
            className="w-[4px] rounded-[1px] transition-all duration-150 ease-out"
            style={{
              height: `${h}px`,
              backgroundColor: color,
              opacity,
              transform: `scaleY(${scaleY})`,
              transformOrigin: "bottom",
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

function useSmoothedNumber(target: number, stiffness = 0.2) {
  const [value, setValue] = useState(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const step = () => {
      setValue((prev) => {
        const next = prev + (target - prev) * stiffness;
        if (Math.abs(next - target) < 0.2) return target;
        rafRef.current = requestAnimationFrame(step);
        return next;
      });
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, stiffness]);

  return value;
}

export default function TelemetryChart({ visible, driver, year, isQualifying, useImperial, sidebar = false }: Props) {
  const hasDrs = !year || year < 2026;

  // Compute raw values (always, so hooks below have stable inputs even when driver is null)
  const speedKmh = Math.round(driver?.speed ?? 0);
  const speed = useImperial ? Math.round(speedKmh * 0.6214) : speedKmh;
  const throttleRaw = driver?.throttle ?? 0;
  const brakeRaw = driver?.brake ? 100 : 0;
  const gear = driver?.gear ?? 0;
  const rpmRaw = driver?.rpm ?? 0;
  const drs = driver?.drs ?? 0;

  // Hooks must always be called in the same order — never after an early return
  const throttle = useSmoothedNumber(throttleRaw, 0.24);
  const brake = useSmoothedNumber(brakeRaw, 0.24);
  const rpm = useSmoothedNumber(rpmRaw, 0.2);
  const rpmDisplay = `${(rpm / 1000).toFixed(1)}k`;

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

  return (
    <div
      className={`glass-panel-heavy border-f1-border rounded-xl py-2 shadow-2xl overflow-hidden relative ${
        sidebar ? "min-w-0 w-full pl-2.5 pr-3" : "min-w-[430px] pl-3 pr-4 sm:pl-4 sm:pr-5"
      }`}
    >
      <div className={`flex items-center relative z-10 min-w-0 ${sidebar ? "gap-2" : "gap-2 sm:gap-4"}`}>
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
          {!sidebar && <span className="text-[9px] font-bold text-f1-muted hidden sm:inline ml-1">{useImperial ? "mph" : "km/h"}</span>}
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
        <div className="w-[68px] sm:w-[92px] min-w-0 flex items-center gap-[4px] mr-0.5">
          <span className="text-[9px] font-bold text-f1-muted uppercase hidden sm:inline tracking-wider">RPM</span>
          <span className="text-[11px] font-extrabold text-white font-mono tabular-nums-fixed text-right w-[34px] sm:w-[40px] drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
            {rpmDisplay}
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
