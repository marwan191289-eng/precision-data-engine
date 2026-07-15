import type { ElliottResult, Pivot, Projection, Trend, WavePoint, WaveSequence } from './types';
import { fibonacciScore } from './math';

// Canonical Fibonacci retracement/extension targets used across the engine.
const WAVE2_RETRACE_TARGETS = [0.382, 0.5, 0.618, 0.786];
const WAVE3_EXTENSION_TARGETS = [1.618, 2.0, 2.618];
const WAVE4_RETRACE_TARGETS = [0.236, 0.382, 0.5];
const WAVE5_PROJECTION_TARGETS = [0.618, 1.0, 1.618];

function priceOf(p: Pivot) {
  return p.price;
}

/** Evaluate a candidate 6-pivot sequence (0-1-2-3-4-5) for impulse-wave validity. */
function scoreImpulse(pivots: Pivot[], direction: 'up' | 'down'): WaveSequence {
  const [p0, p1, p2, p3, p4, p5] = pivots;
  const violations: string[] = [];

  const w1 = Math.abs(priceOf(p1) - priceOf(p0));
  const w2 = Math.abs(priceOf(p2) - priceOf(p1));
  const w3 = Math.abs(priceOf(p3) - priceOf(p2));
  const w4 = Math.abs(priceOf(p4) - priceOf(p3));
  const w5 = Math.abs(priceOf(p5) - priceOf(p4));

  // Rule 1: wave 2 never retraces more than 100% of wave 1.
  const w2RetracePct = w1 > 0 ? w2 / w1 : 0;
  if (w2RetracePct > 1) violations.push('Wave 2 retraced beyond the start of wave 1');

  // Rule 2: wave 3 is never the shortest among waves 1, 3, 5.
  const isW3Shortest = w3 < w1 && w3 < w5;
  if (isW3Shortest) violations.push('Wave 3 is the shortest impulse wave');

  // Rule 3: wave 4 does not overlap wave 1's price territory (non-diagonal impulses).
  const overlap =
    direction === 'up' ? priceOf(p4) < priceOf(p1) : priceOf(p4) > priceOf(p1);
  if (overlap) violations.push('Wave 4 overlaps wave 1 price territory');

  // Directional consistency: 1 and 3 and 5 move with trend, 2 and 4 move against it.
  const dirOk =
    direction === 'up'
      ? priceOf(p1) > priceOf(p0) &&
        priceOf(p2) < priceOf(p1) &&
        priceOf(p3) > priceOf(p2) &&
        priceOf(p4) < priceOf(p3) &&
        priceOf(p5) > priceOf(p4)
      : priceOf(p1) < priceOf(p0) &&
        priceOf(p2) > priceOf(p1) &&
        priceOf(p3) < priceOf(p2) &&
        priceOf(p4) > priceOf(p3) &&
        priceOf(p5) < priceOf(p4);
  if (!dirOk) violations.push('Wave points do not alternate direction correctly');

  // Fibonacci scoring: wave2 retrace, wave3 extension, wave4 retrace, wave5 vs wave1.
  const fib2 = fibonacciScore(w2RetracePct, WAVE2_RETRACE_TARGETS);
  const fib3 = fibonacciScore(w1 > 0 ? w3 / w1 : 0, WAVE3_EXTENSION_TARGETS);
  const fib4 = fibonacciScore(w3 > 0 ? w4 / w3 : 0, WAVE4_RETRACE_TARGETS);
  const fib5 = fibonacciScore(w1 > 0 ? w5 / w1 : 0, WAVE5_PROJECTION_TARGETS);
  const fibComposite = (fib2 * 0.3 + fib3 * 0.3 + fib4 * 0.2 + fib5 * 0.2) * 100;

  // Alternation: wave 2 and wave 4 should differ in character (sharp vs sideways).
  // Approximate "sharpness" via retrace ratio: deep+shallow pairing is ideal alternation.
  const w2Depth = w2RetracePct;
  const w4Depth = w3 > 0 ? w4 / w3 : 0;
  const alternationScore = Math.min(100, Math.abs(w2Depth - w4Depth) * 150);

  // Channel fit: waves 1, 3, 5 should roughly respect a parallel trend channel.
  // Approximate via consistency of (wave length / wave duration) across 1, 3, 5.
  const d1 = Math.max(1, p1.index - p0.index);
  const d3 = Math.max(1, p3.index - p2.index);
  const d5 = Math.max(1, p5.index - p4.index);
  const speeds = [w1 / d1, w3 / d3, w5 / d5];
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / 3;
  const speedVariance =
    avgSpeed > 0
      ? speeds.reduce((a, s) => a + Math.abs(s - avgSpeed) / avgSpeed, 0) / 3
      : 1;
  const channelFit = Math.max(0, 100 - speedVariance * 60);

  const truncated = w5 < w1 * 0.5;
  if (truncated) violations.push('Wave 5 shows possible truncation');

  // Base score starts from Fibonacci composite, penalized per rule violation
  // (hard rules cost more than the softer truncation/direction notes).
  let score = fibComposite;
  score -= violations.length * 12;
  score += (alternationScore - 50) * 0.1;
  score += (channelFit - 50) * 0.1;
  score = Math.max(0, Math.min(100, score));

  const points: WavePoint[] = pivots.map((p, idx) => ({
    index: p.index,
    time: p.time,
    price: p.price,
    label: String(idx),
  }));

  return {
    points,
    direction,
    degree: 'impulse',
    score,
    ruleViolations: violations,
    alternationScore,
    channelFit,
    truncated,
  };
}

