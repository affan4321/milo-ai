import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await auth()) redirect("/onboarding");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-2xl font-semibold text-accent">Milo</div>
      <h1 className="text-xl font-semibold">Sign in to take better meeting notes</h1>
      <form action={async () => { "use server"; await signIn("google", { redirectTo: "/onboarding" }); }}>
        <button className="rounded-lg border border-border bg-surface px-6 py-3 text-sm font-medium hover:border-accent">Continue with Google</button>
      </form>
      <p className="max-w-sm text-xs text-muted">Milo asks for read-only access to your Google Calendar to know which meetings to join.</p>
      {error && <p className="max-w-sm text-sm text-red-500">
        {error === "AccessDenied" ? "That Google account isn't on the test-user list yet. Ask for access and try again." : "Sign-in failed. Please try again."}
      </p>}
    </div>
  );
}
