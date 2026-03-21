"use client";

import { useEffect, useRef, useState } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  visible: boolean;
  driver: ReplayDriver | null;
  year?: number;
  isQualifying?: boolean;
  useImperial?: boolean;
  /** Narrow sidebar (e.g. iPad telemetry column): fit width, keep RPM bars visible, no forced min-width */
  dense?: boolean;
}

function BarPips({
  value,
  max,
  color,
  pips = 5,
  dense = false,
}: {
  value: number;
  max: number;
  color: string;
  pips?: number;
  dense?: boolean;
}) {
  const fill = Math.max(0, Math.min(pips, (value / Math.max(max, 1)) * pips));
  if (dense) {
    return (
      <div className="flex h-[14px] w-[22px] items-end justify-end gap-px overflow-visible rounded-[1px]">
        {Array.from({ length: pips }, (_, i) => {
          const h = 4 + i * 2;
          const level = Math.max(0, Math.min(1, fill - i));
          const opacity = 0.2 + level * 0.8;
          const scaleY = 0.85 + level * 0.15;
          return (
            <div
              key={i}
              className="w-[3px] rounded-[1px] transition-all duration-150 ease-out"
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

export default function TelemetryChart({ visible, driver, year, isQualifying, useImperial, dense = false }: Props) {
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
  const throttleRaw = driver.throttle ?? 0;
  const brakeRaw = driver.brake ? 100 : 0;
  const gear = driver.gear ?? 0;
  const rpmRaw = driver.rpm ?? 0;
  const drs = driver.drs ?? 0;
  const throttle = useSmoothedNumber(throttleRaw, 0.24);
  const brake = useSmoothedNumber(brakeRaw, 0.24);
  const rpm = useSmoothedNumber(rpmRaw, 0.2);
  const rpmDisplay = `${(rpm / 1000).toFixed(1)}k`;

  return (
    <div
      className={`glass-panel-heavy border-f1-border rounded-xl shadow-2xl relative ${
        dense
          ? "min-w-0 w-full max-w-full overflow-visible py-1.5 pl-2 pr-2"
          : "min-w-[430px] overflow-hidden py-2 pl-3 pr-4 sm:pl-4 sm:pr-5"
      }`}
    >
      <div className={`flex items-center relative z-10 min-w-0 ${dense ? "gap-1" : "gap-2 sm:gap-4"}`}>
        {/* Driver */}
        <div className={`flex shrink-0 items-center gap-1 ${dense ? "w-[34px]" : "w-[38px] sm:w-[42px]"}`}>
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
        <div className={`flex shrink-0 items-center ${dense ? "w-[44px]" : "w-[50px] sm:w-[85px]"}`}>
          <span
            className={`font-bold uppercase tracking-wider text-f1-muted ${dense ? "w-[14px] text-[7px]" : "w-[20px] text-[9px] sm:w-auto"}`}
          >
            Spd
          </span>
          <span
            className={`font-extrabold text-white font-mono tabular-nums-fixed text-right drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] ${
              dense ? "w-[22px] text-[11px]" : "w-[26px] text-[13px] sm:w-[28px]"
            }`}
          >
            {speed}
          </span>
          {!dense && <span className="text-[9px] font-bold text-f1-muted hidden sm:inline ml-1">{useImperial ? "mph" : "km/h"}</span>}
        </div>

        {/* Throttle */}
        <div className={`flex shrink-0 items-center gap-px ${dense ? "w-[40px]" : "w-[52px] sm:w-[50px] gap-[3px]"}`}>
          <span className={`font-bold uppercase text-f1-muted ${dense ? "w-[14px] text-[7px]" : "w-[20px] text-[9px] sm:w-auto"}`}>Thr</span>
          <BarPips value={throttle} max={100} color="#22C55E" dense={dense} />
        </div>

        {/* Brake */}
        <div className={`flex shrink-0 items-center gap-px ${dense ? "w-[38px]" : "w-[52px] sm:w-[48px] gap-[3px]"}`}>
          <span className={`font-bold uppercase text-f1-muted ${dense ? "w-[12px] text-[7px]" : "w-[20px] text-[9px] sm:w-auto"}`}>Brk</span>
          <BarPips value={brake} max={100} color="#EF4444" dense={dense} />
        </div>

        {/* Gear */}
        <div className={`flex shrink-0 items-center gap-px ${dense ? "w-[28px]" : "w-[26px] sm:w-[42px] gap-[3px]"}`}>
          {dense ? (
            <span className="w-[8px] text-[7px] font-bold uppercase tracking-wider text-f1-muted">G</span>
          ) : (
            <>
              <span className="w-[10px] text-[9px] font-bold uppercase tracking-wider text-f1-muted sm:hidden">G</span>
              <span className="hidden text-[9px] font-bold uppercase tracking-wider text-f1-muted sm:inline">Gear</span>
            </>
          )}
          <span
            className={`font-extrabold text-white font-mono tabular-nums-fixed text-center drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] ${
              dense ? "w-[10px] text-[11px]" : "w-[12px] text-[13px]"
            }`}
          >
            {gear === 0 ? "N" : gear}
          </span>
        </div>

        {/* RPM — always show label + animated pips in dense sidebar */}
        <div className={`flex min-w-0 flex-shrink-0 items-center gap-px ${dense ? "mr-0 flex-1 justify-end" : "mr-0.5 w-[68px] gap-[4px] sm:w-[92px]"}`}>
          <span className={`font-bold uppercase tracking-wider text-f1-muted ${dense ? "text-[7px]" : "hidden text-[9px] sm:inline"}`}>RPM</span>
          <span
            className={`font-extrabold text-white font-mono tabular-nums-fixed text-right drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] ${
              dense ? "w-[30px] text-[10px]" : "w-[34px] text-[11px] sm:w-[40px]"
            }`}
          >
            {rpmDisplay}
          </span>
          <BarPips value={rpm} max={15000} color="#F59E0B" dense={dense} />
        </div>

        {/* DRS (not available from 2026) */}
        {hasDrs && (
          <span
            className={`text-center font-extrabold rounded shrink-0 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] transition-colors ${
              dense
                ? "w-[22px] py-0.5 text-[7px]"
                : "w-[28px] py-0.5 text-[9px] sm:w-[32px]"
            } ${
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
