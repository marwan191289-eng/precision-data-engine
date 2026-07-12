import * as Comlink from "comlink";
import type { EngineWorkerAPI } from "@/workers/engine.worker";
import type { EngineId, EngineResult } from "@/lib/engines/types";

const POOL_SIZE = typeof navigator !== "undefined"
  ? Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))
  : 2;

interface Slot {
  worker: Worker;
  api: Comlink.Remote<EngineWorkerAPI>;
  busy: boolean;
}

let pool: Slot[] | null = null;

function ensurePool(): Slot[] {
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, () => {
    const w = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
    return { worker: w, api: Comlink.wrap<EngineWorkerAPI>(w), busy: false };
  });
  return pool;
}

export function poolSize() { return POOL_SIZE; }
export function activeCount() { return pool?.filter(s => s.busy).length ?? 0; }

function acquire(): Promise<Slot> {
  const slots = ensurePool();
  const free = slots.find(s => !s.busy);
  if (free) { free.busy = true; return Promise.resolve(free); }
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const s = ensurePool().find(x => !x.busy);
      if (s) { s.busy = true; clearInterval(iv); resolve(s); }
    }, 12);
  });
}

export async function runInWorker<T = unknown>(id: EngineId, input: unknown): Promise<EngineResult<T>> {
  const slot = await acquire();
  try { return (await slot.api.run(id, input)) as EngineResult<T>; }
  finally { slot.busy = false; }
}

export async function verifyInWorker(id: EngineId, input: unknown, result: EngineResult) {
  const slot = await acquire();
  try { return await slot.api.verify(id, input, result); }
  finally { slot.busy = false; }
}

export async function runBatch<T = unknown>(id: EngineId, inputs: unknown[]): Promise<EngineResult<T>[]> {
  return Promise.all(inputs.map(input => runInWorker<T>(id, input)));
}