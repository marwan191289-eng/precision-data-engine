import { useMemo } from "react";

interface Props {
  score: number; // -100..100
  uncertainty: number; // 0..100
}

export function ScoreGauge({ score, uncertainty }: Props) {
  const pct = useMemo(() => (score + 100) / 2, [score]); // 0..100
  const bullish = score >= 0;
  const label =
    Math.abs(score) < 15
      ? "محايد"
      : Math.abs(score) < 40
        ? bullish
          ? "ميل صعودي"
          : "ميل هبوطي"
        : Math.abs(score) < 70
          ? bullish
            ? "إشارة شراء"
            : "إشارة بيع"
          : bullish
            ? "شراء قوي جداً"
            : "بيع قوي جداً";

  const color = bullish ? "var(--color-bull)" : "var(--color-bear)";

  return (
    <div className="panel p-6 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 100%, ${color}, transparent 70%)`,
        }}
      />
      <div className="relative">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            الإشارة المركّبة
          </h3>
          <span className="text-xs text-muted-foreground font-mono">
            uncertainty {uncertainty.toFixed(0)}%
          </span>
        </div>

        <div className="flex items-end gap-4">
          <div
            className="text-6xl font-bold font-mono tabular-nums"
            style={{ color }}
          >
            {score > 0 ? "+" : ""}
            {score.toFixed(0)}
          </div>
          <div className="pb-2">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: `color-mix(in oklab, ${color} 18%, transparent)`,
                color,
              }}
            >
              <span
                className="w-2 h-2 rounded-full pulse-ring"
                style={{ background: color, color }}
              />
              {label}
            </div>
          </div>
        </div>

        {/* Gauge bar */}
        <div className="mt-6 relative h-3 rounded-full overflow-hidden bg-secondary">
          <div
            className="absolute inset-y-0"
            style={{
              left: 0,
              right: `${100 - pct}%`,
              background: `linear-gradient(90deg, var(--color-bear), var(--color-neutral), var(--color-bull))`,
              opacity: 0.35,
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full"
            style={{
              left: `calc(${pct}% - 2px)`,
              background: color,
              boxShadow: `0 0 12px ${color}`,
            }}
          />
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
          <span>-100 BEAR</span>
          <span>0</span>
          <span>+100 BULL</span>
        </div>
      </div>
    </div>
  );
}
