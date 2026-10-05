import { Progress } from "../progress";
import { saveRoleAction } from "../actions";
import { JOB_FUNCTIONS } from "@/lib/onboarding";

export default function RoleStep() {
  return (
    <div className="w-full max-w-2xl text-center">
      <Progress step="role" />
      <h1 className="text-2xl font-semibold sm:text-3xl tracking-tight text-balance">What best describes your job function?</h1>
      <p className="mt-3 text-muted">Milo picks your default summary template from this.</p>
      <form action={saveRoleAction} className="mt-10 flex flex-wrap justify-center gap-3">
        {JOB_FUNCTIONS.map((r) => (
          <button key={r} name="role" value={r} className="rounded-xl border border-border-strong bg-surface px-5 py-3 font-medium shadow-card transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-white hover:shadow-pop">{r}</button>
        ))}
      </form>
    </div>
  );
}
