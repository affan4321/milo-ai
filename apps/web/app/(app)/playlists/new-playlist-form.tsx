"use client";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createPlaylistAction, type FormState } from "./actions";

export function NewPlaylistForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPlaylistAction, null);
  return (
    <form action={action} className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input name="name" required maxLength={80} placeholder="Name a new playlist, e.g. Customer objections" aria-label="New playlist name" className="field min-w-0 flex-[1_1_14rem]" />
        <button disabled={pending} className="btn btn-primary"><Plus />Create playlist</button>
      </div>
      {state?.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
