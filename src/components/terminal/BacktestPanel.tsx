import { useMemo } from "react";
import type { Candle } from "@/lib/engines/types";
import { emaSeries, rsiSeries, atrSeries } from "@/lib/engines/math";

interface Props {
  candles: Candle[];
}

interface Trade {
  entryIndex: number;
  exitIndex: number;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;       // fractional
  pnlPct: number;    // percentage
}

interface BacktestResult {
  trades: Trade[];
  equity: number[];   // cumulative equity (starting 1.0)
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalReturn: number;
  sharpe: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
}

function runBacktest(candles: Candle[]): BacktestResult {
  if (candles.length < 60) {
    return {
      trades: [], equity: [1], winRate: 0, profitFactor: 0,
      maxDrawdown: 0, totalReturn: 0, sharpe: 0, avgWin: 0, avgLoss: 0, expectancy: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);

  const ema9  = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema55 = emaSeries(closes, 55);
  const rsi   = rsiSeries(closes, 14);
  const atr   = atrSeries(highs, lows, closes, 14);

  const trades: Trade[] = [];
  let position: "long" | "short" | null = null;
  let entryIndex = 0;
  let entryPrice = 0;
  const equity: number[] = [1.0];
  let currentEquity = 1.0;

  for (let i = 60; i < candles.length - 1; i++) {
    const bull = ema9[i] > ema21[i] && ema21[i] > ema55[i];
    const bear = ema9[i] < ema21[i] && ema21[i] < ema55[i];
    const rsiBull = rsi[i] > 45 && rsi[i] < 72;
    const rsiBear = rsi[i] < 55 && rsi[i] > 28;
    const prevBull = ema9[i - 1] > ema21[i - 1];
    const prevBear = ema9[i - 1] < ema21[i - 1];

    const longEntry  = bull && rsiBull && !prevBull;
    const shortEntry = bear && rsiBear && !prevBear;

    // Exit existing position on opposite signal
    if (position === "long" && (shortEntry || (rsi[i] > 78))) {
      const exitPrice = closes[i + 1];
      const pnl = (exitPrice - entryPrice) / entryPrice;
      trades.push({
        entryIndex, exitIndex: i + 1,
        side: "long", entryPrice, exitPrice,
        pnl, pnlPct: pnl * 100,
      });
      currentEquity *= (1 + pnl);
      equity.push(currentEquity);
      position = null;
    } else if (position === "short" && (longEntry || (rsi[i] < 22))) {
      const exitPrice = closes[i + 1];
      const pnl = (entryPrice - exitPrice) / entryPrice;
      trades.push({
        entryIndex, exitIndex: i + 1,
        side: "short", entryPrice, exitPrice,
        pnl, pnlPct: pnl * 100,
      });
      currentEquity *= (1 + pnl);
      equity.push(currentEquity);
      position = null;
    }

    // Enter new position
    if (!position) {
      if (longEntry) {
        position = "long";
        entryIndex = i + 1;
        entryPrice = closes[i + 1];
      } else if (shortEntry) {
        position = "short";
        entryIndex = i + 1;
        entryPrice = closes[i + 1];
      }
    }
  }

  if (trades.length === 0) {
    return {
      trades: [], equity: [1], winRate: 0, profitFactor: 0,
      maxDrawdown: 0, totalReturn: 0, sharpe: 0, avgWin: 0, avgLoss: 0, expectancy: 0,
    };
  }

  const wins  = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = wins.length / trades.length;

  const grossWin  = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  const avgWin  = wins.length > 0  ? (grossWin  / wins.length)  * 100 : 0;
  const avgLoss = losses.length > 0 ? (grossLoss / losses.length) * 100 : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  // Max drawdown from equity curve
  let peak = 1;
  let maxDD = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (annualized, assuming each trade = 1 period)
  const returns = trades.map((t) => t.pnl);
  const meanRet = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - meanRet) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance) || 1e-9;
  const sharpe = (meanRet / std) * Math.sqrt(252);

  const totalReturn = (currentEquity - 1) * 100;

  return { trades, equity, winRate, profitFactor, maxDrawdown: maxDD * 100, totalReturn, sharpe, avgWin, avgLoss, expectancy };
}

