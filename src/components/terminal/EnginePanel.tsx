import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  accent?: "bull" | "bear" | "neutral" | "primary";
  children: ReactNode;
}

const accentColor = {
  bull: "var(--color-bull)",
  bear: "var(--color-bear)",
  neutral: "var(--color-neutral)",
  primary: "var(--color-primary)",
};

export function EnginePanel({ title, subtitle, accent = "primary", children }: Props) {
  const color = accentColor[accent];
  return (
    <div className="panel p-5 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "bull" | "bear" | "neutral";
}) {
  const color =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : "text-foreground";
  return (
    <div className="flex items-center justify-between text-sm">
      <div>
        <div className="text-muted-foreground text-xs">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
      </div>
      <div className={`font-mono font-medium ${color}`}>{value}</div>
    </div>
  );
}

export function TrendBadge({ trend }: { trend: "bullish" | "bearish" | "neutral" }) {
  const map = {
    bullish: { label: "صعودي", color: "var(--color-bull)" },
    bearish: { label: "هبوطي", color: "var(--color-bear)" },
    neutral: { label: "محايد", color: "var(--color-neutral)" },
  };
  const { label, color } = map[trend];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold font-mono"
      style={{
        background: `color-mix(in oklab, ${color} 15%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  );
}
