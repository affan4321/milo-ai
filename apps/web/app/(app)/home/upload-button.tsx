"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function put(url: string, file: File, headers: Record<string, string>): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
      xhr.send(file);
    });
  }

  async function upload(file: File) {
    setError(null); setPct(0);
    try {
      // Ask where the file goes. Cloud storage: straight to the bucket, then tell the app. Local storage: stream through the app.
      const init = await fetch("/api/upload/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size }) });
      const plan = (await init.json().catch(() => ({}))) as { mode?: string; url?: string; key?: string; contentType?: string; error?: string };
      if (!init.ok) throw new Error(plan.error ?? `Upload failed (HTTP ${init.status}).`);
      let body: { meetingId?: string; error?: string } = {};
      if (plan.mode === "direct" && plan.url && plan.key) {
        const r = await put(plan.url, file, { "content-type": plan.contentType ?? "application/octet-stream" });
        if (r.status < 200 || r.status >= 300) throw new Error(`Upload failed (HTTP ${r.status}).`);
        setPct(100);
        const done = await fetch("/api/upload/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: plan.key, filename: file.name }) });
        body = await done.json().catch(() => ({}));
      } else {
        const r = await put("/api/upload", file, { "x-filename": encodeURIComponent(file.name) });
        try { body = JSON.parse(r.text); } catch {}
        if (r.status !== 200 && !body.error) body.error = `Upload failed (HTTP ${r.status}).`;
      }
      if (body.meetingId) router.push(`/meetings/${body.meetingId}`);
      else throw new Error(body.error ?? "Upload failed.");
    } catch (e) { setPct(null); setError(e instanceof Error ? e.message : "Upload failed."); }
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="video/*,audio/*,.mkv,.m4a" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <button onClick={() => input.current?.click()} disabled={pct !== null}
        className="rounded border border-border px-4 py-2 text-sm disabled:opacity-60">
        {pct === null ? "Upload a recording" : pct < 100 ? `Uploading… ${pct}%` : "Finishing upload…"}
      </button>
      {pct !== null && <div className="h-1 w-48 overflow-hidden rounded bg-border"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
