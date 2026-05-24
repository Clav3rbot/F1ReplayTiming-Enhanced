"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import RaceCountdown from "./RaceCountdown";

interface SessionEntry {
  name: string;
  date_utc: string | null;
  available: boolean;
}

interface LiveSessionInfo {
  year: number;
  round_number: number;
  event_name: string;
  country: string;
  session_name: string;
  session_type: string;
  session_start: string;
  pre_session: boolean;
}

interface Event {
  round_number: number;
  country: string;
  event_name: string;
  location: string;
  event_date: string;
  sessions: SessionEntry[];
  status: "latest" | "available" | "future";
}

interface EventsResponse {
  year: number;
  events: Event[];
}

interface SeasonsResponse {
  seasons: number[];
}

const COUNTRY_CODES: Record<string, string> = {
  "Australia": "au",
  "Austria": "at",
  "Azerbaijan": "az",
  "Bahrain": "bh",
  "Belgium": "be",
  "Brazil": "br",
  "Canada": "ca",
  "China": "cn",
  "Hungary": "hu",
  "Italy": "it",
  "Japan": "jp",
  "Mexico": "mx",
  "Monaco": "mc",
  "Netherlands": "nl",
  "Qatar": "qa",
  "Saudi Arabia": "sa",
  "Singapore": "sg",
  "Spain": "es",
  "United Arab Emirates": "ae",
  "United Kingdom": "gb",
  "United States": "us",
  "Portugal": "pt",
  "France": "fr",
  "Germany": "de",
  "Russia": "ru",
  "Turkey": "tr",
  "South Africa": "za",
  "Las Vegas": "us",
  "Miami": "us",
};

const SESSION_LABELS: Record<string, string> = {
  Race: "R",
  Qualifying: "Q",
  Sprint: "S",
  "Sprint Qualifying": "SQ",
  "Sprint Shootout": "SQ",
  "Practice 1": "FP1",
  "Practice 2": "FP2",
  "Practice 3": "FP3",
};

function formatLocalTime(dateUtc: string | null): { dayDate: string; time: string } | null {
  if (!dateUtc) return null;
  try {
    const date = new Date(dateUtc);
    if (isNaN(date.getTime())) return null;
    const weekday = date.toLocaleString([], { weekday: "short" });
    const day = date.getDate();
    const month = date.toLocaleString([], { month: "short" });
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    return { dayDate: `${weekday} ${day} ${month}`, time };
  } catch {
    return null;
  }
}

function StatusPill({ status }: { status: Event["status"] }) {
  switch (status) {
    case "latest":
      return (
        <span className="w-20 inline-flex items-center justify-center py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-f1-red text-white shadow-[0_0_10px_rgba(225,6,0,0.5)]">
          Latest
        </span>
      );
    case "available":
      return (
        <span className="w-20 inline-flex items-center justify-center py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-f1-green/10 text-f1-green border border-f1-green/30 shadow-[0_0_10px_rgba(0,255,65,0.15)]">
          Available
        </span>
      );
    case "future":
      return (
        <span className="w-20 inline-flex items-center justify-center py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-white/5 text-f1-muted border border-white/10">
          Upcoming
        </span>
      );
  }
}

