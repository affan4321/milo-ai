export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-lg bg-border" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-border/70" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex items-center gap-4 p-4 shadow-none">
            <div className="h-10 w-10 rounded-[10px] bg-border" />
            <div className="flex-1 space-y-2"><div className="h-4 w-1/3 rounded bg-border" /><div className="h-3 w-1/2 rounded bg-border/70" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
