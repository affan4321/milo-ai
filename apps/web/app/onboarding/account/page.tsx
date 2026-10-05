import { Check, Minus, User, Users } from "lucide-react";
import { Badge, IconTile } from "@/components/ui";
import { getCurrentUser } from "@/lib/session";
import { Progress } from "../progress";
import { chooseAccountAction } from "../actions";

export const dynamic = "force-dynamic";
export default async function AccountStep() {
  const user = await getCurrentUser();
  return (
    <div className="w-full max-w-3xl text-center">
      <Progress step="account" />
      <h1 className="text-2xl font-semibold sm:text-3xl tracking-tight text-balance">Are your meetings on a company calendar?</h1>
      <p className="mt-3 text-muted"><span className="font-medium text-text">{user.email}</span> looks like a personal email.</p>
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <form action={chooseAccountAction} className="card flex flex-col p-6 text-left">
          <input type="hidden" name="type" value="personal" />
          <IconTile icon={User} />
          <h2 className="mt-4 text-lg font-semibold tracking-tight">Just me</h2>
          <p className="text-sm text-muted">Good for one-off calls.</p>
          <ul className="my-5 flex-1 space-y-2 text-sm text-muted">
            {["See only your own meetings", "No shared workspace", "Can't be converted to a team later"].map((x) => <li key={x} className="flex gap-2.5"><Minus className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />{x}</li>)}
          </ul>
          <button className="btn btn-secondary btn-lg">Continue with personal email</button>
        </form>
        <form action={chooseAccountAction} className="card relative flex flex-col border-accent p-6 text-left shadow-pop ring-4 ring-accent/10">
          <input type="hidden" name="type" value="team" />
          <span className="absolute right-5 top-5"><Badge tone="accent">Recommended</Badge></span>
          <IconTile icon={Users} tone="accent" />
          <h2 className="mt-4 text-lg font-semibold tracking-tight">Me or my team</h2>
          <p className="text-sm text-muted">Everything Milo can do.</p>
          <ul className="my-5 flex-1 space-y-2 text-sm">
            {["Personal and team preferences", "Private and shared workspaces", "Add teammates any time"].map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />{x}</li>)}
          </ul>
          <button className="btn btn-primary btn-lg">Continue</button>
        </form>
      </div>
    </div>
  );
}
