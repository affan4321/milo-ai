import { Progress } from "../progress";
import { PreferencesForm } from "./form";

export default function PreferencesStep() {
  return (
    <div className="w-full max-w-4xl">
      <Progress step="preferences" />
      <p className="mb-6 text-center text-xs uppercase tracking-wider text-muted">Set up your preferences</p>
      <PreferencesForm />
    </div>
  );
}
