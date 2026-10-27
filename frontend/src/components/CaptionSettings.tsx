"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";

// Server-wide caption settings (/api/captions/settings): the Whisper model
// for replays and live timing.

interface ModelOption { id: string; label: string; size?: string; note: string }
interface ModelStatus { state: "ready" | "downloading" | "missing" | "error" | "unavailable"; downloaded_bytes?: number; total_bytes?: number | null; error?: string }
interface Settings {
  whisper_model: string;
  whisper_model_locked: boolean;
  whisper_models: ModelOption[];
  live_whisper_model: string | null;
  live_whisper_model_locked: boolean;
  model_status: Record<string, ModelStatus>;
  editable: boolean;
}
type Draft = Pick<Settings, "whisper_model" | "live_whisper_model">;

function request(init?: RequestInit) {
  const token = getToken();
  return fetch(apiUrl("/api/captions/settings"), {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

function statusText(s: ModelStatus | undefined): string {
  if (!s) return "";
  if (s.state === "ready") return "On this server";
  if (s.state === "downloading") {
    const pct = s.total_bytes ? Math.min(99, Math.round(((s.downloaded_bytes ?? 0) / s.total_bytes) * 100)) : null;
    return pct != null ? `Downloading… ${pct}%` : "Downloading…";
  }
  if (s.state === "error") return s.error ?? "Download failed";
  return "Downloads when saved";
}

const SELECT = "w-full bg-f1-dark border border-f1-border rounded px-2 py-1 text-xs text-ink disabled:opacity-50";
const LABEL = "text-[10px] font-bold uppercase tracking-wider text-f1-muted";

export default function CaptionSettings() {
  const [server, setServer] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = (s: Settings) => {
    setServer(s);
    setDraft({ whisper_model: s.whisper_model, live_whisper_model: s.live_whisper_model });
  };

  useEffect(() => {
    request().then((r) => (r.ok ? r.json() : Promise.reject())).then(adopt).catch(() => setError("Couldn't load the caption settings."));
  }, []);

  // Download progress: refresh the model status while one is downloading
  const downloading = !!server && Object.values(server.model_status).some((s) => s.state === "downloading");
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => {
      request().then((r) => (r.ok ? r.json() : null)).then((s: Settings | null) => s && setServer(s)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [downloading]);

  if (error && !server) return <p className="px-2 sm:px-6 py-2 text-xs text-f1-muted">{error}</p>;
  if (!server || !draft) return <p className="px-2 sm:px-6 py-2 text-xs text-f1-muted">Loading…</p>;

  const changed = draft.whisper_model !== server.whisper_model || draft.live_whisper_model !== server.live_whisper_model;
  const locked = !server.editable;

  async function save() {
    if (!server || !draft) return;
    setSaving(true);
    setError(null);
    const body: Partial<Draft> = {};
    if (!server.whisper_model_locked && draft.whisper_model !== server.whisper_model) body.whisper_model = draft.whisper_model;
    if (!server.live_whisper_model_locked && draft.live_whisper_model !== server.live_whisper_model) body.live_whisper_model = draft.live_whisper_model;
    try {
      const res = await request({ method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? "Couldn't save the caption settings.");
      adopt(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the caption settings.");
    } finally {
      setSaving(false);
    }
  }

  const modelNote = (id: string) => server.whisper_models.find((m) => m.id === id);
  const replayModel = modelNote(draft.whisper_model);
  const liveId = draft.live_whisper_model ?? draft.whisper_model;

  return (
    <div className="px-2 sm:px-6 py-2 space-y-3">
      <p className="text-[11px] text-f1-muted leading-relaxed">
        Captions are made on the server with Whisper. These settings are for everyone using this server and apply from the next clip.
      </p>

      <div className="space-y-1">
        <div className={LABEL}>Caption model (replays)</div>
        <select
          className={SELECT}
          value={draft.whisper_model}
          disabled={locked || server.whisper_model_locked}
          onChange={(e) => setDraft({ ...draft, whisper_model: e.target.value })}
        >
          {server.whisper_models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.size})</option>)}
        </select>
        <p className="text-[10px] text-f1-muted">
          {replayModel?.note} · {statusText(server.model_status[draft.whisper_model])}
          {server.whisper_model_locked && " · Set by TEAM_RADIO_MODEL"}
        </p>
      </div>

      <div className="space-y-1">
        <div className={LABEL}>Caption model (live timing)</div>
        <select
          className={SELECT}
          value={draft.live_whisper_model ?? ""}
          disabled={locked || server.live_whisper_model_locked}
          onChange={(e) => setDraft({ ...draft, live_whisper_model: e.target.value || null })}
        >
          <option value="">Same as replays</option>
          {server.whisper_models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.size})</option>)}
        </select>
        <p className="text-[10px] text-f1-muted">
          A live caption has to be ready within your broadcast delay.{draft.live_whisper_model ? ` · ${statusText(server.model_status[liveId])}` : ""}
          {server.live_whisper_model_locked && " · Set by TEAM_RADIO_LIVE_MODEL"}
        </p>
      </div>

      {locked ? (
        <p className="text-[10px] text-f1-muted">Changing these needs AUTH_ENABLED or ALLOW_REPROCESS=true on the server.</p>
      ) : (
        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-[10px] text-f1-red">{error}</span>}
          <button
            onClick={save}
            disabled={!changed || saving}
            className="px-3 py-1 rounded bg-f1-red text-white text-xs font-bold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
