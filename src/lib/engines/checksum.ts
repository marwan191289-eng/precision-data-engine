// Stable, order-independent checksum — ported verbatim from
// precision-data-engine. Used to give every analysis run a short,
// reproducible fingerprint: if two runs on the same closed candles
// produce the same checksum, the pipeline is deterministic; if they
// differ unexpectedly, that's a real signal something changed (data,
// code, or model state).

export function checksum(value: unknown): string {
  const s = stableJson(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson((v as Record<string, unknown>)[k])).join(",") + "}";
}
