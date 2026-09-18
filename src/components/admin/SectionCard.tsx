import type { LucideIcon } from "lucide-react";
import type React from "react";

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border bg-background/50 rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1.5 font-semibold text-base tabular-nums">{value}</p>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card/40 mt-10 rounded-3xl border p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="text-primary size-5" />
          <div>
            <h2 className="font-semibold text-base">{title}</h2>
            {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
