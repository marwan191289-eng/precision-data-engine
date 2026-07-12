import Papa from "papaparse";
import type { EngineResult } from "./engines/types";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function exportRunToCsv(result: EngineResult) {
  if (!result.table) return;
  const csv = Papa.unparse({ fields: result.table.columns, data: result.table.rows });
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `pes-${result.engineId}-${result.checksum}.csv`);
}

export function exportRunToJson(result: EngineResult) {
  download(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    `pes-${result.engineId}-${result.checksum}.json`);
}