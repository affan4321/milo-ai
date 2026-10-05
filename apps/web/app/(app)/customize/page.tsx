import { getDb } from "@milo/db";
import { botCapacity } from "@milo/calendar";
import { getCurrentUser } from "@/lib/session";
import { getPrefs } from "@/lib/onboarding-state";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";
import { AutoSave } from "../settings/auto-save";
import { savePrefsAction } from "../settings/actions";

export const dynamic = "force-dynamic";
const sel = "rounded-lg border border-border bg-surface px-3 py-2 text-base";

function Status({ tone, children }: { tone: "ok" | "warn" | "off"; children: React.ReactNode }) {
  return <span className={tone === "ok" ? "text-green-500" : tone === "warn" ? "text-amber-500" : "text-muted"}>{children}</span>;
}

/** The sentence-style rule picker and one card per meeting platform, mirroring the original's customize page. */
export default async function CustomizePage() {
  const user = await getCurrentUser();
  const [p, cap] = await Promise.all([getPrefs(user.id), botCapacity(getDb())]);
  const meetOn = p.recordPlatforms.includes("meet");
  return (
    <div className="max-w-2xl space-y-8">
      <AutoSave action={savePrefsAction}>
        <input type="hidden" name="group" value="rules" />
        <div className="flex flex-wrap items-center gap-3 text-lg">
          <span>Auto-record</span>
          <select name="record" defaultValue={p.autoRecordRule} className={sel} aria-label="Which meetings to record">{RECORD_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <span>and email the recap to</span>
          <select name="share" defaultValue={p.autoShareRule} className={sel} aria-label="Who receives the recap">{SHARE_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </div>
      </AutoSave>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Video conferencing</h2>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-base font-medium">Google Meet: {cap.alive > 0 ? <Status tone="ok">Ready</Status> : <Status tone="warn">Bot offline</Status>}</div>
            <p className="mt-1 text-sm text-muted">{cap.alive > 0 ? `${cap.alive} meeting ${cap.alive === 1 ? "bot is" : "bots are"} running (${cap.busy} in a meeting). Milo joins as a visible participant named “Milo AI Notetaker”.` : "No meeting bot is running right now, so Milo can't join Meet calls. Start it and this will say Ready."}</p>
            <AutoSave action={savePrefsAction} className="mt-3 border-t border-border pt-3">
              <input type="hidden" name="group" value="platforms" />
              <label className="flex items-center justify-between gap-4 text-sm"><span>Auto-record Google Meet meetings from my calendar</span><input type="checkbox" name="meet" defaultChecked={meetOn} /></label>
            </AutoSave>
          </div>
          {[["Zoom", "Milo can't join Zoom calls yet."], ["Microsoft Teams", "Milo can't join Teams calls yet."]].map(([name, note]) => (
            <div key={name} className="rounded-lg border border-border bg-surface p-4 opacity-70">
              <div className="text-base font-medium">{name}: <Status tone="off">Not available yet</Status></div>
              <p className="mt-1 text-sm text-muted">{note} You can still upload a recording of the call.</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
