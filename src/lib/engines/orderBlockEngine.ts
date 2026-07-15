import type { Candle, ElliottResult, CVDResult, OrderBlock } from './types';
import { slidingWindowAverage } from './math';

/** Per-index volume Z-Score (preceding `window` candles). */
function volZScore(volumes: number[], idx: number, window = 20): number {
  const start = Math.max(0, idx - window);
  const slice = volumes.slice(start, idx + 1);
  const n = slice.length;
  const m = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - m) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 1;
  return (volumes[idx] - m) / std;
}

const MIN_STRENGTH = 30;

/**
 * Detects order blocks: the last opposing candle before a decisive
 * break-of-structure move. Confluence with Elliott wave position and CVD
 * trend boosts the block's strength; mitigation/partial-mitigation is tracked
 * against all subsequent candles.
 */
export function detectOrderBlocks(
  candles: Candle[],
  elliott: ElliottResult | null,
  cvd: CVDResult | null,
): OrderBlock[] {
  if (candles.length < 10) return [];

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const avgVolume = slidingWindowAverage(volumes, 20);

  const blocks: OrderBlock[] = [];

  for (let i = 3; i < candles.length - 1; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    // Bullish OB: last bearish candle before a strong bullish displacement.
    const bullishDisplacement =
      curr.close > curr.open &&
      curr.close - curr.open > (curr.high - curr.low) * 0.5 &&
      curr.close > prev.high;
    const prevBearish = prev.close < prev.open;

    if (bullishDisplacement && prevBearish) {
      // Z-Score ≥ 1.0 = top ~16% of bars — replaces arbitrary avgVol × 1.3
      const zs = volZScore(volumes, i);
      const volumeBoost = zs >= 1.0 ? Math.min(20, 10 + zs * 4) : 0;
      let strength = 45 + volumeBoost;

      const elliottConfluence =
        elliott?.bestSequence?.direction === 'up' && elliott.confidence > 40;
      const cvdConfluence = cvd?.trend === 'bullish';
      if (elliottConfluence) strength += 20;
      if (cvdConfluence) strength += 15;

      const top = prev.high;
      const bottom = prev.low;

      // Mitigation: has price returned into the block afterward?
      let mitigated = false;
      let partiallyMitigated = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low <= top && candles[j].low >= bottom) partiallyMitigated = true;
        if (candles[j].low <= bottom) {
          mitigated = true;
          break;
        }
      }

      strength = Math.min(100, strength);
      if (strength >= MIN_STRENGTH) {
        blocks.push({
          index: i - 1,
          time: prev.time,
          type: 'bullish',
          top,
          bottom,
          strength,
          mitigated,
          partiallyMitigated,
          elliottConfluence: !!elliottConfluence,
          cvdConfluence,
          critical: strength > 70 && !!elliottConfluence && !mitigated,
        });
      }
    }

    // Bearish OB: last bullish candle before a strong bearish displacement.
    const bearishDisplacement =
      curr.close < curr.open &&
      curr.open - curr.close > (curr.high - curr.low) * 0.5 &&
      curr.close < prev.low;
    const prevBullish = prev.close > prev.open;

    if (bearishDisplacement && prevBullish) {
      const zs = volZScore(volumes, i);
      const volumeBoost = zs >= 1.0 ? Math.min(20, 10 + zs * 4) : 0;
      let strength = 45 + volumeBoost;

      const elliottConfluence =
        elliott?.bestSequence?.direction === 'down' && elliott.confidence > 40;
      const cvdConfluence = cvd?.trend === 'bearish';
      if (elliottConfluence) strength += 20;
      if (cvdConfluence) strength += 15;

      const top = prev.high;
      const bottom = prev.low;

      let mitigated = false;
      let partiallyMitigated = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high >= bottom && candles[j].high <= top) partiallyMitigated = true;
        if (candles[j].high >= top) {
          mitigated = true;
          break;
        }
      }

      strength = Math.min(100, strength);
      if (strength >= MIN_STRENGTH) {
        blocks.push({
          index: i - 1,
          time: prev.time,
          type: 'bearish',
          top,
          bottom,
          strength,
          mitigated,
          partiallyMitigated,
          elliottConfluence: !!elliottConfluence,
          cvdConfluence,
          critical: strength > 70 && !!elliottConfluence && !mitigated,
        });
      }
    }
  }

  // Dedupe blocks that sit within the same price band (keep the strongest).
  const deduped: OrderBlock[] = [];
  const bandWidth = closes[closes.length - 1] * 0.002;
  for (const block of blocks) {
    const overlapIdx = deduped.findIndex(
      (b) => b.type === block.type && Math.abs(b.top - block.top) < bandWidth,
    );
    if (overlapIdx === -1) {
      deduped.push(block);
    } else if (block.strength > deduped[overlapIdx].strength) {
      deduped[overlapIdx] = block;
    }
  }

  return deduped.slice(-15);
}
