import { useEffect, useState } from "react";
import { db, channel, type RunRecord, type AlertRecord } from "@/lib/db";

export function useRuns(limit = 200) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    const refresh = async () => {
      const rows = await db.runs.orderBy("createdAt").reverse().limit(limit).toArray();
      if (!cancelled) setRuns(rows);
    };
    refresh();
    const onMsg = () => refresh();
    channel?.addEventListener("message", onMsg);
    return () => { cancelled = true; channel?.removeEventListener("message", onMsg); };
  }, [limit]);
  return runs;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    const refresh = async () => {
      const rows = await db.alerts.orderBy("createdAt").reverse().limit(100).toArray();
      if (!cancelled) setAlerts(rows);
    };
    refresh();
    const onMsg = () => refresh();
    channel?.addEventListener("message", onMsg);
    return () => { cancelled = true; channel?.removeEventListener("message", onMsg); };
  }, []);
  return alerts;
}