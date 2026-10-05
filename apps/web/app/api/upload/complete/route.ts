import { getProviders } from "@milo/providers";
import { getCurrentUser } from "@/lib/session";
import { UPLOAD_EXTS, extOf, titleFrom, createUploadMeeting, startPipeline } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** Step 2 of a direct upload: the file is in the bucket; create the meeting and start processing. Safe to call once per key. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => ({}))) as { key?: string; filename?: string; title?: string };
  const key = b.key ?? "";
  // The key must be one this user was handed, so nobody can attach someone else's file.
  if (!key.startsWith(`uploads/${user.id}/`) || key.includes("..") || !UPLOAD_EXTS.has(extOf(key))) return Response.json({ error: "Unknown upload." }, { status: 400 });
  const { storage } = getProviders();
  if (!(await storage.size(key))) return Response.json({ error: "The upload didn't arrive. Please try again." }, { status: 409 });
  const meeting = await createUploadMeeting(user.id, titleFrom(b.title, b.filename ?? "Uploaded recording"));
  await startPipeline(meeting.id, key);
  return Response.json({ meetingId: meeting.id });
}
