import Link from "next/link";
import { getDb } from "@milo/db";
import { listAlerts } from "@milo/notify";
import { getCurrentUser } from "@/lib/session";
import { HomeTabs } from "../home-tabs";
import { NewAlertForm } from "./new-alert-form";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const user = await getCurrentUser();
  const list = await listAlerts(getDb(), user.id);
  return (
    <div className="max-w-3xl space-y-6">
      <HomeTabs active="alerts" />
      <p className="text-sm text-muted">Milo checks every new meeting for the words you choose and tells you where they came up, with a link to that moment.</p>
      <NewAlertForm />
      {list.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">No alerts yet.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((a) => (
            <li key={a.id}><Link href={`/alerts/${a.id}`} className="flex items-center justify-between p-4 hover:bg-bg">
              <span className="font-medium">&ldquo;{a.keyword}&rdquo;{!a.notifyEmail && <span className="ml-2 text-xs font-normal text-muted">no email</span>}</span>
              <span className="flex items-center gap-2 text-sm text-muted">{a.total} {a.total === 1 ? "mention" : "mentions"}{a.unseen > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">{a.unseen} new</span>}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
