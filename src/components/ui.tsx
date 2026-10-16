/**
 * Small, accessible building blocks. Status is never shown by colour alone: every badge has text.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const base = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60";
const variants = {
  primary: "bg-club text-white hover:bg-club-hover",
  secondary: "border border-line bg-white text-club hover:bg-surface-muted",
  danger: "border border-danger bg-white text-danger hover:bg-red-50",
} as const;

export function Button({ variant = "primary", className = "", ...p }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button {...p} className={`${base} ${variants[variant]} ${className}`} />;
}

export function LinkButton({ variant = "primary", className = "", ...p }: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link {...p} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white p-4 ${className}`}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold text-club">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const inputCls = "block w-full rounded-lg border border-line bg-white px-3 py-2 text-base";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-semibold">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={`${inputCls} ${p.className ?? ""}`} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea rows={3} {...p} className={`${inputCls} ${p.className ?? ""}`} />;
}

export function Checkbox({ label, hint, ...p }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 py-1">
      <input type="checkbox" {...p} className="mt-1 h-5 w-5 shrink-0 accent-[var(--club-primary)]" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

const tones = {
  neutral: "border-line bg-surface-muted text-ink",
  info: "border-club-blue/30 bg-blue-50 text-club-blue",
  good: "border-ok/30 bg-green-50 text-ok",
  warn: "border-amber-600/40 bg-amber-50 text-amber-900",
  bad: "border-danger/30 bg-red-50 text-danger",
  demo: "border-accent bg-orange-50 text-orange-900",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "good"; title?: string; children: ReactNode }) {
  const icon = tone === "bad" ? "⚠" : tone === "warn" ? "⚠" : tone === "good" ? "✓" : "ℹ";
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>
      {title ? <p className="font-semibold"><span aria-hidden="true">{icon} </span>{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

export function FormMessage({ result }: { result: { ok: boolean; error?: string; message?: string } | null }) {
  if (!result) return null;
  if (!result.ok) return <p role="alert" className="text-sm font-medium text-danger">{result.error}</p>;
  if (result.message) return <p role="status" className="text-sm font-medium text-ok">{result.message}</p>;
  return null;
}

export const EVENT_TYPE_LABEL: Record<string, string> = {
  fixture: "Fixture",
  training: "Training",
  meeting: "Meeting",
  maintenance: "Maintenance",
  fundraising: "Fundraising",
  club_event: "Club event",
  venue_coverage: "Venue cover",
  other: "Other",
};

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [keyof typeof tones, string]> = {
    draft: ["neutral", "Draft"],
    published: ["good", "Published"],
    postponed: ["warn", "Postponed"],
    cancelled: ["bad", "Cancelled"],
    completed: ["info", "Completed"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function CoverBadge({ state }: { state: string | null | undefined }) {
  if (!state) return null;
  const map: Record<string, [keyof typeof tones, string]> = {
    covered_by_volunteer: ["good", "Site lead confirmed"],
    covered_by_provider: ["info", "Site covered by provider"],
    not_required: ["neutral", "No site lead needed"],
    at_risk: ["warn", "Venue cover at risk"],
    no_cover: ["bad", "No site lead"],
  };
  const [tone, label] = map[state] ?? ["neutral", state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge({ show }: { show: boolean }) {
  return show ? <Badge tone="demo">DEMO</Badge> : null;
}
