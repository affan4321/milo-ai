export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 rounded bg-border" />
      <div className="h-24 rounded bg-border" />
      <div className="h-24 rounded bg-border" />
    </div>
  );
}
