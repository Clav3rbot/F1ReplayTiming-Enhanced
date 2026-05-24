"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "@/lib/api";

export interface ReplayDriver {
  abbr: string;
  x: number;
  y: number;
  color: string;
  team: string;
  position: number | null;
  grid_position: number | null;
  compound: string | null;
  tyre_life: number | null;
  pit_stops: number;
  in_pit: boolean;
  pit_time: number | null;
  finished: boolean;
  tyre_history: string[];
  gap: string | null;
  interval: string | null;
  best_lap_time: string | null;
  has_fastest_lap: boolean;
  flag: "investigation" | "penalty" | null;
  retired: boolean;
  pit_start: boolean;
  no_timing: boolean;
  relative_distance: number;
  speed: number | null;
  throttle: number | null;
  brake: boolean;
  gear: number | null;
  rpm: number | null;
  drs: number | null;
  pit_prediction: number | null;
  pit_prediction_margin: number | null;
  pit_prediction_free_air: number | null;
  sectors: { num: number; color: "purple" | "green" | "yellow" }[] | null;
}

export interface WeatherData {
  air_temp: number;
  track_temp: number;
  humidity: number;
  rainfall: boolean;
  wind_speed: number;
  wind_direction: number;
}

export interface QualiPhase {
  phase: string;  // "Q1", "Q2", "Q3"
  elapsed: number;
  remaining: number;
}

export interface RCMessage {
  message: string;
  category: string;
  timestamp: number;
  lap?: number;
  racing_number?: string;
}

export interface ReplayFrame {
  timestamp: number;
  lap: number;
  total_laps: number;
  session_type?: string;
  drivers: ReplayDriver[];
  status: string;
  weather?: WeatherData;
  quali_phase?: QualiPhase;
  rc_messages?: RCMessage[];
  red_flag_end?: number;
  sector_flags?: { sector: number; flag: string; driver: string }[];
}

export interface QualiPhaseInfo {
  phase: string;
  timestamp: number;
}

/** First session time (s) at which each lap number appears in the replay (race/sprint). */
export interface LapStart {
  lap: number;
  timestamp: number;
}

/** Run-length encoding of `frame.lap` in frame order — matches server seek (first frame with timestamp >= t). */
export interface FrameLapsRleSegment {
  lap: number;
  count: number;
}

