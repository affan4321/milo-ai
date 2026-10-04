import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { currentStep } from "@/lib/onboarding-state";

export const dynamic = "force-dynamic";
export default async function Onboarding() {
  const step = await currentStep(await getCurrentUser());
  redirect(step === "done" ? "/home" : `/onboarding/${step}`);
}
