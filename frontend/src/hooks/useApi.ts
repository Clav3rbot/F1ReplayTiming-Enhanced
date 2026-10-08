"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";

/**
 * Fetch a JSON API path. With `retryMs`, a failed request is retried on that
 * interval until it succeeds (for data the backend is still preparing, such
 * as a live weekend's track outline).
 */
export function useApi<T>(path: string | null, retryMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) {
      setData(null);
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(null);

    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        if (retryMs) retry = setTimeout(() => setAttempt((n) => n + 1), retryMs);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [path, retryMs, attempt]);

  return { data, loading, error };
}
