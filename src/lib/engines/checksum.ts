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

export function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return String(n);
  if (Object.is(n, -0)) n = 0;
  return Number(n.toPrecision(digits)).toString();
}