interface ReplayState {
  connected: boolean;
  ready: boolean;
  loading: boolean;
  playing: boolean;
  speed: number;
  frame: ReplayFrame | null;
  totalTime: number;
  totalLaps: number;
  qualiPhases: QualiPhaseInfo[];
  lapStarts: LapStart[];
  totalFrames: number;
  frameLapsRle: FrameLapsRleSegment[];
  replaySampleInterval: number;
  finished: boolean;
  error: string | null;
  statusMessage: string | null;
  reconnecting: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 5;

export function useReplaySocket(year: number, round: number, sessionType: string = "R") {
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const wasReadyRef = useRef(false);
  const lastTimestampRef = useRef(0);
  const mountedRef = useRef(true);

  const [state, setState] = useState<ReplayState>({
    connected: false,
    ready: false,
    loading: true,
    playing: false,
    speed: 1,
    frame: null,
    totalTime: 0,
    totalLaps: 0,
    qualiPhases: [],
    lapStarts: [],
    totalFrames: 0,
    frameLapsRle: [],
    replaySampleInterval: 0.5,
    finished: false,
    error: null,
    statusMessage: null,
    reconnecting: false,
  });

  useEffect(() => {
    mountedRef.current = true;
    reconnectAttemptsRef.current = 0;
    wasReadyRef.current = false;
    lastTimestampRef.current = 0;

    function connect() {
      if (!mountedRef.current) return;

      const url = wsUrl(`/ws/replay/${year}/${round}?type=${sessionType}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setState((s) => ({ ...s, connected: true, reconnecting: false, error: null }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let msg: any;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        switch (msg.type) {
          case "status":
            setState((s) => ({ ...s, loading: true, statusMessage: msg.message || null }));
            break;
          case "ready": {
            const rleRaw = Array.isArray(msg.frame_laps_rle) ? msg.frame_laps_rle : [];
            const frameLapsRle: FrameLapsRleSegment[] = rleRaw
              .map((row: { lap?: unknown; count?: unknown }) => ({
                lap: Number(row.lap),
                count: Number(row.count),
              }))
              .filter(
                (row: FrameLapsRleSegment) =>
                  Number.isFinite(row.lap) && row.lap >= 1 && Number.isFinite(row.count) && row.count > 0,
              );
            setState((s) => ({
              ...s,
              ready: true,
              loading: false,
              statusMessage: null,
              reconnecting: false,
              totalTime: msg.total_time,
              totalLaps: msg.total_laps,
              qualiPhases: msg.quali_phases || [],
              lapStarts: Array.isArray(msg.lap_starts) ? msg.lap_starts : [],
              totalFrames: typeof msg.total_frames === "number" ? msg.total_frames : 0,
              frameLapsRle,
              replaySampleInterval:
                typeof msg.replay_sample_interval === "number" && msg.replay_sample_interval > 0
                  ? msg.replay_sample_interval
                  : 0.5,
            }));
            // On reconnect: seek to last known position; on initial load: seek to 0
            if (ws.readyState === WebSocket.OPEN) {
              const seekTo = wasReadyRef.current && lastTimestampRef.current > 0
                ? lastTimestampRef.current
                : 0;
              ws.send(`seek:${seekTo}`);
              // Re-send play if we were playing before disconnect
              if (wasReadyRef.current && !pausedRef.current) {
                ws.send("play");
              }
            }
            wasReadyRef.current = true;
            break;
          }
          case "frame":
            // Drop frames that arrive after pause (in-flight from backend)
            if (pausedRef.current) break;
            lastTimestampRef.current = msg.timestamp;
            setState((s) => ({
              ...s,
              frame: {
                timestamp: msg.timestamp,
                lap: msg.lap,
                total_laps: msg.total_laps,
                session_type: msg.session_type,
                drivers: msg.drivers,
                status: msg.status,
                weather: msg.weather,
                quali_phase: msg.quali_phase,
                rc_messages: msg.rc_messages,
                red_flag_end: msg.red_flag_end,
                sector_flags: msg.sector_flags,
              },
            }));
            break;
          case "finished":
            setState((s) => ({ ...s, playing: false, finished: true }));
            break;
          case "error":
            setState((s) => ({ ...s, error: msg.message, loading: false }));
            break;
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        // If we were never ready, mark the error immediately.
        // If we were ready, onclose will fire next and handle reconnect.
        if (!wasReadyRef.current) {
          setState((s) => ({ ...s, error: s.error || "WebSocket connection error", loading: false }));
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setState((s) => ({ ...s, connected: false }));

        if (wasReadyRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * reconnectAttemptsRef.current, 8000);
          setState((s) => ({ ...s, reconnecting: true, error: null }));
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else if (!wasReadyRef.current) {
          setState((s) => ({ ...s, error: s.error || "WebSocket connection error", loading: false }));
        } else {
          // Exceeded max reconnect attempts
          setState((s) => ({ ...s, error: s.error || "WebSocket connection error", loading: false, reconnecting: false }));
        }
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [year, round, sessionType]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  const play = useCallback(() => {
    pausedRef.current = false;
    send("play");
    setState((s) => ({ ...s, playing: true, finished: false }));
  }, [send]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    send("pause");
    setState((s) => ({ ...s, playing: false }));
  }, [send]);

  const setSpeed = useCallback((speed: number) => {
    send(`speed:${speed}`);
    setState((s) => ({ ...s, speed }));
  }, [send]);

  const seek = useCallback((time: number) => {
    pausedRef.current = false;
    send(`seek:${time}`);
    setState((s) => ({ ...s, finished: false }));
  }, [send]);

  const seekToLap = useCallback((lap: number) => {
    pausedRef.current = false;
    send(`seeklap:${lap}`);
    setState((s) => ({ ...s, finished: false }));
  }, [send]);

  const reset = useCallback(() => {
    pausedRef.current = false;
    send("reset");
    setState((s) => ({ ...s, playing: false, finished: false }));
  }, [send]);

  return { ...state, play, pause, setSpeed, seek, seekToLap, reset };
}
