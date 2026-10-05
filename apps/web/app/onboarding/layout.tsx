import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden px-4 py-8 sm:px-6 sm:py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[48rem] max-w-[160vw] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" aria-hidden />
      <div className="relative"><Logo /></div>
      <div className="relative flex w-full flex-1 animate-rise items-center justify-center py-10">{children}</div>
    </div>
  );
}
