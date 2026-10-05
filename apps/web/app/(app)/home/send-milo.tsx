"use client";
import { useActionState, useState } from "react";
import { Video } from "lucide-react";
import { Modal } from "@/components/modal";
import { sendMiloAction, type SendState } from "./actions";

export function SendMilo() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SendState, FormData>(sendMiloAction, null);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary"><Video />Send Milo to a meeting</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send Milo to a meeting"
        description={<>Paste a Google Meet link. Milo joins as &ldquo;Milo AI Notetaker&rdquo; and the host may need to let it in.</>}>
        <form action={action} className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">Meeting link
            <input name="url" required autoFocus placeholder="https://meet.google.com/abc-defg-hij" className="field w-full font-normal" /></label>
          <label className="block space-y-1.5 text-sm font-medium">Title <span className="font-normal text-subtle">(optional)</span>
            <input name="title" placeholder="e.g. Weekly sync" className="field w-full font-normal" /></label>
          {state?.error && <p className="text-sm text-danger">{state.error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
            <button disabled={pending} className="btn btn-primary">{pending ? "Sending…" : "Send Milo"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
