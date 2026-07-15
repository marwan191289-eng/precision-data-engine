import type { Candle, CVDResult, ElliottResult, LiquidityZone } from './types';

/**
 * Liquidity zones sit at rolling-window swing highs/lows where resting stop
 * orders are likely to cluster (buy-side liquidity above swing highs,
 * sell-side liquidity below swing lows). Breach state and Elliott/CVD
 * confluence are tracked so the UI can flag "swept" zones.
 */
export function detectLiquidityZones(
  candles: Candle[],
  elliott: ElliottResult | null,
  cvd: CVDResult | null,
  window = 15,
): LiquidityZone[] {
  if (candles.length < window * 2) return [];

  const zones: LiquidityZone[] = [];

  for (let i = window; i < candles.length - window; i++) {
    const leftSlice = candles.slice(i - window, i);
    const rightSlice = candles.slice(i + 1, i + window + 1);
    const combined = [...leftSlice, ...rightSlice];

    const isSwingHigh = combined.every((c) => c.high <= candles[i].high);
    const isSwingLow = combined.every((c) => c.low >= candles[i].low);

    if (isSwingHigh) {
      let breached = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high > candles[i].high) {
          breached = true;
          break;
        }
      }
      const confluence =
        (elliott?.bestSequence?.direction === 'down' && elliott.confidence > 45) ||
        cvd?.trend === 'bearish';
      const strength = Math.min(100, 55 + (confluence ? 25 : 0) + (breached ? -20 : 0));

      zones.push({
        index: i,
        time: candles[i].time,
        type: 'buy-side',
        price: candles[i].high,
        strength: Math.max(10, strength),
        breached,
        confluence: !!confluence,
      });
    }

    if (isSwingLow) {
      let breached = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low < candles[i].low) {
          breached = true;
          break;
        }
      }
      const confluence =
        (elliott?.bestSequence?.direction === 'up' && elliott.confidence > 45) ||
        cvd?.trend === 'bullish';
      const strength = Math.min(100, 55 + (confluence ? 25 : 0) + (breached ? -20 : 0));

      zones.push({
        index: i,
        time: candles[i].time,
        type: 'sell-side',
        price: candles[i].low,
        strength: Math.max(10, strength),
        breached,
        confluence: !!confluence,
      });
    }
  }

  return zones.slice(-20);
}
