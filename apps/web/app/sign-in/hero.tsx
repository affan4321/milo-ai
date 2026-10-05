"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Sparkles } from "lucide-react";

const LINES = [
  { who: "Priya", hue: "#a5b4fc", text: "Can we lock the launch date for the 14th?" },
  { who: "Daniel", hue: "#67e8f9", text: "Yes, if design signs off by Friday." },
  { who: "Priya", hue: "#a5b4fc", text: "Great. I'll send the brief to the agency today." },
];
const NOTES = ["Launch date set for the 14th", "Design sign-off due Friday", "Priya to send the agency brief"];

/** The picture on the sign-in page: a meeting being transcribed, then turned into notes. Purely decorative. */
export function SignInHero() {
  // Counts up one beat at a time: three transcript lines, then three notes, a pause, and round again.
  const [beat, setBeat] = useState(0);
  useEffect(() => { const t = setInterval(() => setBeat((b) => (b + 1) % 9), 1400); return () => clearInterval(t); }, []);
  const lines = LINES.slice(0, Math.min(beat + 1, 3)), notes = NOTES.slice(0, Math.max(0, beat - 2));

  return (
    <div className="w-full max-w-md" aria-hidden>
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />Weekly product sync</span>
          <span className="flex h-5 items-center gap-[3px]">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <motion.span key={i} className="w-[3px] rounded-full bg-white/70" animate={{ height: ["25%", "100%", "40%", "80%", "25%"] }}
                transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.11, ease: "easeInOut" }} />
            ))}
          </span>
        </div>
        <div className="mt-4 min-h-[9.5rem] space-y-3">
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <motion.div key={l.text} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="text-sm leading-relaxed text-white/90">
                <span className="mr-2 text-xs font-semibold" style={{ color: l.hue }}>{l.who}</span>{l.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/60"><Sparkles className="h-3.5 w-3.5" />Milo&apos;s notes</div>
          <ul className="mt-3 min-h-[5.25rem] space-y-2">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <motion.li key={n} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="flex items-center gap-2 text-sm text-white">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />{n}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
    </div>
  );
}
