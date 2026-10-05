import type { ReactNode } from "react";

/** Remounts on each navigation, so every page eases in. Background refreshes (router.refresh) don't replay it. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}
