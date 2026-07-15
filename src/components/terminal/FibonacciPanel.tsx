import type { FullAnalysisResult } from "@/lib/engines/types";

interface Props {
  analysis: FullAnalysisResult;
  candles: { high: number; low: number; close: number }[];
}

const FIB_DESCRIPTIONS: Record<string, { ar: string; note: string; color: string }> = {
  "0%":    { ar: "بداية الموجة", note: "نقطة الانطلاق — أدنى قاع أو أعلى قمة للحركة", color: "oklch(0.70 0.20 150)" },
  "23.6%": { ar: "تصحيح ضعيف", note: "أضعف مستويات التصحيح، شائع في اتجاهات قوية جداً", color: "oklch(0.85 0.18 90)" },
  "38.2%": { ar: "تصحيح موجة 4", note: "هدف موجة التصحيح 4 في الحركات الدافعة القياسية", color: "oklch(0.82 0.20 65)" },
  "50%":   { ar: "منتصف الحركة", note: "ليس نسبة فيبوناتشي حقيقية لكنه مستوى نفسي بالغ الأهمية", color: "oklch(0.80 0.16 200)" },
  "61.8%": { ar: "النسبة الذهبية ★", note: "الهدف الأكثر أهمية: النسبة الذهبية φ = 1/1.618. هدف موجة 2 الكلاسيكي", color: "oklch(0.85 0.20 50)" },
  "78.6%": { ar: "تصحيح عميق", note: "√(0.618) ≈ 0.786 — نقطة الارتداد الأخيرة قبل الانعكاس الكامل", color: "oklch(0.80 0.22 30)" },
  "100%":  { ar: "نهاية الحركة", note: "انعكاس كامل للحركة السابقة — كسرها يؤكد الاتجاه الجديد", color: "oklch(0.70 0.24 20)" },
};

const ELLIOTT_RULES = [
  {
    wave: "موجة 1",
    icon: "①",
    color: "#64ffda",
    rule: "بداية الحركة الدافعة — غالباً أصغر الموجات الدافعة الخمس",
  },
  {
    wave: "موجة 2",
    icon: "②",
    color: "#a8ff78",
    rule: "تصحيح لموجة 1 — يجب ألا تتجاوز 100% من موجة 1 (بدايتها). تستهدف عادةً 61.8% أو 78.6%",
  },
  {
    wave: "موجة 3",
    icon: "③",
    color: "#fff176",
    rule: "أقوى وأطول الموجات عادةً — لا تكون أبداً الأقصر. تمتد إلى 161.8% أو 200% من موجة 1",
  },
  {
    wave: "موجة 4",
    icon: "④",
    color: "#ff9a9e",
    rule: "تصحيح موجة 3 — تستهدف 23.6% أو 38.2%. يجب ألا تتداخل مع قمة موجة 1",
  },
  {
    wave: "موجة 5",
    icon: "⑤",
    color: "#84fab0",
    rule: "الموجة الأخيرة في الحركة الدافعة — قد تكون مُقتطعة. تستهدف 61.8% إلى 100% من موجة 1",
  },
  {
    wave: "موجة A",
    icon: "Ⓐ",
    color: "#ffeaa7",
    rule: "أول موجة في التصحيح الثلاثي — بداية مرحلة التراجع",
  },
  {
    wave: "موجة B",
    icon: "Ⓑ",
    color: "#fd79a8",
    rule: "ارتداد انتهازي — يصل عادةً 38.2-61.8% من موجة A. مشاعر السوق لا تزال مربكة",
  },
  {
    wave: "موجة C",
    icon: "Ⓒ",
    color: "#74b9ff",
    rule: "ذراع التصحيح المكملة — تساوي عادةً موجة A. كسرها يؤكد انتهاء التصحيح",
  },
];

function calcFibLevels(candles: Props["candles"]) {
  const slice = candles.slice(-80);
  const high  = Math.max(...slice.map((c) => c.high));
  const low   = Math.min(...slice.map((c) => c.low));
  const range = high - low;
  const current = candles[candles.length - 1]?.close ?? 0;
  return { high, low, range, current };
}

