import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { engineList } from "@/lib/engines/registry";
import { EngineCard } from "@/components/engines/EngineCard";

export const Route = createFileRoute("/engines")({
  head: () => ({
    meta: [
      { title: "Engines · Precision Engine Suite" },
      { name: "description", content: "Numerical integration, OLS regression, FFT, ODE solvers, and descriptive statistics — verifiable and deterministic." },
    ],
  }),
  component: EnginesIndex,
});

function EnginesIndex() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("nav.engines")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("app.tagline")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {engineList.map(e => <EngineCard key={e.id} engine={e} />)}
      </div>
    </div>
  );
}