/**
 * LSTM training Web Worker.
 *
 * Runs the full Bi-LSTM training pipeline on a background thread so the UI
 * never freezes during the 5-15 min CPU training session on Replit.
 *
 * Protocol:
 *   main → worker  { type: 'train', candles: Candle[] }
 *   worker → main  { type: 'progress', phase, epoch, totalEpochs, valLoss, dirAcc }
 *   worker → main  { type: 'complete', weightData: number[][], shapes: number[][], valDirectionAccuracy }
 *   worker → main  { type: 'error', message }
 */
import * as tf from '@tensorflow/tfjs';
import type { Candle } from '@/lib/engines/types';

// ── Constants (must match lstmEngine.ts exactly) ─────────────────────────────
const SEQ_LEN   = 64;
const N_FEATURES = 16;
const MAX_FAST_EPOCHS = 15;
const MAX_FULL_EPOCHS = 60;
const EARLY_STOP_PATIENCE = 6;
const MIN_TRAIN_CANDLES   = 260;

// ── Pure math helpers ─────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function logReturn(a: number, b: number) { return a > 0 && b > 0 ? Math.log(b / a) : 0; }
function mean(arr: number[]) { return arr.reduce((s, x) => s + x, 0) / (arr.length || 1); }
function stdDev(arr: number[]) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length || 1));
}

function emaSeries(vals: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(vals.length).fill(0);
  out[0] = vals[0];
  for (let i = 1; i < vals.length; i++) out[i] = vals[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  if (al === 0) { out[period] = 100; } else out[period] = 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function macdHistSeries(closes: number[], fast = 12, slow = 26, sig = 9): number[] {
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const macd  = fastE.map((v, i) => v - slowE[i]);
  const signal = emaSeries(macd, sig);
  return macd.map((v, i) => v - signal[i]);
}

function bollingerPercentBSeries(closes: number[], period = 20, mult = 2): number[] {
  const out = new Array(closes.length).fill(0.5);
  for (let i = period - 1; i < closes.length; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const m  = mean(sl);
    const s  = stdDev(sl);
    out[i] = s > 0 ? (closes[i] - (m - mult * s)) / (2 * mult * s) : 0.5;
  }
  return out;
}

function atrSeries(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const trs = highs.map((h, i) =>
    i === 0 ? h - lows[i]
      : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  let sum = 0;
  const out = new Array(trs.length).fill(0);
  for (let i = 0; i < trs.length; i++) {
    sum += trs[i];
    if (i >= period) sum -= trs[i - period];
    out[i] = sum / Math.min(i + 1, period);
  }
  return out;
}

function slidingWindowAverage(vals: number[], w: number): number[] {
  let s = 0;
  const out = new Array(vals.length).fill(0);
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= w) s -= vals[i - w];
    out[i] = s / Math.min(i + 1, w);
  }
  return out;
}

function slidingWindowStd(vals: number[], w: number): number[] {
  const out = new Array(vals.length).fill(0);
  for (let i = 0; i < vals.length; i++) {
    const sl = vals.slice(Math.max(0, i - w + 1), i + 1);
    out[i] = stdDev(sl);
  }
  return out;
}

// ── Feature matrix (exactly 16 features, matching lstmEngine.ts) ─────────────
interface FeatureStats { mean: number[]; std: number[]; }

function buildFeatureMatrix(candles: Candle[]): { closes: number[]; rows: number[][] } {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const opens   = candles.map(c => c.open);
  const vols    = candles.map(c => c.volume);
  const taker   = candles.map(c => c.takerBuyBaseVolume);
  const atrs    = atrSeries(highs, lows, closes, 14);
  const rsi     = rsiSeries(closes, 14);
  const macdH   = macdHistSeries(closes, 12, 26, 9);
  const bbB     = bollingerPercentBSeries(closes, 20, 2);
  const ema9    = emaSeries(closes, 9);
  const ema21   = emaSeries(closes, 21);
  const ema50   = emaSeries(closes, 50);
  const volAvg  = slidingWindowAverage(vols, 20);
  const volStd  = slidingWindowStd(vols, 20);
  const rows: number[][] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const p = closes[i];
    const prev = closes[i - 1] ?? p;
    const p5   = closes[i - 5]  ?? p;
    const p10  = closes[i - 10] ?? p;
    const rng  = highs[i] - lows[i] || 1e-9;
    const body = Math.abs(closes[i] - opens[i]);
    const upW  = highs[i] - Math.max(closes[i], opens[i]);
    const loW  = Math.min(closes[i], opens[i]) - lows[i];
    const timb = vols[i] > 0 ? (2 * taker[i] - vols[i]) / vols[i] : 0;
    const volZ = volStd[i] > 0 ? (vols[i] - volAvg[i]) / volStd[i] : 0;
    rows[i] = [
      logReturn(prev, p),
      logReturn(p5,  p),
      logReturn(p10, p),
      p > 0 ? atrs[i] / p : 0,
      (rsi[i] - 50) / 50,
      p > 0 ? macdH[i] / p : 0,
      bbB[i] - 0.5,
      p > 0 ? (ema9[i]  - p) / p : 0,
      p > 0 ? (ema21[i] - p) / p : 0,
      p > 0 ? (ema50[i] - p) / p : 0,
      p > 0 ? (ema9[i] - ema21[i]) / p : 0,
      Math.log1p(vols[i]),
      clamp(volZ, -6, 6),
      clamp(timb, -1, 1),
      body / rng,
      (upW - loW) / rng,
    ];
  }
  return { closes, rows };
}

