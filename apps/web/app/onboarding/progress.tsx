import { STEP_ORDER, type OnboardingStep } from "@/lib/onboarding";

export function Progress({ step }: { step: OnboardingStep }) {
  const i = STEP_ORDER.indexOf(step);
  return (
    <div className="fixed inset-x-0 top-0 h-1 bg-border">
      <div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / STEP_ORDER.length) * 100}%` }} />
    </div>
  );
}
