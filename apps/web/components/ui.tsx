import Link from "next/link";
import { useId, type ComponentType, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

type Icon = ComponentType<{ className?: string }>;

/** The Milo.ai mark (soundwave bars that read as an "M", with an AI sparkle) and wordmark. The app icon in app/icon.svg is the same drawing. */
export function Logo({ size = "md", wordmark = true, onDark = false }: { size?: "sm" | "md" | "lg"; wordmark?: boolean; onDark?: boolean }) {
  const id = useId();
  const mark = size === "lg" ? "h-10" : size === "sm" ? "h-6" : "h-8";
  const text = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-[22px]";
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 74 56" className={`w-auto shrink-0 ${mark}`} fill="none" aria-hidden>
        <defs>
          <linearGradient id={`${id}w`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#6366F1" /><stop offset="50%" stopColor={onDark ? "#818CF8" : "#4F46E5"} /><stop offset="100%" stopColor="#06B6D4" /></linearGradient>
          <linearGradient id={`${id}s`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#818CF8" /></linearGradient>
        </defs>
        <g fill={`url(#${id}w)`}><rect x="0" y="24" width="8" height="24" rx="4" /><rect x="14" y="10" width="8" height="42" rx="4" /><rect x="28" y="20" width="8" height="28" rx="4" /><rect x="42" y="6" width="8" height="48" rx="4" /><rect x="56" y="24" width="8" height="24" rx="4" /></g>
        <path d="M62 4Q62 14 72 14Q62 14 62 24Q62 14 52 14Q62 14 62 4Z" fill={`url(#${id}s)`} />
      </svg>
      {wordmark && <span className={`font-extrabold leading-none tracking-tight ${onDark ? "text-white" : "text-text"} ${text}`}>Milo<span className={`font-bold ${onDark ? "text-indigo-300" : "text-accent-ink"}`}>.ai</span></span>}
    </span>
  );
}

/** The title block every page starts with: where you are, what it is for, and the main thing you can do here. */
export function PageHeader({ title, description, back, actions, eyebrow }: { title: ReactNode; description?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-8">
      {back && <Link href={back.href} className="-ml-1 mb-3 inline-flex items-center gap-1 rounded text-sm text-muted hover:text-text"><ChevronLeft className="h-4 w-4" />{back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="break-words text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled group inside a page. `aside` sits on the right of the title (a count, a small action). */
export function Section({ title, description, aside, children, className = "" }: { title: ReactNode; description?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
        {aside && <div className="flex shrink-0 items-center gap-3 text-xs text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

const TONES = {
  neutral: "border-border bg-raised text-muted",
  accent: "border-accent/20 bg-accent/10 text-accent-ink",
  success: "border-success/25 bg-success/10 text-success",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/25 bg-danger/10 text-danger",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", dot, pulse, children, title }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? "animate-pulse" : ""}`} />}
      {children}
    </span>
  );
}

/** A square icon tile used at the start of list rows and cards. */
export function IconTile({ icon: I, tone = "neutral", size = "md" }: { icon: Icon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-xl" : size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-[10px]";
  const glyph = size === "lg" ? "h-5.5 w-5.5" : size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]";
  return <span className={`inline-flex shrink-0 items-center justify-center border ${TONES[tone]} ${box}`}><I className={glyph} /></span>;
}

/** What a list shows when it has nothing in it: says what will appear here and how to get the first one. */
export function EmptyState({ icon, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border-strong px-6 py-10 text-center">
      <IconTile icon={icon} tone="accent" size="lg" />
      <div className="mt-4 font-medium">{title}</div>
      {children && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** An inline notice. Tone carries the meaning: warn = degraded but working, danger = failed. */
export function Notice({ tone = "warn", icon: I, title, children, action }: { tone?: "warn" | "danger" | "accent"; icon?: Icon; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const ring = tone === "danger" ? "border-danger/30 bg-danger/[0.07]" : tone === "accent" ? "border-accent/30 bg-accent/[0.07]" : "border-warn/35 bg-warn/[0.08]";
  const ink = tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent-ink" : "text-warn";
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm ${ring}`}>
      {I && <I className={`mt-0.5 h-4 w-4 shrink-0 ${ink}`} />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={`leading-relaxed text-muted ${title ? "mt-1" : ""}`}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Initials on a tinted disc. The tint is derived from the name so the same person always gets the same colour. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"}`}
      style={{ background: `linear-gradient(135deg, hsl(${h} 65% 58%), hsl(${(h + 40) % 360} 60% 46%))` }} aria-hidden>{initials}</span>
  );
}

/** A "working on it" card: a soft pulse and one sentence about what happens next. */
export function Working({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/20 [animation-duration:1.8s]" />
        <span className="h-3 w-3 rounded-full bg-accent" />
      </span>
      <div className="text-sm"><div className="font-medium">{title}</div>{children && <p className="mt-0.5 text-muted">{children}</p>}</div>
    </div>
  );
}
