import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, type SourceStatus } from "@/lib/api";

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "default",
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: ReactNode;
  tone?: "default" | "cyan" | "amber" | "mint" | "red" | "muted";
  loading?: boolean;
}) {
  const toneClass =
    tone === "cyan"
      ? "text-[var(--d-rv21)]"
      : tone === "amber"
        ? "text-[var(--d-vxn)]"
        : tone === "mint"
          ? "text-[var(--d-mint)]"
          : tone === "red"
            ? "text-[var(--d-red)]"
            : tone === "muted"
              ? "text-muted-foreground"
              : "text-foreground";
  return (
    <Card className="hairline gap-0 border-border/70 bg-card/60 py-0">
      <CardContent className="p-3.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
          <p className={`tnum mt-1 text-2xl leading-none font-semibold ${toneClass}`}>
            {value}
            {unit ? <span className="ml-0.5 text-sm font-normal opacity-70">{unit}</span> : null}
          </p>
        )}
        {hint ? <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-border/70 bg-card/50 ${className ?? ""}`}>
      <CardHeader className="flex-row items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription className="mt-1 text-xs">{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="pt-0 pb-4">{children}</CardContent>
    </Card>
  );
}

export function SourceChip({ source }: { source: SourceStatus }) {
  const live = source.mode === "live" && source.ok;
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-border/80 bg-secondary/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
      title={source.note}
    >
      <span
        className={`size-1.5 rounded-full ${
          live ? "bg-[var(--d-mint)]" : source.ok ? "bg-[var(--d-vxn)]" : "bg-[var(--d-red)]"
        }`}
      />
      <span className="truncate">
        {source.kind === "implied_vol"
          ? source.id === "implied_vol_vix"
            ? "VIX 恐慌指数"
            : "VXN 隐含波动率"
          : source.label.replace(/ 日线.*/, "")}
      </span>
      <span className="tnum opacity-70">{live ? "实时" : source.ok ? "快照" : "降级"}</span>
    </Badge>
  );
}

export function Delta({ value, suffix = "%", digits = 2 }: { value: number | null | undefined; suffix?: string; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted-foreground">—</span>;
  const positive = value > 0;
  return (
    <span className={`tnum ${positive ? "text-[var(--d-mint)]" : value < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}`}>
      {positive ? "+" : ""}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border/70 bg-secondary/30 px-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-2.5 py-2 text-[11px] font-medium text-muted-foreground ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({
  children,
  right,
  mono,
  className,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td className={`px-2.5 py-2 text-xs align-top ${right ? "text-right" : "text-left"} ${mono === false ? "" : "tnum"} ${className ?? ""}`}>
      {children}
    </td>
  );
}

export function regimeTone(key?: string): { label: string; className: string } {
  switch (key) {
    case "compressed":
      return { label: "波动压缩", className: "text-[var(--d-vxn)] border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10" };
    case "elevated":
      return { label: "波动偏高", className: "text-[var(--d-rv63)] border-[var(--d-rv63)]/40 bg-[var(--d-rv63)]/10" };
    case "panic":
      return { label: "恐慌", className: "text-[var(--d-red)] border-[var(--d-red)]/40 bg-[var(--d-red)]/10" };
    default:
      return { label: "中性", className: "text-[var(--d-mint)] border-[var(--d-mint)]/40 bg-[var(--d-mint)]/10" };
  }
}

export function pctText(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;
}

export function numText(v: number | null | undefined, digits = 2): string {
  return fmt(v, digits);
}