export default function SessionPicker() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const latestRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: seasonsData } = useApi<SeasonsResponse>("/api/seasons");
  const { data: eventsData, loading: eventsLoading } = useApi<EventsResponse>(
    `/api/seasons/${year}/events`,
  );
  const { data: liveData } = useApi<{ live: LiveSessionInfo | null }>("/api/live/status");
  const liveSession = liveData?.live ?? null;

  const seasons = (seasonsData?.seasons || []).filter((s) => s <= currentYear);
  const events = eventsData?.events || [];

  const displayEvents = events;

  const nextRaceDate = useMemo(() => {
    const now = new Date();
    const upcoming: { date: Date; name: string }[] = [];
    for (const evt of events) {
      if (evt.status === "available") continue;
      for (const s of evt.sessions) {
        if (!s.date_utc) continue;
        const d = new Date(s.date_utc);
        if (d > now) {
          upcoming.push({ date: d, name: `${evt.country} · ${s.name}` });
        }
      }
    }
    if (upcoming.length === 0) return null;
    upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
    return upcoming[0];
  }, [events]);

  const latestEvent = useMemo(
    () => year === currentYear ? displayEvents.find((e) => e.status === "latest") || null : null,
    [displayEvents, year, currentYear],
  );

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // No auto-scroll — let the page load at the top

  function EventRow({ evt, id }: { evt: Event; id?: string }) {
    const displayEvt = displayEvents.find((e) => e.round_number === evt.round_number) || evt;
    const isLatest = displayEvt.status === "latest" && year === currentYear;
    const isFuture = displayEvt.status === "future";
    const selectionKey = id || String(evt.round_number);
    const isSelected = selectedKey === selectionKey;

    return (
      <div
        className={`glass-panel overflow-hidden transition-all duration-300 cursor-pointer hover:-translate-y-1 ${
          isSelected && isLatest
            ? "border-f1-red ring-1 ring-f1-red/50 shadow-[0_4px_30px_rgba(225,6,0,0.15)] bg-white/5"
            : isSelected
              ? "border-white/30 ring-1 ring-white/20 shadow-glass bg-white/5"
              : isLatest
                ? "border-f1-red/50 hover:border-f1-red hover:shadow-[0_4px_20px_rgba(225,6,0,0.2)]"
              : isFuture
                ? "opacity-50 hover:opacity-70 border-white/5"
                : "hover:border-white/20 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)] hover:bg-white/[0.02]"
        } rounded-xl`}
      >
        {/* Compact header row */}
        <div
          className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-4 cursor-pointer"
          onClick={() => { if (isSelected) { setSelectedKey(null); } else { setSelectedKey(selectionKey); setSelectedEvent(evt); } }}
        >
          <span className="text-xs font-bold text-f1-muted w-8 flex-shrink-0">R{evt.round_number}</span>
          <div className="flex-1 min-w-0">
            <span className="text-white font-bold text-sm">
              {COUNTRY_CODES[evt.country] && (
                <img src={`https://flagcdn.com/w20/${COUNTRY_CODES[evt.country]}.png`} srcSet={`https://flagcdn.com/w40/${COUNTRY_CODES[evt.country]}.png 2x`} width="16" alt={evt.country} className="mr-1.5 inline-block rounded-sm shadow-sm" />
              )}
              {evt.event_name}
            </span>
            <div className="sm:hidden mt-0.5">
              <span className="text-[10px] text-f1-muted font-medium">{evt.event_date}</span>
            </div>
          </div>
          <span className="text-xs text-f1-muted hidden sm:block flex-shrink-0 w-44 text-right truncate">
            {evt.location}, {evt.country}
          </span>
          <span className="text-xs text-f1-muted hidden sm:block flex-shrink-0 w-20 text-right">{evt.event_date}</span>
          <div className="flex items-center gap-3 ml-auto">
            <StatusPill status={isLatest ? "latest" : displayEvt.status === "latest" ? "available" : displayEvt.status} />
            <svg
              className={`w-4 h-4 text-f1-muted transition-transform flex-shrink-0 ${isSelected ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Expanded session drawer */}
        <div 
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isSelected ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 flex flex-wrap gap-3 border-t border-white/10 pt-3" onClick={(e) => e.stopPropagation()}>
              {evt.sessions.map((session) => {
              const code = SESSION_LABELS[session.name];
              if (!code) return null;
              const localTime = formatLocalTime(session.date_utc);
              const isLive = liveSession?.year === year && liveSession?.round_number === evt.round_number && liveSession?.session_type === code;
              if (isLive) {
                return (
                  <div key={session.name} className="flex flex-col items-center">
                    {localTime && (
                      <span className="text-[10px] text-red-400 mb-1 text-center leading-tight">
                        {localTime.dayDate}<br />{localTime.time}
                      </span>
                    )}
                    <Link
                      href={`/live?year=${year}&round=${evt.round_number}&type=${code}`}
                      className="px-3 py-1.5 bg-red-600/90 text-white text-xs font-bold rounded-md hover:bg-f1-red hover:shadow-[0_0_15px_rgba(225,6,0,0.6)] transition-all duration-300 flex items-center gap-1.5 border border-red-500/50"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                      </span>
                      {session.name}
                    </Link>
                  </div>
                );
              }
              if (session.available) {
                return (
                  <div key={session.name} className="flex flex-col items-center">
                    {localTime && (
                      <span className="text-[10px] text-f1-muted mb-1 text-center leading-tight">
                        {localTime.dayDate}<br />{localTime.time}
                      </span>
                    )}
                    <Link
                      href={`/replay?year=${year}&round=${evt.round_number}&type=${code}`}
                      className="px-3 py-1.5 bg-white/5 text-white/90 text-xs font-bold rounded-md hover:bg-f1-red hover:text-white hover:shadow-[0_0_15px_rgba(225,6,0,0.4)] border border-white/10 hover:border-f1-red/50 transition-all duration-300"
                    >
                      {session.name}
                    </Link>
                  </div>
                );
              }
              return (
                <div key={session.name} className="flex flex-col items-center">
                  {localTime && (
                    <span className="text-[10px] text-f1-muted/50 mb-1 text-center leading-tight">
                      {localTime.dayDate}<br />{localTime.time}
                    </span>
                  )}
                  <span
                    className="px-3 py-1.5 bg-black/20 text-f1-muted/40 text-xs font-bold rounded-md cursor-not-allowed border border-white/5"
                  >
                    {session.name}
                  </span>
                </div>
              );
            })}
            {isFuture && (
              <p className="text-xs text-f1-muted w-full">Sessions not yet started</p>
            )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-f1-dark text-f1-text relative">
      {/* Persistent Radial Glow Background (Old version restored and made fixed) */}
      <div className="fixed inset-0 pointer-events-none z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#13131c] via-[#0b0b11] to-[#050508]"></div>

      <div className="glass-panel-heavy border-b-0 sticky top-0 z-40 border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6 relative flex items-center justify-between gap-4 header-container-desktop">
          <div className="flex items-center gap-3 sm:gap-5 header-logo-title-absolute">
            <div className="relative group">
              <div className="absolute -inset-1 bg-f1-red/50 rounded-lg blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
              <img src="/logo.png" alt="F1 Replay" className="relative w-12 h-12 sm:w-[56px] sm:h-[56px] rounded-lg shadow-2xl" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 tracking-tight mb-0.5 sm:mb-1">
                F1 Replay Timing
              </h1>
              <p className="text-f1-muted text-xs sm:text-sm font-medium tracking-wide">Select a session to replay</p>
            </div>
          </div>
          {/* Countdown — absolute overlay, no layout impact */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden min-[1000px]:flex pointer-events-none">
            <div className="pointer-events-auto">
              {nextRaceDate && (
                <RaceCountdown targetDate={nextRaceDate.date} raceName={nextRaceDate.name} />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 header-buttons-absolute">
            {/* Desktop: text buttons */}
            <Link
              href="/features"
              className="hidden sm:block px-4 py-2 bg-white/5 text-f1-text text-sm font-bold rounded-md hover:bg-white/10 hover:text-white transition-colors border border-transparent hover:border-white/10"
            >
              Features
            </Link>
            <Link
              href="/about"
              className="hidden sm:block px-4 py-2 bg-white/5 text-f1-text text-sm font-bold rounded-md hover:bg-white/10 hover:text-white transition-colors border border-transparent hover:border-white/10"
            >
              About
            </Link>
          {/* Mobile: hamburger menu */}
          <div className="relative sm:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 flex items-center justify-center rounded bg-f1-border text-f1-muted hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-40 bg-f1-card border border-f1-border rounded-lg shadow-xl z-50 py-1">
                <Link
                  href="/features"
                  className="block px-4 py-2.5 text-sm font-bold text-f1-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  Features
                </Link>
                <Link
                  href="/about"
                  className="block px-4 py-2.5 text-sm font-bold text-f1-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  About
                </Link>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Season selector */}
        <div className="flex gap-2 mb-8 flex-wrap max-w-3xl mx-auto justify-center sm:justify-start">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => { setYear(s); setSelectedEvent(null); }}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${
                year === s
                  ? "bg-f1-red text-white shadow-[0_4px_15px_rgba(225,6,0,0.4)] scale-105"
                  : "glass-panel text-f1-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {eventsLoading ? (
          <div className="text-f1-muted text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-f1-muted border-t-f1-red rounded-full animate-spin mb-4" />
            <p>Loading data...</p>
          </div>
        ) : (
          <>
            {/* Live session banner — only show on the year that has the live session */}
            {liveSession && liveSession.year === year && (
              <div className="mb-4 max-w-3xl mx-auto">
                <Link
                  href={`/live?year=${liveSession.year}&round=${liveSession.round_number}&type=${liveSession.session_type}`}
                  className="block glass-panel rounded-xl overflow-hidden border border-f1-red/25 hover:border-f1-red/60 hover:shadow-[0_0_24px_rgba(225,6,0,0.12)] transition-all duration-300 group hover:-translate-y-0.5"
                >
                  <div className="flex items-stretch">
                    {/* Animated red accent bar */}
                    <div className="w-[3px] bg-f1-red flex-shrink-0 animate-pulse-slow" />
                    <div className="flex-1 min-w-0 px-4 sm:px-5 py-4 flex items-center gap-4 bg-gradient-to-r from-red-950/20 to-transparent">
                      <span className="text-xs font-bold text-red-500/70 w-8 flex-shrink-0 tabular-nums">R{liveSession.round_number}</span>
                      <div className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
                        <span className="text-white font-bold truncate">
                          {COUNTRY_CODES[liveSession.country] && (
                            <img src={`https://flagcdn.com/w20/${COUNTRY_CODES[liveSession.country]}.png`} srcSet={`https://flagcdn.com/w40/${COUNTRY_CODES[liveSession.country]}.png 2x`} width="16" alt={liveSession.country} className="mr-2 inline-block rounded-sm shadow-sm" />
                          )}
                          {liveSession.event_name}
                        </span>
                        <span className="text-f1-muted text-sm flex-shrink-0 hidden sm:block">{liveSession.session_name}</span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-f1-red/90 rounded text-xs font-bold text-white uppercase flex-shrink-0 shadow-[0_0_10px_rgba(225,6,0,0.5)]">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                          </span>
                          LIVE
                        </span>
                      </div>
                      <svg className="w-5 h-5 text-f1-muted/50 group-hover:text-f1-red transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Section divider */}
            {liveSession && liveSession.year === year ? (
              <div style={{ position: "relative", zIndex: 1, maxWidth: "48rem", margin: "28px auto 20px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, transparent, rgba(225,6,0,0.5))" }} />
                <span style={{ color: "#9EA1AC", fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {year} Season
                </span>
                <div style={{ flex: 1, height: "1px", background: "linear-gradient(to left, transparent, rgba(225,6,0,0.5))" }} />
              </div>
            ) : (
              <div style={{ position: "relative", zIndex: 1, maxWidth: "48rem", margin: "0 auto 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
                <span style={{ color: "#9EA1AC", fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {year} Season
                </span>
                <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
              </div>
            )}
            <div className="flex flex-col gap-2 max-w-3xl mx-auto">
              {displayEvents.map((evt) => (
                <EventRow key={evt.round_number} evt={evt} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
