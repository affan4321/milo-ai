"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Bell, CalendarDays, Link2, Scissors, Search, Sparkles, Star } from "lucide-react";

/** Counts 0..n-1 on a timer, but only while the element is on screen, so off-screen demos cost nothing. */
function useLoop(n: number, ms: number) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { margin: "-10% 0px" });
  const [i, setI] = useState(0);
  useEffect(() => { if (!seen) return; const t = setInterval(() => setI((x) => (x + 1) % n), ms); return () => clearInterval(t); }, [seen, n, ms]);
  return [ref, i] as const;
}

/** Types `text` out one character at a time once `on` is true. */
function useTyped(text: string, on: boolean, speed = 38) {
  const [n, setN] = useState(0);
  useEffect(() => { if (!on) { setN(0); return; } if (n >= text.length) return; const t = setTimeout(() => setN(n + 1), speed); return () => clearTimeout(t); }, [on, n, text, speed]);
  return text.slice(0, n);
}

function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface p-5 shadow-pop ${className}`} aria-hidden>{children}</div>;
}
const Face = ({ c, children }: { c: string; children: ReactNode }) => <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-surface" style={{ background: c }}>{children}</span>;

/** Step 1: a calendar event, then Milo arriving in the call. */
export function JoinDemo() {
  const [ref, i] = useLoop(4, 1500);
  return (
    <Frame>
      <div ref={ref} className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-bg p-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent-ink"><CalendarDays className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">Customer kickoff</div><div className="text-xs text-muted">Today, 2:00 PM · Google Meet</div></div>
          <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-accent-ink"><span className="hidden sm:inline">Milo will record</span><span className="flex h-5 w-9 items-center justify-end rounded-full bg-accent p-0.5"><span className="h-4 w-4 rounded-full bg-white" /></span></span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex -space-x-2">
            <Face c="#6366F1">PK</Face><Face c="#0891B2">DM</Face><Face c="#C026D3">MA</Face>
            <AnimatePresence>
              {i >= 1 && <motion.span key="milo" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#6366F1] to-[#06B6D4] text-white ring-2 ring-surface"><Sparkles className="h-4 w-4" /></motion.span>}
            </AnimatePresence>
          </div>
          <AnimatePresence mode="wait">
            <motion.span key={i >= 2 ? "rec" : i === 1 ? "in" : "wait"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${i >= 2 ? "border-danger/30 bg-danger/10 text-danger" : "border-border bg-raised text-muted"}`}>
              {i >= 2 ? "● Recording" : i === 1 ? "Milo AI Notetaker joined" : "Waiting for the call to start"}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </Frame>
  );
}

