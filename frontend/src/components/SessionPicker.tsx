"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";

interface Event {
  round_number: number;
  country: string;
  event_name: string;
  location: string;
  event_date: string;
  sessions: string[];
}

interface EventsResponse {
  year: number;
  events: Event[];
}

interface SeasonsResponse {
  seasons: number[];
}

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

export default function SessionPicker() {
  const [year, setYear] = useState(2024);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const { data: seasonsData } = useApi<SeasonsResponse>("/api/seasons");
  const { data: eventsData, loading: eventsLoading } = useApi<EventsResponse>(
    `/api/seasons/${year}/events`,
  );

  const seasons = seasonsData?.seasons || [];
  const events = eventsData?.events || [];

  return (
    <div className="min-h-screen bg-f1-dark">
      {/* Header */}
      <div className="bg-f1-card border-b border-f1-border">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-white mb-1">F1 Race Replay</h1>
          <p className="text-f1-muted">Select a session to replay</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Season selector */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => { setYear(s); setSelectedEvent(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                year === s
                  ? "bg-f1-red text-white"
                  : "bg-f1-card text-f1-muted hover:text-white border border-f1-border"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Events grid */}
        {eventsLoading ? (
          <div className="text-f1-muted text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-f1-muted border-t-f1-red rounded-full animate-spin mb-4" />
            <p>Loading {year} season...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {events.map((evt) => (
              <div
                key={evt.round_number}
                className={`bg-f1-card border rounded-xl overflow-hidden transition-all cursor-pointer hover:border-f1-red/50 ${
                  selectedEvent?.round_number === evt.round_number
                    ? "border-f1-red"
                    : "border-f1-border"
                }`}
                onClick={() =>
                  setSelectedEvent(
                    selectedEvent?.round_number === evt.round_number ? null : evt,
                  )
                }
              >
                <div className="px-4 py-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-bold text-f1-muted">
                      ROUND {evt.round_number}
                    </span>
                    <span className="text-xs text-f1-muted">{evt.event_date}</span>
                  </div>
                  <h3 className="text-white font-bold mb-1">{evt.event_name}</h3>
                  <p className="text-sm text-f1-muted">
                    {evt.location}, {evt.country}
                  </p>
                </div>

                {/* Session buttons (shown when selected) */}
                {selectedEvent?.round_number === evt.round_number && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-f1-border pt-3">
                    {evt.sessions.map((session) => {
                      const code = SESSION_LABELS[session];
                      if (!code) return null;
                      return (
                        <a
                          key={session}
                          href={`/replay/${year}/${evt.round_number}?type=${code}`}
                          className="px-3 py-1.5 bg-f1-border text-white text-xs font-bold rounded hover:bg-f1-red transition-colors"
                        >
                          {session}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
