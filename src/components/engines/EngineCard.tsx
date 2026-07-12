import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { EngineDefinition } from "@/lib/engines/types";
import { Cpu, ArrowRight } from "lucide-react";

export function EngineCard({ engine }: { engine: EngineDefinition }) {
  const { i18n, t } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  const d = engine.doc[lang];
  return (
    <Link to="/engines/$engineId" params={{ engineId: engine.id }}
      className="group surface-elevated block p-5 transition hover:border-primary/40 hover:glow-primary">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-secondary text-primary">
          <Cpu className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
          v{engine.version}
        </span>
      </div>
      <div className="mt-4">
        <div className="text-base font-semibold">{d.title}</div>
        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{t(`engines.${engine.id}.desc`)}</div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{d.complexity}</span>
        <span className="inline-flex items-center gap-1 text-primary group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition">
          {t("common.open")} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </span>
      </div>
    </Link>
  );
}