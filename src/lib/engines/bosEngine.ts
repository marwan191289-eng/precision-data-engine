import type { BreakOfStructure, Candle, Pivot } from './types';

/** Per-index volume Z-Score using the preceding `window` candles. */
function volumeZScore(volumes: number[], idx: number, window = 20): number {
  const start = Math.max(0, idx - window);
  const slice = volumes.slice(start, idx + 1);
  const n = slice.length;
  const m = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - m) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 1;
  return (volumes[idx] - m) / std;
}

/**
 * Break of Structure / Change of Character detection.
 *
 * Improvements over v1:
 *  • Scans the last BOS_LOOKBACK candles (was last-candle only) — catches
 *    breaks that confirmed 1-4 bars ago but weren't re-detected on refresh.
 *  • Volume spike threshold uses Z-Score ≥ 1.5 (≈ top 7% of bars) rather
 *    than the arbitrary 1.4× multiplier — adapts to current ATR/volatility.
 *  • Returns the most recent (highest-index) valid break; ties broken by
 *    strength so the strongest recent event wins.
 */
export function detectBreakOfStructure(candles: Candle[], pivots: Pivot[]): BreakOfStructure | null {
  if (candles.length < 5 || pivots.length < 3) return null;

  const volumes = candles.map((c) => c.volume);
  const recentHighs = pivots.filter((p) => p.type === 'high');
  const recentLows  = pivots.filter((p) => p.type === 'low');
  const lastHigh    = recentHighs[recentHighs.length - 1];
  const lastLow     = recentLows[recentLows.length - 1];

  const BOS_LOOKBACK = 5; // scan last N closed candles
  const candidates: BreakOfStructure[] = [];

  for (let lb = 1; lb <= BOS_LOOKBACK; lb++) {
    const idx = candles.length - lb;
    if (idx < 0) continue;
    const c = candles[idx];

    const zScore    = volumeZScore(volumes, idx);
    // Z-Score ≥ 1.5 ≈ top ~7% of volume bars — replaces hardcoded 1.4×
    const bigVolume = zScore >= 1.5;
    // Scale extra strength by how extreme the volume is (capped at +20)
    const volBonus  = bigVolume ? Math.min(20, 10 + zScore * 3) : 0;

    // ── Bullish BOS: price closes above last swing high ──────────────────
    if (lastHigh && c.close > lastHigh.price && lastHigh.index < idx) {
      const isCHoCH =
        recentHighs.length >= 2 &&
        recentHighs[recentHighs.length - 2].price > lastHigh.price;
      const strength = Math.min(100, 55 + volBonus + (isCHoCH ? 10 : 0));
      candidates.push({
        index: idx,
        time: c.time,
        type: 'bullish',
        level: lastHigh.price,
        strength,
        isChangeOfCharacter: isCHoCH,
      });
    }

    // ── Bearish BOS: price closes below last swing low ───────────────────
    if (lastLow && c.close < lastLow.price && lastLow.index < idx) {
      const isCHoCH =
        recentLows.length >= 2 &&
        recentLows[recentLows.length - 2].price < lastLow.price;
      const strength = Math.min(100, 55 + volBonus + (isCHoCH ? 10 : 0));
      candidates.push({
        index: idx,
        time: c.time,
        type: 'bearish',
        level: lastLow.price,
        strength,
        isChangeOfCharacter: isCHoCH,
      });
    }
  }

  if (candidates.length === 0) return null;
  // Most recent break wins; ties go to the stronger one
  return candidates.sort((a, b) => b.index - a.index || b.strength - a.strength)[0];
}
