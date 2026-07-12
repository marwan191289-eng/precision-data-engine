import Dexie, { type Table } from "dexie";
import type { EngineId, EngineResult } from "./engines/types";

export interface RunRecord {
  id?: number;
  engineId: EngineId;
  input: unknown;
  result: EngineResult;
  createdAt: number;
  status: "ok" | "failed";
  errorMessage?: string;
}

export interface AlertRecord {
  id?: number;
  kind: "completed" | "failed" | "threshold";
  engineId: EngineId;
  message: string;
  createdAt: number;
  read: boolean;
}

class PesDB extends Dexie {
  runs!: Table<RunRecord, number>;
  alerts!: Table<AlertRecord, number>;
  constructor() {
    super("precision-engine-suite");
    this.version(1).stores({
      runs: "++id, engineId, createdAt, status",
      alerts: "++id, kind, engineId, createdAt, read",
    });
  }
}

export const db: PesDB | null = typeof indexedDB !== "undefined" ? new PesDB() : null;

export const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pes-sync") : null;

export type SyncEvent =
  | { type: "run"; record: RunRecord }
  | { type: "alert"; record: AlertRecord }
  | { type: "clear" };

export function publish(ev: SyncEvent) { channel?.postMessage(ev); }

export async function saveRun(rec: Omit<RunRecord, "id" | "createdAt">) {
  if (!db) throw new Error("IndexedDB unavailable");
  const record: RunRecord = { ...rec, createdAt: Date.now() };
  const id = await db.runs.add(record);
  const full = { ...record, id };
  publish({ type: "run", record: full });
  return full;
}

export async function saveAlert(rec: Omit<AlertRecord, "id" | "createdAt" | "read">) {
  if (!db) throw new Error("IndexedDB unavailable");
  const record: AlertRecord = { ...rec, createdAt: Date.now(), read: false };
  const id = await db.alerts.add(record);
  publish({ type: "alert", record: { ...record, id } });
  return { ...record, id };
}

export async function clearAll() {
  if (!db) return;
  await db.runs.clear();
  await db.alerts.clear();
  publish({ type: "clear" });
}