export function FibonacciPanel({ analysis, candles }: Props) {
  const { high, low, range, current } = calcFibLevels(candles);
  const best = analysis.elliott?.bestSequence;

  const fibLevels = Object.entries(FIB_DESCRIPTIONS).map(([label, info]) => {
    const ratio = parseFloat(label) / 100;
    const price = high - ratio * range;
    const isActive =
      Math.abs(current - price) / (range || 1) < 0.015;
    const nearness = 1 - Math.abs(current - price) / (range || 1);
    return { label, price, info, isActive, nearness, ratio };
  });

  return (
    <div className="space-y-4">
      {/* Fibonacci Levels */}
      <div className="panel p-5 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, oklch(0.85 0.20 50), transparent)" }}
        />
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              مستويات فيبوناتشي
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              محسوبة من أعلى وأدنى آخر 80 شمعة
            </p>
          </div>
          <div className="text-right text-[11px] font-mono text-muted-foreground">
            <div>أعلى: {high >= 1000 ? high.toFixed(1) : high.toFixed(4)}</div>
            <div>أدنى: {low >= 1000 ? low.toFixed(1) : low.toFixed(4)}</div>
          </div>
        </div>

        <div className="space-y-1.5">
          {fibLevels.map((f) => (
            <div
              key={f.label}
              className={`rounded-lg px-3 py-2 transition-all ${
                f.isActive
                  ? "border border-opacity-60"
                  : "border border-transparent"
              }`}
              style={{
                background: f.isActive
                  ? `color-mix(in oklab, ${f.info.color} 12%, var(--color-panel))`
                  : "color-mix(in oklab, var(--color-secondary) 40%, transparent)",
                borderColor: f.isActive ? f.info.color : undefined,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: f.info.color }}
                  />
                  <span className="text-xs font-mono font-semibold"
                    style={{ color: f.info.color }}>{f.label}</span>
                  <span className="text-[11px] text-muted-foreground">{f.info.ar}</span>
                  {f.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold"
                      style={{
                        background: `color-mix(in oklab, ${f.info.color} 25%, transparent)`,
                        color: f.info.color,
                      }}>
                      ← الآن
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono tabular-nums text-foreground">
                  {f.price >= 1000 ? f.price.toFixed(2) : f.price.toFixed(4)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 pr-4">{f.info.note}</p>
            </div>
          ))}
        </div>

        {/* How the levels are calculated */}
        <div className="mt-4 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">كيف تُحسب؟</span> تُحدد القمة العالية والقاع المنخفض خلال النافذة الزمنية،
            ثم يُضرب الفارق (range) في كل نسبة فيبوناتشي. المستوى 61.8% = النسبة الذهبية φ = (√5−1)/2 ≈ 0.618.
          </p>
        </div>
      </div>

      {/* Elliott Wave Education */}
      <div className="panel p-5 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, #64ffda, transparent)" }}
        />
        <div className="mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            موجات إليوت — شرح الآلية
          </h3>
          {best && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className="text-[11px] px-2 py-0.5 rounded font-mono"
                style={{
                  background: best.degree === "impulse"
                    ? "color-mix(in oklab, #64ffda 15%, transparent)"
                    : "color-mix(in oklab, #ffeaa7 15%, transparent)",
                  color: best.degree === "impulse" ? "#64ffda" : "#ffeaa7",
                }}
              >
                {best.degree === "impulse" ? "دافعة 5 موجات" : "تصحيح ABC"}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                ثقة {best.score.toFixed(0)}%
              </span>
              {best.ruleViolations.length === 0 && (
                <span className="text-[11px] text-bull">✓ لا مخالفات</span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {ELLIOTT_RULES.map((r) => (
            <div
              key={r.wave}
              className="flex gap-3 p-2 rounded-lg"
              style={{
                background: "color-mix(in oklab, var(--color-secondary) 30%, transparent)",
              }}
            >
              <span
                className="text-lg font-bold flex-shrink-0 w-7 text-center leading-none mt-0.5"
                style={{ color: r.color }}
              >
                {r.icon}
              </span>
              <div>
                <div className="text-xs font-semibold" style={{ color: r.color }}>
                  {r.wave}
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  {r.rule}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">آلية عمل المحرك:</span>{" "}
            يُشغّل المحرك نافذة متحركة على نقاط المحور (pivots)، يُقيّم كل تسلسل محتمل
            بناءً على 4 معيار: نسب فيبوناتشي، التناوب بين الموجة 2 والموجة 4 (sharp/flat)،
            الاتساق في قناة الاتجاه، وقواعد إليوت الأساسية. التسلسل الأعلى نقطةً يُعتمد.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">الدمج مع فيبوناتشي:</span>{" "}
            موجة 3 تمتد عادةً إلى 161.8% من موجة 1 (النسبة الذهبية). موجة 2 تتراجع 61.8%.
            موجة 4 تتراجع 38.2%. هذه العلاقات تُشكّل معاملات الدرجة (fibScore) في الخوارزمية.
          </p>
        </div>
      </div>
    </div>
  );
}
