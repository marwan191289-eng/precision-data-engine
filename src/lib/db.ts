// Local audit trail — ported and adapted from precision-data-engine's
// db.ts. Every full analysis run is logged with its composite score,
// audit score (from verify.ts) and a checksum, so a user can go back and
// see exactly what the system said, when, and how corroborated it was —
// this is the "credibility & transparency" backbone of the merged system.

import Dexie, { type Table } from "dexie";
import { checksum } from "./engines/checksum";
import type { AuditResult } from "./engines/verify";

export interface AnalysisRunRecord {
  id?: number;
  symbol: string;
  interval: string;
  timestamp: number;
  price: number;
  compositeScore: number;
  uncertainty: number;
  auditScore: number;
  checksum: string;
  alert: string | null;
  auditFlags: string[]; // names of failed checks only, for quick scanning
}

export interface AlertRecord {
  id?: number;
  symbol: string;
  interval: string;
  message: string;
  compositeScore: number;
  createdAt: number;
  read: boolean;
}

class TradingAuditDB extends Dexie {
  runs!: Table<AnalysisRunRecord, number>;
  alerts!: Table<AlertRecord, number>;
  constructor() {
    super("accurate-engine-terminal-audit");
    this.version(1).stores({
      runs: "++id, symbol, interval, timestamp",
      alerts: "++id, symbol, createdAt, read",
    });
  }
}

export const db: TradingAuditDB | null =
  typeof indexedDB !== "undefined" ? new TradingAuditDB() : null;

export function computeRunChecksum(input: {
  symbol: string;
  interval: string;
  timestamp: number;
  compositeScore: number;
  auditScore: number;
}): string {
  return checksum(input);
}

/** Fire-and-forget: never let audit persistence break the live analysis loop. */
export async function saveAnalysisRun(
  rec: Omit<AnalysisRunRecord, "id" | "checksum">,
): Promise<void> {
  if (!db) return;
  try {
    const record: AnalysisRunRecord = { ...rec, checksum: computeRunChecksum(rec) };
    await db.runs.add(record);
    // Keep the local audit trail bounded — retain the most recent 2000 runs.
    const count = await db.runs.count();
    if (count > 2000) {
      const oldest = await db.runs.orderBy("timestamp").limit(count - 2000).toArray();
      await db.runs.bulkDelete(oldest.map((r) => r.id!).filter(Boolean));
    }
  } catch {
    // Swallow persistence errors — the audit log is a convenience, not a
    // dependency of the trading loop.
  }
}

export async function saveAlert(rec: Omit<AlertRecord, "id" | "createdAt" | "read">): Promise<void> {
  if (!db) return;
  try {
    await db.alerts.add({ ...rec, createdAt: Date.now(), read: false });
  } catch {
    // same rationale as above
  }
}

export async function recentRuns(symbol?: string, limit = 100): Promise<AnalysisRunRecord[]> {
  if (!db) return [];
  const q = symbol ? db.runs.where("symbol").equals(symbol) : db.runs.toCollection();
  return q.reverse().sortBy("timestamp").then((r) => r.slice(0, limit));
}

export function summarizeAudit(audit: AuditResult): string[] {
  return audit.checks.filter((c) => !c.ok).map((c) => c.name);
}
