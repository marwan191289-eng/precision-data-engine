import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fmt } from "@/lib/engines/checksum";

export function VirtualTable({ columns, rows }: {
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rv = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });
  return (
    <div className="rounded-md border border-border">
      <div className="grid gap-2 border-b border-border bg-secondary/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
           style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map(c => <div key={c} className="truncate">{c}</div>)}
      </div>
      <div ref={parentRef} className="h-[360px] overflow-auto">
        <div style={{ height: rv.getTotalSize(), position: "relative" }}>
          {rv.getVirtualItems().map(vi => {
            const row = rows[vi.index];
            return (
              <div key={vi.key}
                className="absolute inset-x-0 grid items-center gap-2 border-b border-border/50 px-3 font-mono text-xs"
                style={{ transform: `translateY(${vi.start}px)`, height: vi.size,
                         gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                {row.map((c, i) => (
                  <div key={i} className="truncate">{typeof c === "number" ? fmt(c) : c}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}