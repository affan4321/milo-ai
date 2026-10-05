/** Date wording shared by lists: "Today", "Tomorrow", "Yesterday", otherwise "Mon, Oct 5". */
export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export const timeLabel = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Today, 2:30 PM" */
export const whenLabel = (d: Date, now = new Date()) => `${dayLabel(d, now)}, ${timeLabel(d)}`;

/** Splits an already-sorted list into runs that share a day. */
export function groupByDay<T>(items: T[], at: (item: T) => Date): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = dayLabel(at(it));
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(it); else out.push({ day, items: [it] });
  }
  return out;
}
