// Central type contracts shared by every analysis engine and the UI layer.

export interface Candle {
  /** True for all fully-closed candles; false for the currently-building candle.
   *  All REST klines except the last are always closed. */
  isClosed?: boolean;
  time: number; // close time (ms epoch), always a *closed* candle
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyBaseVolume: number;
}

export type Trend = 'bullish' | 'bearish' | 'neutral';

// ---------------------------------------------------------------------------
// Pivots
// ---------------------------------------------------------------------------

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

// ---------------------------------------------------------------------------
// Elliott Wave
// ---------------------------------------------------------------------------

export interface WavePoint {
  index: number;
  time: number;
  price: number;
  label: string; // 0,1,2,3,4,5 or A,B,C
}

export interface WaveSequence {
  points: WavePoint[];
  direction: 'up' | 'down';
  degree: 'impulse' | 'corrective';
  score: number; // 0-100 confidence the sequence obeys Elliott rules
  ruleViolations: string[];
  alternationScore: number; // wave2 vs wave4 character alternation, 0-100
  channelFit: number; // 0-100, how well waves 1/3/5 respect a parallel channel
  truncated: boolean;
}

export interface Projection {
  label: string;
  price: number;
  fibRatio: number;
  probability: number; // 0-100
}

export interface ElliottResult {
  sequences: WaveSequence[];
  bestSequence: WaveSequence | null;
  projections: Projection[];
  trend: Trend;
  confidence: number; // 0-100
  currentWave: string | null;
  logs: string[];
}

// ---------------------------------------------------------------------------
// CVD (Cumulative Volume Delta)
// ---------------------------------------------------------------------------

export interface CVDPoint {
  index: number;
  time: number;
  value: number;
  delta: number;
}

export interface CVDDivergence {
  type: 'bullish' | 'bearish';
  priceIndex: number;
  cvdIndex: number;
  strength: number; // 0-100
  description: string;
}

export interface CVDResult {
  series: CVDPoint[];
  smoothed: number[];
  trend: Trend;
  slope: number;
  strength: number; // 0-100
  divergences: CVDDivergence[];
  logs: string[];
}

// ---------------------------------------------------------------------------
// Smart Money Concepts
// ---------------------------------------------------------------------------

export interface OrderBlock {
  index: number;
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  strength: number; // 0-100
  mitigated: boolean;
  partiallyMitigated: boolean;
  elliottConfluence: boolean;
  cvdConfluence: boolean;
  critical: boolean;
}

export interface FairValueGap {
  index: number;
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  fillProbability: number; // 0-100
  strength: number; // 0-100
  filled: boolean;
}

export interface LiquidityZone {
  index: number;
  time: number;
  type: 'buy-side' | 'sell-side';
  price: number;
  strength: number; // 0-100
  breached: boolean;
  confluence: boolean;
}

export interface BreakOfStructure {
  index: number;
  time: number;
  type: 'bullish' | 'bearish';
  level: number;
  strength: number; // 0-100
  isChangeOfCharacter: boolean;
}

export interface EquilibriumZone {
  premiumTop: number;
  premiumBottom: number;
  equilibrium: number;
  discountTop: number;
  discountBottom: number;
  pricePosition: 'premium' | 'discount' | 'equilibrium';
}

export interface SMCResult {
  orderBlocks: OrderBlock[];
  criticalOrderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  liquidityZones: LiquidityZone[];
  breakOfStructure: BreakOfStructure | null;
  equilibrium: EquilibriumZone | null;
  bias: Trend;
  logs: string[];
}

// ---------------------------------------------------------------------------
// LSTM
// ---------------------------------------------------------------------------

export type ModelSource = 'tfjs_lstm' | 'statistical_ensemble';

export interface EpochRecord {
  epoch: number;
  dirAcc: number | null;   // null during fast phase (no metric)
  valLoss: number | null;
  phase: 'fast' | 'full';
}

export interface LSTMModelStatus {
  modelSource: ModelSource;
  isTraining: boolean;
  trained: boolean;
  epoch: number;
  totalEpochs: number;
  trainLoss: number | null;
  valLoss: number | null;
  valDirectionAccuracy: number | null;
  lastTrainedAt: number | null;
  samplesUsed: number;
  message: string;
  // two-phase training additions
  fastModelReady: boolean;
  phase: 'idle' | 'fast-training' | 'full-training' | 'complete';
  epochHistory: EpochRecord[];
}

export interface LSTMPrediction {
  direction: 'up' | 'down';
  confidence: number; // 0-100
  predictedPrice: number;
  predictedReturn: number; // fractional
  regime: 'trending' | 'ranging';
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  modelSource: ModelSource;
  logs: string[];
}

// ---------------------------------------------------------------------------
// Confluence / composite result
// ---------------------------------------------------------------------------

export interface ConfluenceSignal {
  name: string;
  direction: Trend;
  weight: number;
  contribution: number; // signed contribution to composite score
}

export interface DataQuality {
  score: number; // 0-100
  candleCount: number;
  gapsDetected: number;
  reasons: string[];
}

export interface FullAnalysisResult {
  timestamp: number;
  price: number;
  dataQuality: DataQuality;
  pivots: Pivot[];
  elliott: ElliottResult | null;
  cvd: CVDResult | null;
  smc: SMCResult | null;
  lstm: LSTMPrediction | null;
  cycle: import('./cycleEngine').CycleResult | null;
  confluence: ConfluenceSignal[];
  compositeScore: number; // -100 (max bearish) .. 100 (max bullish)
  uncertainty: number; // 0-100, higher = less certain (from Monte Carlo noise)
  alert: string | null;
  logs: string[];
  regime?: import('./regimeEngine').RegimeReading;
  audit?: import('./verify').AuditResult;
  checksum?: string;
}

/** Rolling mean/std tracker used for z-score warm-up and adaptive thresholds. */
export class DivergenceStore {
  private window: number[] = [];
  constructor(private readonly capacity = 200) {}

  push(value: number) {
    this.window.push(value);
    if (this.window.length > this.capacity) this.window.shift();
  }

  get size() {
    return this.window.length;
  }

  get mean(): number {
    if (this.window.length === 0) return 0;
    return this.window.reduce((a, b) => a + b, 0) / this.window.length;
  }

  get std(): number {
    if (this.window.length < 2) return 0;
    const m = this.mean;
    const sumSq = this.window.reduce((a, b) => a + (b - m) * (b - m), 0);
    return Math.sqrt(sumSq / (this.window.length - 1));
  }

  zScore(value: number): number {
    const s = this.std;
    if (s === 0) return 0;
    return (value - this.mean) / s;
  }
}
