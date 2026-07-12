import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { engines } from "@/lib/engines/registry";
import type { EngineId, EngineResult } from "@/lib/engines/types";
import { RunPanel } from "@/components/engines/RunPanel";
import { ResultView } from "@/components/engines/ResultView";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/engines/$engineId")({
  head: ({ params }) => {
    const engine = engines[params.engineId as EngineId];
    const title = engine?.doc.en.title ?? "Engine";
    return {
      meta: [
        { title: `${title} · Precision Engine Suite` },
        { name: "description", content: engine?.doc.en.method ?? "Scientific engine" },
      ],
    };
  },
  component: EngineDetail,
  notFoundComponent: () => <div className="p-8">Engine not found</div>,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{String(error)}</div>,
});

function EngineDetail() {
  const { engineId } = Route.useParams();
  const engine = engines[engineId as EngineId];
  if (!engine) throw notFound();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  const [result, setResult] = useState<EngineResult | null>(null);
  const d = engine.doc[lang];
  return (
    <div className="grid gap-6">
      <div>
        <Link to="/engines" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {t("nav.engines")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{d.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{d.method}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="grid gap-4">
          <RunPanel engine={engine} onResult={setResult} />
          <div className="surface-elevated p-5">
            <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("common.equations")}</h4>
            <ul className="space-y-1.5 font-mono text-xs leading-relaxed">
              {d.equations.map((e, i) => <li key={i} className="rounded bg-secondary/40 px-2 py-1">{e}</li>)}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">complexity: </span><span className="font-mono">{d.complexity}</span></div>
              <div><span className="text-muted-foreground">error: </span><span className="font-mono">{d.errorBound}</span></div>
            </div>
          </div>
        </div>
        <div>
          {result ? <ResultView result={result} /> : (
            <div className="surface-elevated grid place-items-center p-16 text-center text-sm text-muted-foreground">
              {t("common.running")} ↦ {t("common.output")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}