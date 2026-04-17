"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "@/lib/api";
import type { ReplayDriver, ReplayFrame, WeatherData, QualiPhase, RCMessage } from "./useReplaySocket";

export { type ReplayDriver, type ReplayFrame, type WeatherData, type QualiPhase, type RCMessage };

interface LiveState {
  connected: boolean;
  ready: boolean;
  loading: boolean;
  frame: ReplayFrame | null;
  rcMessages: RCMessage[];
  finished: boolean;
  sessionEnded: boolean;
  error: string | null;
}

interface BufferedFrame {
  frame: ReplayFrame;
  rcMessages: RCMessage[];
  receivedAt: number; // Date.now() when received
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWeatherData(value: unknown): WeatherData | undefined {
  if (!isRecord(value)) return undefined;

  const { air_temp, track_temp, humidity, rainfall, wind_speed, wind_direction } = value;
  if (
    typeof air_temp !== "number" ||
    typeof track_temp !== "number" ||
    typeof humidity !== "number" ||
    typeof rainfall !== "boolean" ||
    typeof wind_speed !== "number" ||
    typeof wind_direction !== "number"
  ) {
    return undefined;
  }

  return {
    air_temp,
    track_temp,
    humidity,
    rainfall,
    wind_speed,
    wind_direction,
  };
}

function parseQualiPhase(value: unknown): QualiPhase | undefined {
  if (!isRecord(value)) return undefined;

  const { phase, elapsed, remaining } = value;
  if (typeof phase !== "string" || typeof elapsed !== "number" || typeof remaining !== "number") {
    return undefined;
  }

  return { phase, elapsed, remaining };
}

function parseRcMessages(value: unknown): RCMessage[] {
  if (!Array.isArray(value)) return [];

  const parsed: RCMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;

    const { message, category, timestamp, lap, racing_number } = item;
    if (typeof message !== "string" || typeof category !== "string" || typeof timestamp !== "number") {
      continue;
    }

    parsed.push({
      message,
      category,
      timestamp,
      lap: typeof lap === "number" ? lap : undefined,
      racing_number: typeof racing_number === "string" ? racing_number : undefined,
    });
  }

  return parsed;
}

function parseReplayFrame(msg: Record<string, unknown>): ReplayFrame | null {
  const { timestamp, lap, total_laps, session_type, drivers, status } = msg;
  if (
    typeof timestamp !== "number" ||
    typeof lap !== "number" ||
    typeof total_laps !== "number" ||
    !Array.isArray(drivers) ||
    typeof status !== "string"
  ) {
    return null;
  }

  return {
    timestamp,
    lap,
    total_laps,
    session_type: typeof session_type === "string" ? session_type : undefined,
    drivers: drivers as ReplayDriver[],
    status,
    weather: parseWeatherData(msg.weather),
    quali_phase: parseQualiPhase(msg.quali_phase),
  };
}

export function useLiveSocket(
  year: number,
  round: number,
  sessionType: string = "R",
  speed: number = 10,
  delayOffset: number = 0,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<BufferedFrame[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayRef = useRef(delayOffset);
  delayRef.current = delayOffset;
  const hasShownFirstFrame = useRef(false);
  const [state, setState] = useState<LiveState>({
    connected: false,
    ready: false,
    loading: true,
    frame: null,
    rcMessages: [],
    finished: false,
    sessionEnded: false,
    error: null,
  });

  // Delay processing: buffer frames and release them after |delayOffset| seconds.
  // Any non-zero value (positive or negative) activates buffering.
  const absDelay = Math.abs(delayOffset);
  useEffect(() => {
    if (absDelay === 0) {
      bufferRef.current = [];
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const delayMs = absDelay * 1000;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const buffer = bufferRef.current;
      // Find the latest frame that's been buffered long enough
      let releaseIdx = -1;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (now - buffer[i].receivedAt >= delayMs) {
          releaseIdx = i;
          break;
        }
      }
      if (releaseIdx >= 0) {
        const { frame, rcMessages } = buffer[releaseIdx];
        // Remove released and older frames
        bufferRef.current = buffer.slice(releaseIdx + 1);
        setState((s) => ({ ...s, frame, rcMessages }));
      }
    }, 200);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [absDelay]);

  useEffect(() => {
    let aborted = false;
    const url = wsUrl(`/ws/live/${year}/${round}?type=${sessionType}&speed=${speed}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!aborted) setState((s) => ({ ...s, connected: true }));
    };

    ws.onmessage = (event) => {
      if (aborted) return;
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (!isRecord(parsedData)) return;
      const msg = parsedData;

      const messageType = typeof msg.type === "string" ? msg.type : "";

      switch (messageType) {
        case "status":
          setState((s) => ({ ...s, loading: true }));
          break;
        case "ready":
          setState((s) => ({
            ...s,
            ready: true,
            loading: false,
          }));
          break;
        case "frame": {
          const frame = parseReplayFrame(msg);
          if (!frame) break;
          const rcMessages = parseRcMessages(msg.rc_messages);

          if (delayRef.current !== 0) {
            // Show first frame immediately so the user sees data right away,
            // then buffer subsequent frames for delayed release
            if (!hasShownFirstFrame.current) {
              hasShownFirstFrame.current = true;
              setState((s) => ({ ...s, frame, rcMessages }));
            }
            bufferRef.current.push({ frame, rcMessages, receivedAt: Date.now() });
            // Cap buffer to prevent unbounded growth during large delays
            if (bufferRef.current.length > 200) {
              bufferRef.current = bufferRef.current.slice(-200);
            }
          } else {
            // No delay - show immediately
            setState((s) => ({ ...s, frame, rcMessages }));
          }
          break;
        }
        case "finished":
          setState((s) => ({
            ...s,
            finished: true,
            sessionEnded: true,
          }));
          break;
        case "error":
          setState((s) => ({
            ...s,
            error: typeof msg.message === "string" ? msg.message : "WebSocket error",
            loading: false,
          }));
          break;
      }
    };

    ws.onerror = () => {
      if (!aborted) {
        setState((s) => ({ ...s, error: "WebSocket connection error", loading: false }));
      }
    };

    ws.onclose = () => {
      if (!aborted) {
        setState((s) => ({ ...s, connected: false }));
      }
    };

    return () => {
      aborted = true;
      ws.close();
    };
  }, [year, round, sessionType, speed]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  return { ...state, send };
}
