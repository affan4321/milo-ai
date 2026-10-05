"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring, useTransform } from "motion/react";
import { CheckCircle2, ListChecks, Sparkles } from "lucide-react";

const LINES = [
  { who: "Priya", hue: "#a5b4fc", t: "0:42", text: "Can we lock the launch date for the 14th?" },
  { who: "Daniel", hue: "#67e8f9", t: "0:47", text: "Yes, as long as design signs off by Friday." },
  { who: "Maya", hue: "#f0abfc", t: "0:55", text: "Pricing is still open. I'd like customer feedback first." },
  { who: "Priya", hue: "#a5b4fc", t: "1:03", text: "Fair. I'll send the brief to the agency today." },
];
const NOTES = ["Launch date set for the 14th", "Design sign-off due Friday", "Pricing decision waits on customer feedback"];
const TODOS = [["Priya", "Send the brief to the agency"], ["Daniel", "Confirm design sign-off"]];
const BEATS = LINES.length + NOTES.length + TODOS.length + 3; // the extra beats hold the finished state before it loops

/** The product in miniature: a call being transcribed on the left while Milo's notes and action items fill in on the right. Decorative. */
export function HeroMock() {
  const frame = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  useEffect(() => { const t = setInterval(() => setBeat((b) => (b + 1) % BEATS), 1300); return () => clearInterval(t); }, []);
  const lines = LINES.slice(0, Math.min(beat + 1, LINES.length));
  const notes = NOTES.slice(0, Math.max(0, Math.min(beat - LINES.length + 1, NOTES.length)));
  const todos = TODOS.slice(0, Math.max(0, Math.min(beat - LINES.length - NOTES.length + 1, TODOS.length)));

  // The window starts tipped back and settles flat as it scrolls into the middle of the screen.
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start end", "center center"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  const rotateX = useTransform(p, [0, 1], [18, 0]), scale = useTransform(p, [0, 1], [0.94, 1]), glow = useTransform(p, [0, 1], [0.35, 0.7]);

  return (
    <div ref={frame} className="relative mx-auto w-full max-w-5xl [perspective:1600px]" aria-hidden>
      <motion.div style={{ opacity: glow }} className="absolute -inset-x-10 -top-10 bottom-0 rounded-[3rem] bg-gradient-to-r from-[#6366F1] via-[#4F46E5] to-[#06B6D4] blur-3xl" />
      <motion.div style={{ rotateX, scale, transformOrigin: "50% 0%" }} className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#0d1224]/90 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="ml-3 truncate text-xs text-white/50">Weekly product sync</span>
          <span className="ml-auto flex items-center gap-2 rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-1 text-[11px] font-medium text-red-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Recording</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="border-white/10 p-5 md:border-r">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Live transcript</span>
              <span className="flex h-4 items-center gap-[3px]">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <motion.span key={i} className="w-[3px] rounded-full bg-gradient-to-t from-[#6366F1] to-[#22D3EE]" animate={{ height: ["25%", "100%", "45%", "85%", "25%"] }}
                    transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }} />
                ))}
              </span>
            </div>
            <div className="min-h-[13.5rem] space-y-3.5">
              <AnimatePresence initial={false}>
                {lines.map((l) => (
                  <motion.div key={l.text} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="flex gap-3 text-left text-sm leading-relaxed text-white/85">
                    <span className="w-8 shrink-0 pt-0.5 font-mono text-[11px] text-white/35">{l.t}</span>
                    <span><span className="mr-2 text-xs font-semibold" style={{ color: l.hue }}>{l.who}</span>{l.text}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
          <div className="space-y-4 border-t border-white/10 bg-white/[0.03] p-5 text-left md:border-t-0">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/45"><Sparkles className="h-3.5 w-3.5 text-[#22D3EE]" />Summary</div>
              <ul className="mt-3 min-h-[6rem] space-y-2">
                <AnimatePresence initial={false}>
                  {notes.map((n) => (
                    <motion.li key={n} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="flex gap-2.5 text-sm leading-relaxed text-white/90">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#818CF8]" />{n}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
            <div className="border-t border-white/10 pt-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/45"><ListChecks className="h-3.5 w-3.5 text-[#22D3EE]" />Action items</div>
              <ul className="mt-3 min-h-[3.75rem] space-y-2">
                <AnimatePresence initial={false}>
                  {todos.map(([who, what]) => (
                    <motion.li key={what} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="flex items-center gap-2.5 text-sm text-white/90">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" /><span><span className="font-medium text-white">{who}</span> · {what}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
