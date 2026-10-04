"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upload(file: File) {
    setError(null); setPct(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api/upload");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => { setPct(null); setError("Upload failed. Check your connection and try again."); };
    xhr.onload = () => {
      let body: { meetingId?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200 && body.meetingId) router.push(`/meetings/${body.meetingId}`);
      else { setPct(null); setError(body.error ?? `Upload failed (HTTP ${xhr.status}).`); }
    };
    xhr.send(file);
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
