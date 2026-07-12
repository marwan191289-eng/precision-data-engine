export function parseVector(input: string): number[] {
  return input
    .replace(/[\[\]()]/g, " ")
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isFinite(n));
}

export function vectorToString(v: number[]): string {
  return v.map(x => Number(x.toPrecision(8)).toString()).join(", ");
}