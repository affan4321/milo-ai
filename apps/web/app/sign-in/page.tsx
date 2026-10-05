import Link from "next/link";
import { redirect } from "next/navigation";
import { Mic, Search, ShieldCheck, Sparkles } from "lucide-react";
import { auth, signIn, microsoftEnabled } from "@/auth";
import { Logo } from "@/components/ui";
import { SignInHero } from "./hero";

export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await auth()) redirect("/onboarding");
  const { error } = await searchParams;
  const provider = "btn btn-secondary btn-lg w-full";
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="w-fit" aria-label="Milo.ai home"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 animate-rise flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold sm:text-3xl tracking-tight text-balance">Sign in to take better meeting notes</h1>
          <p className="mt-3 leading-relaxed text-muted">Milo joins your calls, writes the notes and remembers what was said, so you can stay in the conversation.</p>
          <div className="mt-8 space-y-3">
            <form action={async () => { "use server"; await signIn("google", { redirectTo: "/onboarding" }); }}>
              <button className={provider}>
                <svg viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.300-2.100 3.500-5.200 3.500-8.800Z" /><path fill="#34A853" d="M12 24c3.200 0 6-1.100 8-2.900l-3.900-3c-1.100.7-2.500 1.200-4.100 1.200-3.100 0-5.800-2.100-6.700-5H1.300v3.100A12 12 0 0 0 12 24Z" /><path fill="#FBBC05" d="M5.300 14.300a7.200 7.200 0 0 1 0-4.600V6.600H1.300a12 12 0 0 0 0 10.800l4-3.100Z" /><path fill="#EA4335" d="M12 4.800c1.800 0 3.300.6 4.600 1.800l3.400-3.400A12 12 0 0 0 1.300 6.600l4 3.100c.900-2.900 3.600-4.900 6.700-4.900Z" /></svg>
                Continue with Google
              </button>
            </form>
            {microsoftEnabled && (
              <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/onboarding" }); }}>
                <button className={provider}>
                  <svg viewBox="0 0 24 24" aria-hidden><path fill="#F25022" d="M2 2h9.500v9.500H2z" /><path fill="#7FBA00" d="M12.500 2H22v9.500h-9.500z" /><path fill="#00A4EF" d="M2 12.500h9.500V22H2z" /><path fill="#FFB900" d="M12.500 12.500H22V22h-9.500z" /></svg>
                  Continue with Microsoft
                </button>
              </form>
            )}
          </div>
          {error && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/[0.07] p-3 text-sm text-danger" role="alert">
            {error === "AccessDenied" ? "That account couldn't be signed in. For Google, it must be on the test-user list; for Microsoft, the account's email has to be verified by Microsoft." : "Sign-in failed. Please try again."}
          </p>}
          <p className="mt-6 flex gap-2 text-xs leading-relaxed text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-subtle" />Milo asks for read-only access to your calendar to know which meetings to join.</p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#1E1B4B] to-[#0F172A] lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12">
        <div className="absolute -left-24 -top-24 h-[30rem] w-[30rem] rounded-full bg-[#6366F1] opacity-50 blur-[110px] [animation:aurora_14s_ease-in-out_infinite]" aria-hidden />
        <div className="absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#06B6D4] opacity-30 blur-[120px] [animation:aurora_18s_ease-in-out_infinite_reverse]" aria-hidden />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" aria-hidden />
        <div className="relative"><SignInHero /></div>
        <ul className="relative grid w-full max-w-md grid-cols-3 gap-4 text-center text-xs text-white/70">
          {[[Mic, "Records and transcribes"], [Sparkles, "Summaries and action items"], [Search, "Search everything said"]].map(([I, text]) => (
            <li key={text as string} className="flex flex-col items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white"><I className="h-4 w-4" /></span>{text as string}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