function computeStats(rows: number[][]): FeatureStats {
  const mn = new Array(N_FEATURES).fill(0);
  const sd = new Array(N_FEATURES).fill(1);
  for (let f = 0; f < N_FEATURES; f++) {
    let m = 0;
    for (const r of rows) m += r[f];
    m /= rows.length || 1;
    let v = 0;
    for (const r of rows) v += (r[f] - m) ** 2;
    v /= Math.max(1, rows.length - 1);
    mn[f] = m;
    sd[f] = Math.sqrt(v) || 1;
  }
  return { mean: mn, std: sd };
}

function normalizeRow(row: number[], s: FeatureStats): number[] {
  return row.map((v, i) => clamp((v - s.mean[i]) / (s.std[i] || 1), -6, 6));
}

// ── Model architectures ───────────────────────────────────────────────────────
function buildFastModel(): tf.LayersModel {
  const input = tf.input({ shape: [SEQ_LEN, N_FEATURES] });
  const lstm  = tf.layers.lstm({ units: 32, returnSequences: false }).apply(input) as tf.SymbolicTensor;
  const drop  = tf.layers.dropout({ rate: 0.2 }).apply(lstm) as tf.SymbolicTensor;
  const dense = tf.layers.dense({ units: 16, activation: 'relu' }).apply(drop) as tf.SymbolicTensor;
  const dir   = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'direction' }).apply(dense) as tf.SymbolicTensor;
  const ret   = tf.layers.dense({ units: 1, activation: 'linear',  name: 'return'    }).apply(dense) as tf.SymbolicTensor;
  const m = tf.model({ inputs: input, outputs: [dir, ret] });
  m.compile({ optimizer: tf.train.adam(0.001), loss: ['binaryCrossentropy', 'meanSquaredError'] });
  return m;
}

