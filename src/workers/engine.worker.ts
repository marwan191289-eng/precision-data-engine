/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { engines } from "@/lib/engines/registry";
import type { EngineId } from "@/lib/engines/types";

const api = {
  run(id: EngineId, input: unknown) {
    const engine = engines[id];
    if (!engine) throw new Error(`Unknown engine ${id}`);
    return engine.run(input);
  },
  verify(id: EngineId, input: unknown, result: unknown) {
    const engine = engines[id];
    if (!engine?.verify) return { ok: true, absError: 0, note: "no oracle" };
    return engine.verify(input, result as never);
  },
};

export type EngineWorkerAPI = typeof api;

Comlink.expose(api);