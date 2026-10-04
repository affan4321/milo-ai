import type { ReactNode } from "react";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-6 py-10">
      <div className="text-lg font-semibold text-accent">Milo</div>
      <div className="flex w-full flex-1 items-center justify-center">{children}</div>
    </div>
  );
}
