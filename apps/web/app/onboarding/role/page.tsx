import { Progress } from "../progress";
import { saveRoleAction } from "../actions";
import { JOB_FUNCTIONS } from "@/lib/onboarding";

export default function RoleStep() {
  return (
    <div className="w-full max-w-2xl text-center">
      <Progress step="role" />
      <p className="mb-2 text-xs uppercase tracking-wider text-muted">Personalize your account</p>
      <h1 className="text-2xl font-semibold">What best describes your job function?</h1>
      <p className="mt-2 text-sm text-muted">Milo picks your default summary template from this.</p>
      <form action={saveRoleAction} className="mt-8 flex flex-wrap justify-center gap-3">
        {JOB_FUNCTIONS.map((r) => (
          <button key={r} name="role" value={r} className="rounded-lg border border-accent px-5 py-3 text-accent hover:bg-accent hover:text-white">{r}</button>
        ))}
      </form>
    </div>
  );
}
