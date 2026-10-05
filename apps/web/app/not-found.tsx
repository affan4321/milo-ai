import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-lg font-semibold">We couldn't find that</h1>
      <p className="mt-2 text-sm text-muted">The page or meeting doesn't exist, was deleted, or isn't shared with you.</p>
      <Link href="/home" className="mt-4 inline-block rounded bg-accent px-3 py-1.5 text-sm text-white">Back to Home</Link>
    </div>
  );
}
