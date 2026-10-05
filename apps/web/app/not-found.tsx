import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent-ink"><Compass className="h-6 w-6" /></span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">We couldn&apos;t find that</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">The page or meeting doesn&apos;t exist, was deleted, or isn&apos;t shared with you.</p>
      <Link href="/home" className="btn btn-primary mt-6">Back to Home</Link>
    </div>
  );
}
