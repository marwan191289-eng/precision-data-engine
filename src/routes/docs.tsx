import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { engineList } from "@/lib/engines/registry";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation · Precision Engine Suite" },
      { name: "description", content: "Full mathematical documentation for every engine: equations, method, complexity, and error bounds." },
    ],
  }),
  component: () => <AppShell><DocsPage /></AppShell>,
});

function DocsPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">{t("nav.docs")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every engine ships with a plain-text mathematical spec and an independent oracle (the "Verify" button)
        that recomputes the result via a second method and reports absolute error.
      </p>
      <div className="mt-6 grid gap-5">
        {engineList.map(e => {
          const d = e.doc[lang];
          return (
            <section key={e.id} className="surface-elevated p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{d.title}</h2>
                <span className="font-mono text-[11px] text-muted-foreground">{e.id}@{e.version}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{d.method}</p>
              <ul className="mt-3 space-y-1 font-mono text-xs">
                {d.equations.map((eq, i) => <li key={i} className="rounded bg-secondary/40 px-2 py-1">{eq}</li>)}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">complexity: </span><span className="font-mono">{d.complexity}</span></div>
                <div><span className="text-muted-foreground">error: </span><span className="font-mono">{d.errorBound}</span></div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}