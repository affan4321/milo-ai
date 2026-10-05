import Link from "next/link";
import { getDb } from "@milo/db";
import { listAlerts } from "@milo/notify";
import { getCurrentUser } from "@/lib/session";
import { ArrowRight, Bell, BellOff } from "lucide-react";
import { EmptyState, IconTile, PageHeader } from "@/components/ui";
import { NewAlertForm } from "./new-alert-form";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const user = await getCurrentUser();
  const list = await listAlerts(getDb(), user.id);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Alerts" description="Milo checks every new meeting for the words you choose and tells you where they came up, with a link to that moment." />
      <div className="space-y-6">
        <NewAlertForm />
        {list.length === 0 ? <EmptyState icon={Bell} title="No alerts yet">Add a word or phrase above. Milo will list every meeting where it gets mentioned.</EmptyState> : (
          <ul className="card divide-y divide-border overflow-hidden">
            {list.map((a) => (
              <li key={a.id}><Link href={`/alerts/${a.id}`} className="group flex items-center gap-3 p-3 transition-colors hover:bg-raised sm:gap-4 sm:p-4">
                <IconTile icon={a.notifyEmail ? Bell : BellOff} tone={a.unseen > 0 ? "accent" : "neutral"} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">&ldquo;{a.keyword}&rdquo;</span>
                  <span className="text-sm text-muted">{a.total} {a.total === 1 ? "mention" : "mentions"}{!a.notifyEmail && " · no email"}</span></span>
                {a.unseen > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">{a.unseen} new</span>}
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-subtle transition-transform sm:block group-hover:translate-x-0.5 group-hover:text-text" />
              </Link></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
