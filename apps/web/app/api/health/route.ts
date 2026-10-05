import { sql } from "drizzle-orm";
import { getDb } from "@milo/db";

export const dynamic = "force-dynamic";

/** Liveness + database check for the load balancer. The failure reason is a coarse, non-sensitive category to make a bad deploy diagnosable. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, reason: "DATABASE_URL is not set" }, { status: 503 });
  try { await getDb().execute(sql`select 1`); return Response.json({ ok: true }); }
  catch (e: any) {
    const code = String(e?.code ?? e?.cause?.code ?? "");
    const reason = code === "28P01" || code === "28000" ? "database rejected the username or password"
      : code === "ENOTFOUND" ? "database host not found"
      : code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" ? "database unreachable"
      : code === "3D000" ? "database name not found"
      : `database error${code ? ` (${code})` : ""}`;
    return Response.json({ ok: false, reason }, { status: 503 });
  }
}
