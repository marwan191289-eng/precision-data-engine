import type { Candle, CVDResult, ElliottResult, EquilibriumZone, Pivot, SMCResult } from './types';
import { detectOrderBlocks } from './orderBlockEngine';
import { detectFairValueGaps } from './fvgEngine';
import { detectLiquidityZones } from './liquidityEngine';
import { detectBreakOfStructure } from './bosEngine';

function computeEquilibrium(candles: Candle[]): EquilibriumZone | null {
  if (candles.length < 30) return null;
  const window = candles.slice(-100);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const range = high - low;
  if (range <= 0) return null;

  const equilibrium = low + range * 0.5;
  const premiumBottom = low + range * 0.618;
  const discountTop = low + range * 0.382;
  const lastPrice = candles[candles.length - 1].close;

  const pricePosition: EquilibriumZone['pricePosition'] =
    lastPrice > premiumBottom ? 'premium' : lastPrice < discountTop ? 'discount' : 'equilibrium';

  return {
    premiumTop: high,
    premiumBottom,
    equilibrium,
    discountTop,
    discountBottom: low,
    pricePosition,
  };
}

/**
 * Orchestrates the four Smart Money Concepts sub-engines and derives an
 * overall directional bias from the highest-conviction evidence: critical
 * order blocks, the latest break of structure, and premium/discount position.
 */
export function analyzeSMC(
  candles: Candle[],
  pivots: Pivot[],
  elliott: ElliottResult | null,
  cvd: CVDResult | null,
): SMCResult {
  const logs: string[] = [];

  const orderBlocks = detectOrderBlocks(candles, elliott, cvd);
  const criticalOrderBlocks = orderBlocks.filter((b) => b.critical);
  const fairValueGaps = detectFairValueGaps(candles);
  const liquidityZones = detectLiquidityZones(candles, elliott, cvd);
  const breakOfStructure = detectBreakOfStructure(candles, pivots);
  const equilibrium = computeEquilibrium(candles);

  let bullishVotes = 0;
  let bearishVotes = 0;

  for (const ob of criticalOrderBlocks) {
    if (ob.type === 'bullish') bullishVotes += 2;
    else bearishVotes += 2;
  }
  if (breakOfStructure) {
    if (breakOfStructure.type === 'bullish') bullishVotes += breakOfStructure.isChangeOfCharacter ? 3 : 1.5;
    else bearishVotes += breakOfStructure.isChangeOfCharacter ? 3 : 1.5;
  }
  if (equilibrium?.pricePosition === 'discount') bullishVotes += 1;
  if (equilibrium?.pricePosition === 'premium') bearishVotes += 1;

  const bias = bullishVotes === bearishVotes ? 'neutral' : bullishVotes > bearishVotes ? 'bullish' : 'bearish';

  logs.push(
    `SMC: ${orderBlocks.length} order blocks (${criticalOrderBlocks.length} critical), ${fairValueGaps.length} FVGs, ` +
      `${liquidityZones.length} liquidity zones, BOS=${breakOfStructure?.type ?? 'none'}, bias=${bias}`,
  );

  return { orderBlocks, criticalOrderBlocks, fairValueGaps, liquidityZones, breakOfStructure, equilibrium, bias, logs };
}
