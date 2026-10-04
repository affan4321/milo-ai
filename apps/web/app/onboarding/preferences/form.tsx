"use client";
import { useActionState, useState } from "react";
import { savePreferencesAction, type PrefsState } from "../actions";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";

const sel = "rounded-lg border border-border bg-surface px-3 py-2 text-base";
export function PreferencesForm() {
  const [state, action, pending] = useActionState<PrefsState, FormData>(savePreferencesAction, null);
  const [record, setRecord] = useState(state?.values?.record ?? "all");
  return (
    <form action={action} className="space-y-6 text-center">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xl">
        <span>Take notes on</span>
        <select name="record" defaultValue={state?.values?.record ?? "all"} key={state?.values?.record} onChange={(e) => setRecord(e.target.value)} className={sel}>
          {RECORD_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <span>and share with</span>
        <select name="share" defaultValue={state?.values?.share ?? "attendees"} key={state?.values?.share} className={sel}>
          {SHARE_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      {record !== "none" && (
        <label className="mx-auto flex max-w-lg items-start gap-3 text-left text-sm text-muted">
          <input type="checkbox" name="consent" defaultChecked={state?.values?.consent ?? true} key={String(state?.values?.consent)} className="mt-1" />
          I understand that I&apos;m responsible for getting attendees&apos; consent to recording and transcription, as the laws where we meet require.
        </label>
      )}
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      <button disabled={pending} className="rounded bg-accent px-8 py-2.5 text-sm font-medium text-white disabled:opacity-60">Continue</button>
    </form>
  );
}