export function BacktestPanel({ candles }: Props) {
  const result = useMemo(() => runBacktest(candles), [candles]);

  if (candles.length < 60) {
    return (
      <div className="panel p-5">
        <p className="text-sm text-muted-foreground">
          تحتاج إلى 60 شمعة على الأقل لتشغيل الباكتيست.
        </p>
      </div>
    );
  }

  const { trades, equity, winRate, profitFactor, maxDrawdown, totalReturn, sharpe, avgWin, avgLoss, expectancy } = result;
  const bullish = totalReturn >= 0;

  // Equity curve SVG
  const eqW = 900;
  const eqH = 100;
  const eMin = Math.min(...equity);
  const eMax = Math.max(...equity);
  const eRange = eMax - eMin || 0.01;
  const eqPts = equity.map((v, i) => {
    const x = (i / (equity.length - 1)) * eqW;
    const y = eqH - 10 - ((v - eMin) / eRange) * (eqH - 20);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  // Win/loss distribution (last 20 trades)
  const recent = trades.slice(-20);

  return (
    <div className="panel p-5 space-y-5 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent, ${bullish ? "var(--color-bull)" : "var(--color-bear)"}, transparent)`,
        }}
      />

      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            اختبار الأداء التاريخي
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            استراتيجية EMA 9/21/55 + RSI — {trades.length} صفقة على {candles.length} شمعة
          </p>
        </div>
        <div
          className="text-2xl font-bold font-mono tabular-nums"
          style={{ color: bullish ? "var(--color-bull)" : "var(--color-bear)" }}
        >
          {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(1)}%
        </div>
      </div>

      {/* Equity Curve */}
      <div>
        <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">
          منحنى رأس المال
        </div>
        <div className="rounded-lg overflow-hidden" style={{ background: "var(--color-secondary)" }}>
          <svg viewBox={`0 0 ${eqW} ${eqH}`} className="w-full" preserveAspectRatio="none" style={{ height: 80 }}>
            {/* Fill */}
            <path
              d={`${eqPts} L ${eqW} ${eqH} L 0 ${eqH} Z`}
              fill={bullish ? "var(--color-bull)" : "var(--color-bear)"}
              opacity={0.12}
            />
            {/* Line */}
            <path
              d={eqPts}
              fill="none"
              stroke={bullish ? "var(--color-bull)" : "var(--color-bear)"}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Start/End dots */}
            <circle cx={0} cy={eqH - 10 - ((equity[0] - eMin) / eRange) * (eqH - 20)}
              r={3} fill="var(--color-muted-foreground)" />
            <circle
              cx={eqW}
              cy={eqH - 10 - ((equity[equity.length - 1] - eMin) / eRange) * (eqH - 20)}
              r={4}
              fill={bullish ? "var(--color-bull)" : "var(--color-bear)"}
            />
          </svg>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "نسبة الربح", value: `${(winRate * 100).toFixed(1)}%`, tone: winRate >= 0.5 ? "bull" : "bear" },
          { label: "معامل الربحية", value: profitFactor.toFixed(2), tone: profitFactor >= 1.5 ? "bull" : profitFactor >= 1 ? "neutral" : "bear" },
          { label: "أقصى تراجع", value: `-${maxDrawdown.toFixed(1)}%`, tone: maxDrawdown < 15 ? "bull" : maxDrawdown < 30 ? "neutral" : "bear" },
          { label: "Sharpe Ratio", value: sharpe.toFixed(2), tone: sharpe >= 1.5 ? "bull" : sharpe >= 0.5 ? "neutral" : "bear" },
          { label: "متوسط الربح", value: `+${avgWin.toFixed(2)}%`, tone: "bull" },
          { label: "متوسط الخسارة", value: `-${avgLoss.toFixed(2)}%`, tone: "bear" },
          { label: "التوقع الرياضي", value: `${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}%`, tone: expectancy >= 0 ? "bull" : "bear" },
          { label: "إجمالي الصفقات", value: `${trades.length}`, tone: "neutral" as const },
        ].map(({ label, value, tone }) => (
          <div
            key={label}
            className="rounded-lg p-3"
            style={{ background: "color-mix(in oklab, var(--color-secondary) 50%, transparent)" }}
          >
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
            <div
              className="text-sm font-bold font-mono tabular-nums"
              style={{
                color:
                  tone === "bull" ? "var(--color-bull)"
                  : tone === "bear" ? "var(--color-bear)"
                  : "var(--color-foreground)",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent trades */}
      {recent.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            آخر {recent.length} صفقة
          </div>
          <div className="flex gap-1 flex-wrap">
            {recent.map((t, i) => (
              <div
                key={i}
                className="w-4 h-8 rounded-sm"
                title={`${t.side === "long" ? "شراء" : "بيع"}: ${t.pnlPct.toFixed(2)}%`}
                style={{
                  background: t.pnl > 0 ? "var(--color-bull)" : "var(--color-bear)",
                  opacity: 0.4 + Math.min(0.6, Math.abs(t.pnl) * 10),
                }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            اعرض مؤشر الفأرة على الأعمدة لرؤية تفاصيل الصفقة
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-3 leading-relaxed">
        <span className="text-foreground font-medium">ملاحظة:</span>{" "}
        نتائج الباكتيست استرجاعية (hindsight) ولا تضمن أداءً مستقبلياً. الاستراتيجية تعتمد
        تقاطع EMA 9/21/55 مع تصفية RSI. لا تشمل عمولات أو انزلاق السعر.
      </div>
    </div>
  );
}
