import { getCurrentUser } from "@/lib/session";
import { Progress } from "../progress";
import { chooseAccountAction } from "../actions";

export const dynamic = "force-dynamic";
export default async function AccountStep() {
  const user = await getCurrentUser();
  return (
    <div className="w-full max-w-3xl text-center">
      <Progress step="account" />
      <h1 className="text-2xl font-semibold">Are your meetings on a company calendar?</h1>
      <p className="mt-2 text-muted"><span className="text-text">{user.email}</span> looks like a personal email.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <form action={chooseAccountAction} className="flex flex-col rounded-xl border border-border bg-surface p-6 text-left">
          <input type="hidden" name="type" value="personal" />
          <h2 className="text-lg font-medium">Just me</h2>
          <p className="text-sm text-muted">Good for one-off calls.</p>
          <ul className="my-4 flex-1 space-y-1 text-sm text-muted">
            <li>· See only your own meetings</li><li>· No shared workspace</li><li>· Can&apos;t be converted to a team later</li>
          </ul>
          <button className="rounded border border-border px-4 py-2 text-sm">Continue with personal email</button>
        </form>
        <form action={chooseAccountAction} className="flex flex-col rounded-xl border border-accent bg-surface p-6 text-left">
          <input type="hidden" name="type" value="team" />
          <h2 className="text-lg font-medium">Me or my team <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">Recommended</span></h2>
          <p className="text-sm text-muted">Everything Milo can do.</p>
          <ul className="my-4 flex-1 space-y-1 text-sm text-muted">
            <li>✓ Personal and team preferences</li><li>✓ Private and shared workspaces</li><li>✓ Add teammates any time</li>
          </ul>
          <button className="rounded bg-accent px-4 py-2 text-sm font-medium text-white">Continue</button>
        </form>
      </div>
    </div>
  );
}
