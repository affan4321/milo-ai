"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

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
    <div className="relative">
      <input ref={input} type="file" accept="video/*,audio/*,.mkv,.m4a" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <button onClick={() => input.current?.click()} disabled={pct !== null} className="btn btn-secondary relative overflow-hidden disabled:opacity-100">
        {pct !== null && <span className="absolute inset-y-0 left-0 bg-accent/15 transition-[width]" style={{ width: `${pct}%` }} />}
        <Upload className="relative" /><span className="relative">{pct === null ? "Upload a recording" : pct < 100 ? `Uploading… ${pct}%` : "Finishing upload…"}</span>
      </button>
      {error && <p className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-danger/30 bg-surface p-2.5 text-xs text-danger shadow-pop" role="alert">{error}</p>}
    </div>
  );
}
