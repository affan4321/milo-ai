"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@milo/db";
import { createAlert, deleteAlert } from "@milo/notify";
import { getCurrentUser } from "@/lib/session";

export type FormState = { error?: string } | null;
export async function createAlertAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const r = await createAlert(getDb(), user.id, String(form.get("keyword") ?? ""), form.get("email") === "on");
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/alerts"); return null;
}
export async function deleteAlertAction(id: string) { const u = await getCurrentUser(); await deleteAlert(getDb(), u.id, id); revalidatePath("/alerts"); redirect("/alerts"); }
