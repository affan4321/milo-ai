"use client";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { MotionConfig, motion, useScroll, useSpring } from "motion/react";
import { ArrowRight, Bell, ListVideo, Lock, MessageSquareText, Scissors, Upload, Users, Video } from "lucide-react";
import { Logo } from "@/components/ui";
import { HeroMock } from "./hero-mock";
import { AlertDemo, AskDemo, ClipDemo, FindDemo, JoinDemo, PlaylistDemo, SummaryDemo, TranscribeDemo } from "./demos";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades its children up into place the first time they scroll into view. */
function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-12% 0px" }} transition={{ duration: 0.7, delay, ease: EASE }}>{children}</motion.div>;
}

function Heading({ eyebrow, title, children, dark }: { eyebrow: string; title: ReactNode; children?: ReactNode; dark?: boolean }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <div className={`text-xs font-semibold uppercase tracking-[0.16em] ${dark ? "text-[#67e8f9]" : "text-accent-ink"}`}>{eyebrow}</div>
      <h2 className={`mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl ${dark ? "text-white" : ""}`}>{title}</h2>
      {children && <p className={`mt-4 text-base leading-relaxed sm:text-lg ${dark ? "text-white/65" : "text-muted"}`}>{children}</p>}
    </Reveal>
  );
}

const STEPS = [
  { n: "01", title: "Milo joins the call for you", text: "Connect your calendar once. Milo enters each meeting as a visible participant, tells everyone it is recording, and you can switch any meeting off with one tap.", demo: <JoinDemo /> },
  { n: "02", title: "Every word, with who said it", text: "The recording becomes a transcript with speakers and timestamps. Click any line to jump to that second, and see at a glance who did the talking.", demo: <TranscribeDemo /> },
  { n: "03", title: "Notes written the way you work", text: "A summary and the action items are ready minutes after the call. Switch templates for sales calls, one-to-ones or your own prompt, and every point links back to the moment.", demo: <SummaryDemo /> },
  { n: "04", title: "Find anything, weeks later", text: "Search finds the moment even when you only remember the idea, not the words. Results open the recording at the right second.", demo: <FindDemo /> },
];

const FEATURES = [
  { icon: Scissors, title: "Highlights and clips", text: "Mark a moment live or afterwards, cut it into a clip, and share it with a public link.", demo: <ClipDemo />, wide: true },
  { icon: Bell, title: "Keyword alerts", text: "Pick the words that matter. Milo tells you when they come up, with a link to the moment.", demo: <AlertDemo /> },
  { icon: ListVideo, title: "Playlists", text: "Collect the best moments across meetings in the order you want.", demo: <PlaylistDemo /> },
  { icon: Users, title: "Team calls", text: "Share a meeting with your workspace and it shows up in everyone's search and answers." },
  { icon: Upload, title: "Bring your own recordings", text: "Upload any audio or video file and get the same transcript, summary and action items." },
  { icon: Lock, title: "Private by default", text: "Meetings belong to you until you share them, and Milo posts a consent notice when it joins." },
];

