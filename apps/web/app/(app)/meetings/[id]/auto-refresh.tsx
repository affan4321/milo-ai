"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the server component while the pipeline is still working. */
export function AutoRefresh({ ms = 2000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), ms); return () => clearInterval(t); }, [router, ms]);
  return null;
}