/** Evaluate a 4-pivot A-B-C corrective sequence. */
function scoreCorrective(pivots: Pivot[], direction: 'up' | 'down'): WaveSequence {
  const [p0, pA, pB, pC] = pivots;
  const violations: string[] = [];

  const waveA = Math.abs(priceOf(pA) - priceOf(p0));
  const waveB = Math.abs(priceOf(pB) - priceOf(pA));
  const waveC = Math.abs(priceOf(pC) - priceOf(pB));

  const bRetrace = waveA > 0 ? waveB / waveA : 0;
  if (bRetrace > 1.05) violations.push('Wave B retraced beyond wave A start');

  const cExtension = waveA > 0 ? waveC / waveA : 0;
  const fibB = fibonacciScore(bRetrace, [0.382, 0.5, 0.618, 0.786]);
  const fibC = fibonacciScore(cExtension, [0.618, 1.0, 1.618]);
  const fibComposite = (fibB * 0.4 + fibC * 0.6) * 100;

  let score = Math.max(0, Math.min(100, fibComposite - violations.length * 15));

  const points: WavePoint[] = [
    { index: p0.index, time: p0.time, price: p0.price, label: '0' },
    { index: pA.index, time: pA.time, price: pA.price, label: 'A' },
    { index: pB.index, time: pB.time, price: pB.price, label: 'B' },
    { index: pC.index, time: pC.time, price: pC.price, label: 'C' },
  ];

  return {
    points,
    direction,
    degree: 'corrective',
    score,
    ruleViolations: violations,
    alternationScore: 50,
    channelFit: 50,
    truncated: false,
  };
}

function projectWave5(sequence: WaveSequence): Projection[] {
  if (sequence.points.length < 5) return [];
  const [p0, p1, , , p4] = sequence.points;
  const w1 = Math.abs(p1.price - p0.price);
  const base = p4.price;
  const sign = sequence.direction === 'up' ? 1 : -1;

  return WAVE5_PROJECTION_TARGETS.map((ratio) => ({
    label: `${(ratio * 100).toFixed(1)}%`,
    price: base + sign * w1 * ratio,
    fibRatio: ratio,
    probability: Math.max(20, 90 - Math.abs(ratio - 1.0) * 40),
  }));
}

/**
 * Search all plausible 6-point pivot windows (both directions) for the
 * highest-scoring valid Elliott impulse sequence, falling back to a
 * corrective A-B-C read when no impulse clears the bar.
 */
export function matchElliottWaves(pivots: Pivot[]): ElliottResult {
  const logs: string[] = [];
  if (pivots.length < 6) {
    logs.push(`Insufficient pivots for Elliott analysis (${pivots.length}/6 minimum)`);
    return {
      sequences: [],
      bestSequence: null,
      projections: [],
      trend: 'neutral',
      confidence: 0,
      currentWave: null,
      logs,
    };
  }

  const sequences: WaveSequence[] = [];

  // Slide a 6-pivot window across the whole pivot history so older and newer
  // wave counts are both considered; keep the best-scoring valid candidates.
  for (let start = 0; start <= pivots.length - 6; start++) {
    const window = pivots.slice(start, start + 6);
    const direction = window[0].type === 'low' ? 'up' : 'down';
    // A valid impulse window must alternate low/high/low/high/low/high (or reverse).
    const expectedTypes =
      direction === 'up'
        ? ['low', 'high', 'low', 'high', 'low', 'high']
        : ['high', 'low', 'high', 'low', 'high', 'low'];
    const alternates = window.every((p, i) => p.type === expectedTypes[i]);
    if (!alternates) continue;

    const seq = scoreImpulse(window, direction);
    if (seq.score > 25) sequences.push(seq);
  }

  // Corrective (A-B-C) fallback search over 4-pivot windows.
  for (let start = 0; start <= pivots.length - 4; start++) {
    const window = pivots.slice(start, start + 4);
    const direction = window[0].type === 'low' ? 'up' : 'down';
    const expectedTypes =
      direction === 'up' ? ['low', 'high', 'low', 'high'] : ['high', 'low', 'high', 'low'];
    const alternates = window.every((p, i) => p.type === expectedTypes[i]);
    if (!alternates) continue;
    const seq = scoreCorrective(window, direction);
    if (seq.score > 30) sequences.push(seq);
  }

  sequences.sort((a, b) => b.score - a.score);
  const bestSequence = sequences[0] ?? null;

  if (!bestSequence) {
    logs.push('No pivot window produced a valid Elliott wave count above threshold');
    return {
      sequences,
      bestSequence: null,
      projections: [],
      trend: 'neutral',
      confidence: 0,
      currentWave: null,
      logs,
    };
  }

  logs.push(
    `Best sequence: ${bestSequence.degree} ${bestSequence.direction} — score ${bestSequence.score.toFixed(1)}, ` +
      `${bestSequence.ruleViolations.length} rule flag(s), alternation ${bestSequence.alternationScore.toFixed(0)}, channel fit ${bestSequence.channelFit.toFixed(0)}`,
  );

  const projections = bestSequence.degree === 'impulse' ? projectWave5(bestSequence) : [];
  const trend: Trend =
    bestSequence.degree === 'impulse'
      ? bestSequence.direction === 'up'
        ? 'bullish'
        : 'bearish'
      : bestSequence.direction === 'up'
        ? 'bearish' // a completed up-correction implies resumed bearish bias
        : 'bullish';

  const currentWave =
    bestSequence.degree === 'impulse'
      ? bestSequence.points[bestSequence.points.length - 1]?.label ?? null
      : 'C';

  return {
    sequences: sequences.slice(0, 5),
    bestSequence,
    projections,
    trend,
    confidence: bestSequence.score,
    currentWave,
    logs,
  };
}