function buildFullModel(): tf.LayersModel {
  const input = tf.input({ shape: [SEQ_LEN, N_FEATURES] });
  const biLstm1 = tf.layers.bidirectional({
    layer: tf.layers.lstm({ units: 64, returnSequences: true }) as tf.RNN,
  }).apply(input) as tf.SymbolicTensor;
  const biLstm2 = tf.layers.bidirectional({
    layer: tf.layers.lstm({ units: 32, returnSequences: true }) as tf.RNN,
  }).apply(biLstm1) as tf.SymbolicTensor;
  const drop1 = tf.layers.dropout({ rate: 0.25 }).apply(biLstm2) as tf.SymbolicTensor;
  // Soft-attention pooling
  const attnScores = tf.layers.dense({ units: 1, activation: 'tanh' }).apply(drop1) as tf.SymbolicTensor;
  const attnWeights = tf.layers.softmax({ axis: 1 }).apply(attnScores) as tf.SymbolicTensor;
  const context = tf.layers.multiply().apply([biLstm2, attnWeights]) as tf.SymbolicTensor;
  const pooled  = tf.layers.globalAveragePooling1d().apply(context) as tf.SymbolicTensor;
  const drop2   = tf.layers.dropout({ rate: 0.2 }).apply(pooled) as tf.SymbolicTensor;
  const dense   = tf.layers.dense({ units: 32, activation: 'relu' }).apply(drop2) as tf.SymbolicTensor;
  const dir = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'direction' }).apply(dense) as tf.SymbolicTensor;
  const ret = tf.layers.dense({ units: 1, activation: 'linear',  name: 'return'    }).apply(dense) as tf.SymbolicTensor;
  const m = tf.model({ inputs: input, outputs: [dir, ret] });
  m.compile({
    optimizer: tf.train.adam(0.0008),
    loss: ['binaryCrossentropy', 'meanSquaredError'],
  });
  return m;
}

// ── Serialise weights for postMessage transfer ────────────────────────────────
async function serializeWeights(m: tf.LayersModel) {
  const ws = m.getWeights();
  const weightData = await Promise.all(ws.map(w => w.data().then(d => Array.from(d))));
  const shapes     = ws.map(w => Array.from(w.shape) as number[]);
  ws.forEach(w => w.dispose());
  return { weightData, shapes };
}

// ── Class-balance oversampling ────────────────────────────────────────────────
function oversample(
  xs: number[][][],
  yDir: number[],
  yRet: number[],
): [number[][][], number[], number[]] {
  const pos = mean(yDir);
  if (pos < 0.05 || pos > 0.95 || Math.abs(pos - 0.5) <= 0.05) return [xs, yDir, yRet];
  const minorIsPos = pos < 0.5;
  const minIdx: number[] = [];
  for (let i = 0; i < yDir.length; i++) if ((yDir[i] === 1) === minorIsPos) minIdx.push(i);
  const target = Math.floor(yDir.length * (minorIsPos ? 1 - pos : pos));
  const need   = Math.max(0, target - minIdx.length);
  const xOut = [...xs], ydOut = [...yDir], yrOut = [...yRet];
  for (let k = 0; k < need; k++) {
    const src = minIdx[k % minIdx.length];
    xOut.push(xs[src]); ydOut.push(yDir[src]); yrOut.push(yRet[src]);
  }
  return [xOut, ydOut, yrOut];
}

