"use client";
import { useActionState, useState } from "react";
import { savePreferencesAction, type PrefsState } from "../actions";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";

const sel = "field field-lg font-medium";
export function PreferencesForm() {
  const [state, action, pending] = useActionState<PrefsState, FormData>(savePreferencesAction, null);
  const [record, setRecord] = useState(state?.values?.record ?? "all");
  return (
    <form action={action} className="space-y-8 text-center">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xl font-semibold tracking-tight sm:text-2xl">
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
        <label className="card mx-auto flex max-w-lg items-start gap-3 p-4 text-left text-sm leading-relaxed text-muted">
          <input type="checkbox" name="consent" defaultChecked={state?.values?.consent ?? true} key={String(state?.values?.consent)} className="check mt-0.5" />
          I understand that I&apos;m responsible for getting attendees&apos; consent to recording and transcription, as the laws where we meet require.
        </label>
      )}
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <button disabled={pending} className="btn btn-primary btn-lg px-10">Continue</button>
    </form>
  );
}
