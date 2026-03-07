"use client";

interface Props {
  visible: boolean;
}

export default function TelemetryChart({ visible }: Props) {
  if (!visible) return null;

  return (
    <div className="bg-f1-card border-t border-f1-border p-6">
      <div className="text-center text-f1-muted py-8">
        <p className="text-sm">Telemetry charts coming soon</p>
        <p className="text-xs mt-1">Select two drivers to compare speed, throttle, and brake traces</p>
      </div>
    </div>
  );
}
