import { STEP_ORDER, type OnboardingStep } from "@/lib/onboarding";

export function Progress({ step }: { step: OnboardingStep }) {
  const i = STEP_ORDER.indexOf(step);
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-10 h-1 bg-border">
        <div className="h-full rounded-r-full bg-gradient-to-r from-[#6366F1] to-[#06B6D4] transition-all duration-500" style={{ width: `${((i + 1) / STEP_ORDER.length) * 100}%` }} />
      </div>
      <div className="mb-5 flex items-center justify-center gap-2" aria-label={`Step ${i + 1} of ${STEP_ORDER.length}`}>
        {STEP_ORDER.map((s, n) => <span key={s} className={`h-1.5 rounded-full transition-all ${n === i ? "w-6 bg-accent" : n < i ? "w-1.5 bg-accent/50" : "w-1.5 bg-border-strong"}`} />)}
        <span className="eyebrow ml-2">Step {i + 1} of {STEP_ORDER.length}</span>
      </div>
    </>
  );
}
