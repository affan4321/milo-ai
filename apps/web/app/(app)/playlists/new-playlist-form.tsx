"use client";
import { useActionState } from "react";
import { createPlaylistAction, type FormState } from "./actions";

export function NewPlaylistForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPlaylistAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" required maxLength={80} placeholder="New playlist name" className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-sm" />
      <button disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Create playlist</button>
      {state?.error && <p className="w-full text-sm text-red-500">{state.error}</p>}
    </form>
  );
}
