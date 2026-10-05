import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Landing } from "./_landing/landing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milo.ai · The AI notetaker that remembers every meeting", description: "Milo joins your calls, writes the notes and action items, and lets you search or ask about anything that was said." };

/** Signed-in people go straight to their meetings; everyone else gets the landing page. */
export default async function Index() {
  if (await auth()) redirect("/home");
  // Without Google sign-in configured (local development) there is no sign-in step, so the buttons open the app directly.
  return <Landing startHref={process.env.GOOGLE_CLIENT_ID ? "/sign-in" : "/home"} />;
}