export function Landing({ startHref }: { startHref: string }) {
  const flow = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: flow, offset: ["start 65%", "end 65%"] });
  const line = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });
  const words = "Stay in the conversation.".split(" ");

  return (
    <MotionConfig reducedMotion="user">
      <div className="overflow-x-clip">
        <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#0c1022]/75 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" aria-label="Milo.ai home"><Logo onDark /></Link>
            <nav className="hidden items-center gap-8 text-sm text-white/70 md:flex" aria-label="Sections">
              <a href="#how" className="transition-colors hover:text-white">How it works</a>
              <a href="#ask" className="transition-colors hover:text-white">Ask Milo</a>
              <a href="#features" className="transition-colors hover:text-white">Features</a>
            </nav>
            <div className="flex items-center gap-2">
              <Link href={startHref} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white sm:block">Sign in</Link>
              <Link href={startHref} className="btn bg-white text-[#0F172A] hover:bg-white/90">Get started</Link>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#1E1B4B] via-[#131735] to-[#0F172A] px-4 pb-20 pt-32 text-center sm:px-6 sm:pt-40">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute -left-40 top-0 h-[34rem] w-[34rem] rounded-full bg-[#6366F1] opacity-40 blur-[120px] [animation:aurora_16s_ease-in-out_infinite]" />
            <div className="absolute -right-40 top-40 h-[30rem] w-[30rem] rounded-full bg-[#06B6D4] opacity-25 blur-[130px] [animation:aurora_20s_ease-in-out_infinite_reverse]" />
            <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          </div>
          <div className="relative mx-auto max-w-4xl">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur">
              <span className="flex h-3.5 items-center gap-[2px]">{[0, 1, 2, 3].map((i) => <motion.span key={i} className="w-[2px] rounded-full bg-[#22D3EE]" animate={{ height: ["35%", "100%", "35%"] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}</span>
              Your AI meeting notetaker
            </motion.div>
            <h1 className="mt-7 text-[2.6rem] font-semibold leading-[1.05] tracking-tight text-white text-balance sm:text-6xl lg:text-7xl">
              {words.map((w, i) => (
                <span key={i} className="inline-block overflow-hidden pb-1 align-bottom">
                  <motion.span className="inline-block" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: EASE }}>{w}&nbsp;</motion.span>
                </span>
              ))}
              <span className="block overflow-hidden pb-2">
                <motion.span className="inline-block bg-gradient-to-r from-[#a5b4fc] via-[#818CF8] to-[#22D3EE] bg-clip-text text-transparent" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: 0.45, ease: EASE }}>Milo takes the notes.</motion.span>
              </span>
            </h1>
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.7, ease: EASE }} className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
              Milo joins your meetings, records and transcribes them, then writes the summary and action items. Later, search or simply ask about anything that was said.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.85, ease: EASE }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href={startHref} className="btn btn-lg group bg-white text-[#0F172A] shadow-[0_0_40px_-8px_rgba(129,140,248,0.9)] hover:bg-white/90">Get started free<ArrowRight className="transition-transform group-hover:translate-x-0.5" /></Link>
              <a href="#how" className="btn btn-lg border-white/20 text-white hover:bg-white/10">See how it works</a>
            </motion.div>
            <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1.1 }} className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/55">
              <li className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5" />Google Meet, Zoom and Microsoft Teams</li>
              <li className="flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />Or upload any recording</li>
              <li className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Read-only calendar access</li>
            </motion.ul>
          </div>
          <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.9, ease: EASE }} className="relative mt-16 sm:mt-20"><HeroMock /></motion.div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
          <Heading eyebrow="How it works" title="From calendar invite to shareable notes, without lifting a finger">Four things happen every time you meet. You only have to show up for the first one.</Heading>
          <div ref={flow} className="relative mx-auto mt-16 max-w-5xl sm:mt-24">
            <div className="absolute bottom-0 left-4 top-0 w-px bg-border md:left-1/2" aria-hidden>
              <motion.div className="h-full w-full origin-top bg-gradient-to-b from-[#6366F1] to-[#06B6D4]" style={{ scaleY: line }} />
            </div>
            <ol className="space-y-16 md:space-y-28">
              {STEPS.map((s, i) => (
                <li key={s.n} className="relative grid grid-cols-1 items-center gap-6 pl-12 md:grid-cols-2 md:gap-16 md:pl-0">
                  <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true, margin: "-35% 0px" }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
                    className="absolute left-4 top-1 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br from-[#6366F1] to-[#06B6D4] font-mono text-[11px] font-semibold text-white shadow-pop ring-4 ring-bg md:left-1/2 md:top-1/2 md:-translate-y-1/2">{s.n}</motion.span>
                  <Reveal className={i % 2 ? "md:order-2 md:pl-4" : "md:pr-4 md:text-right"}>
                    <h3 className="text-2xl font-semibold tracking-tight text-balance">{s.title}</h3>
                    <p className="mt-3 leading-relaxed text-muted">{s.text}</p>
                  </Reveal>
                  <Reveal delay={0.12} className={i % 2 ? "md:order-1" : ""}>{s.demo}</Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Ask Milo */}
        <section id="ask" className="relative scroll-mt-16 overflow-hidden bg-gradient-to-br from-[#1E1B4B] to-[#0F172A] px-4 py-24 sm:px-6 sm:py-32">
          <div className="pointer-events-none absolute left-1/2 top-0 h-[26rem] w-[50rem] max-w-[140vw] -translate-x-1/2 rounded-full bg-[#4F46E5] opacity-30 blur-[130px]" aria-hidden />
          <div className="relative">
            <Heading dark eyebrow="Ask Milo" title="Ask your meetings a question. Get an answer with receipts.">Milo reads across every call you can see and answers in plain language. Each claim carries a number that opens the recording at the moment it came from.</Heading>
            <Reveal delay={0.1} className="mt-14"><AskDemo /></Reveal>
            <Reveal delay={0.2} className="mt-10 flex flex-wrap justify-center gap-2 text-sm text-white/70">
              {["What did we decide about pricing?", "What action items did I take on this week?", "What concerns did customers raise?"].map((q) => (
                <span key={q} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2"><MessageSquareText className="h-3.5 w-3.5 text-[#67e8f9]" />{q}</span>
              ))}
            </Reveal>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
          <Heading eyebrow="Everything else" title="The rest of the work that follows a meeting">Sharing the good parts, watching for what matters, and keeping it all organised.</Heading>
          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08} className={f.wide ? "sm:col-span-2 lg:col-span-1" : ""}>
                <motion.div whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="card group flex h-full flex-col p-6 transition-[border-color,box-shadow] duration-300 hover:border-accent/40 hover:shadow-pop">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-ink transition-colors duration-300 group-hover:bg-accent group-hover:text-white"><f.icon className="h-5 w-5" /></span>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{f.text}</p>
                  {f.demo && <div className="mt-5 border-t border-border pt-5">{f.demo}</div>}
                </motion.div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 pb-24 sm:px-6 sm:pb-32">
          <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#4F46E5] via-[#4338CA] to-[#0E7490] px-6 py-16 text-center shadow-modal sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-32 items-end justify-center gap-2 opacity-20 sm:gap-3" aria-hidden>
              {Array.from({ length: 28 }, (_, k) => (
                <motion.span key={k} className="w-2 rounded-t-full bg-white sm:w-3" animate={{ height: [`${20 + ((k * 29) % 50)}%`, `${45 + ((k * 47) % 55)}%`, `${20 + ((k * 29) % 50)}%`] }} transition={{ duration: 1.6 + (k % 6) * 0.2, repeat: Infinity, ease: "easeInOut" }} />
              ))}
            </div>
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white text-balance sm:text-5xl">Give your next meeting your full attention</h2>
              <p className="mx-auto mt-4 max-w-xl leading-relaxed text-white/75 sm:text-lg">Sign in, connect your calendar, and Milo will be in your next call.</p>
              <Link href={startHref} className="btn btn-lg group mt-8 bg-white text-[#0F172A] hover:bg-white/90">Get started free<ArrowRight className="transition-transform group-hover:translate-x-0.5" /></Link>
            </div>
          </Reveal>
        </section>

        <footer className="border-t border-border px-4 py-10 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <Logo size="sm" />
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted" aria-label="Footer">
              <a href="#how" className="hover:text-text">How it works</a><a href="#ask" className="hover:text-text">Ask Milo</a><a href="#features" className="hover:text-text">Features</a><Link href={startHref} className="hover:text-text">Sign in</Link>
            </nav>
            <p className="w-full text-xs text-subtle sm:w-auto">Milo.ai, an AI meeting notetaker.</p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