const SPEAKERS = [["Priya", "#6366F1", 46], ["Daniel", "#0891B2", 31], ["Maya", "#C026D3", 23]] as const;
/** Step 2: sound becoming speaker-labelled text, with talk time. */
export function TranscribeDemo() {
  const [ref, i] = useLoop(3, 1700);
  return (
    <Frame>
      <div ref={ref} className="space-y-4">
        <div className="flex h-10 items-center gap-[3px]">
          {Array.from({ length: 40 }, (_, k) => (
            <motion.span key={k} className="flex-1 rounded-full bg-gradient-to-t from-[#6366F1] to-[#22D3EE]" animate={{ height: [`${20 + ((k * 37) % 60)}%`, `${30 + ((k * 53) % 70)}%`, `${20 + ((k * 37) % 60)}%`] }}
              transition={{ duration: 1.2 + (k % 5) * 0.15, repeat: Infinity, ease: "easeInOut" }} />
          ))}
        </div>
        <div className="space-y-2">
          {SPEAKERS.map(([name, c], k) => (
            <div key={name} className={`flex gap-3 rounded-lg border-l-2 px-3 py-1.5 text-sm transition-colors duration-500 ${k === i ? "border-accent bg-accent/10" : "border-transparent"}`}>
              <span className="w-10 shrink-0 font-mono text-xs leading-5 text-subtle">{`0:${12 + k * 9}`}</span>
              <span className="w-14 shrink-0 text-xs font-semibold leading-5" style={{ color: c }}>{name}</span>
              <span className="flex flex-1 flex-col justify-center gap-1.5"><span className="h-1.5 rounded-full bg-border-strong" style={{ width: `${90 - k * 14}%` }} /><span className="h-1.5 rounded-full bg-border" style={{ width: `${55 + k * 10}%` }} /></span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-[11px] text-muted"><span>Talk time</span><span>Who spoke, and how much</span></div>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {SPEAKERS.map(([name, c, pct]) => <motion.span key={name} style={{ background: c }} initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />)}
          </div>
        </div>
      </div>
    </Frame>
  );
}

const TEMPLATES = [
  ["General", ["Overview", "Key points", "Decisions made"]],
  ["Sales", ["Customer needs", "Objections", "Next steps"]],
  ["1:1", ["Wins", "Blockers", "Follow-ups"]],
] as const;
/** Step 3: the same meeting summarised through different templates. */
export function SummaryDemo() {
  const [ref, i] = useLoop(TEMPLATES.length, 2400);
  return (
    <Frame>
      <div ref={ref}>
        <div className="mb-4 flex gap-1.5">
          {TEMPLATES.map(([name], k) => <span key={name} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-300 ${k === i ? "bg-accent text-white" : "bg-raised text-muted"}`}>{name}</span>)}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="space-y-3.5">
            {TEMPLATES[i]![1].map((h, k) => (
              <div key={h}>
                <div className="mb-1.5 text-sm font-semibold">{h}</div>
                <div className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-accent" /><span className="h-1.5 rounded-full bg-border-strong" style={{ width: `${70 - k * 12}%` }} /><span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-ink">{`${k * 4 + 1}:${10 + k * 13}`}</span></div>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/** Step 4: searching by meaning and landing on the exact moment. */
export function FindDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-20% 0px" });
  const typed = useTyped("what did we decide on pricing", seen);
  const done = typed.length === 29;
  return (
    <Frame>
      <div ref={ref} className="space-y-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-border-strong bg-bg px-3.5 py-2.5 text-sm">
          <Search className="h-4 w-4 shrink-0 text-subtle" /><span>{typed}</span><span className="h-4 w-px animate-pulse bg-accent" />
        </div>
        {[["Pricing launch sync", "7:24", "Maya", "is still the open question for next week.", "exact + meaning"], ["Quarterly planning", "18:02", "Daniel", "We agreed to hold the current tiers until Q3.", "similar meaning"]].map(([title, t, who, text, via], k) => (
          <motion.div key={title} initial={false} animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ delay: k * 0.18, duration: 0.4 }} className="rounded-xl border border-border bg-bg p-3">
            <div className="flex items-center justify-between text-xs"><span className="font-medium">{title}</span><span className="text-subtle">{via}</span></div>
            <div className="mt-1.5 flex gap-2.5 text-sm leading-relaxed"><span className="h-fit rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">{t}</span>
              <span><span className="mr-1.5 text-xs font-semibold text-accent-ink">{who}</span>{k === 0 && <mark className="rounded bg-warn/25 px-0.5 font-medium text-text">Pricing</mark>} {text}</span></div>
          </motion.div>
        ))}
      </div>
    </Frame>
  );
}

const QUESTION = "What did customers push back on this month?";
/** The Ask Milo showcase: a typed question, then an answer whose claims link to the moment they came from. */
export function AskDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-25% 0px" });
  const typed = useTyped(QUESTION, seen, 30);
  const asked = typed.length === QUESTION.length;
  const [stage, setStage] = useState(0); // 0 typing, 1 thinking, 2 answered
  useEffect(() => { if (!asked) return; setStage(1); const t = setTimeout(() => setStage(2), 1300); return () => clearTimeout(t); }, [asked]);
  const Cite = ({ n }: { n: number }) => <span className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#818CF8]/30 px-1 align-text-top text-[11px] font-semibold text-indigo-100">{n}</span>;
  return (
    <div ref={ref} className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-left shadow-2xl backdrop-blur-xl sm:p-6" aria-hidden>
      <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-[#4F46E5] px-4 py-2.5 text-sm leading-relaxed text-white">{typed || " "}{!asked && <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-white align-middle" />}</div>
      <div className="mt-5 flex min-h-[11rem] gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#67e8f9]"><Sparkles className="h-3.5 w-3.5" /></span>
        {stage === 1 && <span className="flex items-center gap-1 pt-2.5">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-white/70 [animation:typing_1.2s_infinite]" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>}
        {stage === 2 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="min-w-0 flex-1 space-y-4 text-sm leading-relaxed text-white/90">
            <p>Two themes came up. Several customers said the onboarding takes too long to set up<Cite n={1} />, and two asked for clearer refund terms before renewing<Cite n={2} />.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[["Acme onboarding review", "12:40", "Jordan"], ["Refund review call", "4:18", "Sam"]].map(([title, t, who], k) => (
                <motion.div key={title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + k * 0.15 }} className="flex gap-2.5 rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs">
                  <Cite n={k + 1} /><span className="min-w-0"><span className="block truncate font-medium text-white">{title}</span><span className="text-white/50"><span className="font-mono">{t}</span> · {who}</span></span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Small looping pictures for the feature grid. */
export function ClipDemo() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="relative h-2 rounded-full bg-raised">
        <motion.span className="absolute inset-y-0 rounded-full bg-warn" initial={{ left: "22%", width: "0%" }} whileInView={{ width: "26%" }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2 }} />
        <span className="absolute inset-y-0 left-[64%] w-[9%] rounded-full bg-warn/50" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-medium text-warn"><Star className="h-3 w-3" />Highlight 12:40–13:10</span>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted"><Scissors className="h-3 w-3" />Clip</span>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted"><Link2 className="h-3 w-3" />Public link</span>
      </div>
    </div>
  );
}
export function AlertDemo() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-ink">
        <Bell className="h-5 w-5" /><span className="absolute -right-1 -top-1 flex h-3 w-3"><span className="absolute inset-0 animate-ping rounded-full bg-accent/60" /><span className="relative h-3 w-3 rounded-full bg-accent ring-2 ring-surface" /></span>
      </span>
      <div className="min-w-0 text-sm"><div className="font-medium">&ldquo;refund&rdquo; came up</div><div className="truncate text-xs text-muted">Renewal call · 4:18 · 2 new mentions</div></div>
    </div>
  );
}
export function PlaylistDemo() {
  const [ref, i] = useLoop(3, 1600);
  const items = ["Best demo opening", "Handling the price objection", "Great discovery question"];
  return (
    <div ref={ref} className="space-y-1.5" aria-hidden>
      {items.map((t, k) => (
        <div key={t} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-300 ${k === i ? "bg-accent/10 text-accent-ink" : "text-muted"}`}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-raised font-mono text-[10px] text-muted">{k + 1}</span><span className="truncate">{t}</span>
        </div>
      ))}
    </div>
  );
}
