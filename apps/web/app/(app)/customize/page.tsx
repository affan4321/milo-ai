import { Video } from "lucide-react";
import { getDb } from "@milo/db";
import { Badge, IconTile, PageHeader, Section } from "@/components/ui";
import { botCapacity } from "@milo/calendar";
import { getCurrentUser } from "@/lib/session";
import { getPrefs } from "@/lib/onboarding-state";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";
import { AutoSave } from "../settings/auto-save";
import { savePrefsAction } from "../settings/actions";

export const dynamic = "force-dynamic";
const sel = "field field-lg font-medium";

/** The sentence-style rule picker and one card per meeting platform, mirroring the original's customize page. */
export default async function CustomizePage() {
  const user = await getCurrentUser();
  const [p, cap] = await Promise.all([getPrefs(user.id), botCapacity(getDb())]);
  const meetOn = p.recordPlatforms.includes("meet");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Recording rules" description="Decide which meetings Milo joins on its own and who gets the recap afterwards. Changes save as you make them." />

      <AutoSave action={savePrefsAction} className="card p-5 sm:p-6">
        <input type="hidden" name="group" value="rules" />
        <div className="eyebrow mb-4">Your rule</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 text-base font-medium tracking-tight sm:text-lg">
          <span>Auto-record</span>
          <select name="record" defaultValue={p.autoRecordRule} className={sel} aria-label="Which meetings to record">{RECORD_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <span>and email the recap to</span>
          <select name="share" defaultValue={p.autoShareRule} className={sel} aria-label="Who receives the recap">{SHARE_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </div>
      </AutoSave>

      <Section title="Video conferencing" description="Where Milo can join as a participant." className="mt-10">
        <div className="space-y-3">
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <IconTile icon={Video} tone="accent" />
              <div className="flex-1 font-medium">Google Meet</div>
              {cap.alive > 0 ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="warn" dot>Bot offline</Badge>}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{cap.alive > 0 ? `${cap.alive} meeting ${cap.alive === 1 ? "bot is" : "bots are"} running (${cap.busy} in a meeting). Milo joins as a visible participant named “Milo AI Notetaker”.` : "No meeting bot is running right now, so Milo can't join Meet calls. Start it and this will say Ready."}</p>
            <AutoSave action={savePrefsAction} className="mt-4 border-t border-border pt-4">
              <input type="hidden" name="group" value="platforms" />
              <label className="flex items-center justify-between gap-4 text-sm font-medium"><span>Auto-record Google Meet meetings from my calendar</span><input type="checkbox" name="meet" defaultChecked={meetOn} className="switch" /></label>
            </AutoSave>
          </div>
          {[["Zoom", "Milo can't join Zoom calls yet."], ["Microsoft Teams", "Milo can't join Teams calls yet."]].map(([name, note]) => (
            <div key={name} className="card bg-transparent p-5 shadow-none">
              <div className="flex items-center gap-4">
                <IconTile icon={Video} />
                <div className="flex-1 font-medium text-muted">{name}</div>
                <Badge>Not available yet</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{note} You can still upload a recording of the call.</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