// ── Main training entry ───────────────────────────────────────────────────────
async function train(candles: Candle[]) {
  const { closes, rows } = buildFeatureMatrix(candles);
  const trainCut = Math.floor(rows.length * 0.85);
  const stats    = computeStats(rows.slice(0, trainCut));
  const normRows = rows.map(r => normalizeRow(r, stats));

  const xs: number[][][] = [], yDir: number[] = [], yRet: number[] = [];
  for (let i = SEQ_LEN; i < normRows.length - 1; i++) {
    xs.push(normRows.slice(i - SEQ_LEN, i));
    const p = closes[i], pn = closes[i + 1];
    const r = p !== 0 ? (pn - p) / p : 0;
    yDir.push(r > 0 ? 1 : 0);
    yRet.push(clamp(r, -0.05, 0.05));
  }

  if (xs.length < 60) {
    self.postMessage({ type: 'error', message: `Not enough sequences (${xs.length}/60)` });
    return;
  }

  const splitAt = Math.floor(xs.length * 0.85);
  let xTrain = xs.slice(0, splitAt);
  let xVal   = xs.slice(splitAt);
  let yDirTr = yDir.slice(0, splitAt), yDirVal = yDir.slice(splitAt);
  let yRetTr = yRet.slice(0, splitAt), yRetVal = yRet.slice(splitAt);

  [xTrain, yDirTr, yRetTr] = oversample(xTrain, yDirTr, yRetTr);

  const xTrainT = tf.tensor3d(xTrain),    xValT = tf.tensor3d(xVal);
  const ydTr    = tf.tensor2d(yDirTr, [yDirTr.length, 1]);
  const ydVal   = tf.tensor2d(yDirVal, [yDirVal.length, 1]);
  const yrTr    = tf.tensor2d(yRetTr,  [yRetTr.length,  1]);
  const yrVal   = tf.tensor2d(yRetVal,  [yRetVal.length,  1]);

  // ── Phase 1: fast warm-up ─────────────────────────────────────────────────
  const fastBuilt = buildFastModel();
  await fastBuilt.fit(xTrainT, [ydTr, yrTr], {
    epochs: MAX_FAST_EPOCHS, batchSize: 64,
    validationData: [xValT, [ydVal, yrVal]],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        self.postMessage({
          type: 'progress',
          phase: 'fast',
          epoch: epoch + 1,
          totalEpochs: MAX_FAST_EPOCHS,
          valLoss: (logs?.val_loss as number) ?? null,
          dirAcc: null,
        });
        await tf.nextFrame();
      },
    },
  });
  const fastSer = await serializeWeights(fastBuilt);
  fastBuilt.dispose();
  self.postMessage({ type: 'fast-ready', ...fastSer });

  // ── Phase 2: full Bi-LSTM ─────────────────────────────────────────────────
  const fullBuilt = buildFullModel();
  let bestVL = Infinity, bestWts: tf.Tensor[] | null = null, patience = 0, lastAcc = 0;

  await fullBuilt.fit(xTrainT, [ydTr, yrTr], {
    epochs: MAX_FULL_EPOCHS, batchSize: 32,
    validationData: [xValT, [ydVal, yrVal]], shuffle: true,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const rawAcc =
          (logs as Record<string, number>)?.val_direction_acc ??
          (logs as Record<string, number>)?.val_direction_accuracy ??
          (logs as Record<string, number>)?.val_accuracy;
        if (typeof rawAcc === 'number') lastAcc = rawAcc;

        self.postMessage({
          type: 'progress',
          phase: 'full',
          epoch: epoch + 1,
          totalEpochs: MAX_FULL_EPOCHS,
          valLoss: (logs?.val_loss as number) ?? null,
          dirAcc: typeof rawAcc === 'number' ? rawAcc : null,
        });

        const vl = logs?.val_loss as number | undefined;
        if (typeof vl === 'number') {
          if (vl < bestVL - 1e-5) {
            bestVL = vl;
            patience = 0;
            if (bestWts) bestWts.forEach(t => t.dispose());
            bestWts = fullBuilt.getWeights().map(w => w.clone());
          } else {
            patience++;
            if (patience >= EARLY_STOP_PATIENCE) fullBuilt.stopTraining = true;
          }
        }
        await tf.nextFrame();
      },
    },
  });

  if (bestWts) { fullBuilt.setWeights(bestWts); bestWts.forEach(t => t.dispose()); }

  const fullSer = await serializeWeights(fullBuilt);
  fullBuilt.dispose();
  xTrainT.dispose(); xValT.dispose();
  ydTr.dispose(); ydVal.dispose();
  yrTr.dispose(); yrVal.dispose();

  self.postMessage({
    type: 'complete',
    ...fullSer,
    valDirectionAccuracy: lastAcc,
    valLoss: bestVL === Infinity ? null : bestVL,
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = async (event: MessageEvent) => {
  const { type, candles } = event.data as { type: string; candles: Candle[] };
  if (type !== 'train') return;
  if (!candles || candles.length < MIN_TRAIN_CANDLES) {
    self.postMessage({ type: 'error', message: `Need ≥${MIN_TRAIN_CANDLES} candles` });
    return;
  }
  try {
    await train(candles);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message });
  }
};
