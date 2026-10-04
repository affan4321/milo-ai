import { eq } from "drizzle-orm";
import { getDb, calendarConnections } from "@milo/db";
import { getCurrentUser } from "@/lib/session";
import { Progress } from "../progress";
import { finishCalendarAction } from "../actions";
import { ConnectIcsForm } from "../../(app)/home/connect-form";

export const dynamic = "force-dynamic";
export default async function CalendarStep() {
  const user = await getCurrentUser();
  const conns = await getDb().select().from(calendarConnections).where(eq(calendarConnections.userId, user.id));
  const connected = conns.some((c) => c.lastSyncedAt && !c.lastError);
  return (
    <div className="w-full max-w-xl space-y-6">
      <Progress step="calendar" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Connect your calendar</h1>
        <p className="mt-2 text-muted">Milo uses it to know which meetings to join.{conns.some((c) => c.kind === "google") && " Your Google Calendar is linked from sign-in."}</p>
      </div>
      <ConnectIcsForm />
      <form action={finishCalendarAction} className="flex items-center justify-between">
        <span className="text-sm text-muted">{connected ? "Calendar connected." : "You can also do this later from Home."}</span>
        <button className={connected ? "rounded bg-accent px-5 py-2 text-sm font-medium text-white" : "rounded border border-border px-5 py-2 text-sm"}>
          {connected ? "Continue" : "Skip for now"}
        </button>
      </form>
    </div>
  );
}
