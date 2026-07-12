import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EngineResult } from "./engines/types";
import { engines } from "./engines/registry";
import { fmt } from "./engines/checksum";

export function exportRunToPdf(result: EngineResult, lang: "en" | "ar" = "en") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const engine = engines[result.engineId];
  const d = engine.doc[lang];
  doc.setFontSize(18);
  doc.text("Precision Engine Suite", 40, 50);
  doc.setFontSize(13);
  doc.text(`${d.title}  —  ${result.checksum}`, 40, 74);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(new Date().toISOString(), 40, 90);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 108,
    head: [["Method", "Complexity", "Error bound"]],
    body: [[d.method, d.complexity, d.errorBound]],
    styles: { fontSize: 9, cellPadding: 6 },
  });

  autoTable(doc, {
    head: [["Equations"]],
    body: d.equations.map(e => [e]),
    styles: { fontSize: 10, font: "courier" },
  });

  autoTable(doc, {
    head: [["Metric", "Value"]],
    body: [
      ["Engine ID", result.engineId],
      ["Duration (ms)", fmt(result.durationMs, 4)],
      ["Checksum (djb2)", result.checksum],
      ...Object.entries(result.accuracy ?? {}).map(([k, v]) => [k, fmt(v)]),
    ],
  });

  if (result.table) {
    autoTable(doc, {
      head: [result.table.columns],
      body: result.table.rows.slice(0, 400).map(r => r.map(v => typeof v === "number" ? fmt(v) : String(v))),
      styles: { fontSize: 8 },
    });
  }

  autoTable(doc, {
    head: [["Logs"]],
    body: result.logs.map(l => [l]),
    styles: { fontSize: 8, font: "courier" },
  });

  doc.save(`pes-${result.engineId}-${result.checksum}.pdf`);
}