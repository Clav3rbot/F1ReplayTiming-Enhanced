"use client";

interface Props {
  eventName: string;
  circuit: string;
  country: string;
  sessionType: string;
  year: number;
}

const SESSION_LABELS: Record<string, string> = {
  R: "Race",
  Q: "Qualifying",
  S: "Sprint",
  SQ: "Sprint Qualifying",
  FP1: "Practice 1",
  FP2: "Practice 2",
  FP3: "Practice 3",
};

export default function SessionBanner({ eventName, circuit, country, sessionType, year }: Props) {
  return (
    <div className="bg-f1-card border-b border-f1-border px-6 py-3 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-white">
          {year} {eventName}
        </h1>
        <p className="text-sm text-f1-muted">
          {circuit}, {country}
        </p>
      </div>
      <div className="bg-f1-red px-4 py-1 rounded text-white font-bold text-sm uppercase">
        {SESSION_LABELS[sessionType] || sessionType}
      </div>
    </div>
  );
}
