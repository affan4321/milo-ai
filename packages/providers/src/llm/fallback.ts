import { DailyQuotaError, isPermanent } from "@milo/core";
import { GeminiUnavailableError } from "./client";
import type { LlmProvider } from "../types";

/**
 * Use a backup LLM ONLY when the primary's daily allowance is used up or every Gemini model is overloaded. Other failures (a bad request, a hiccup that the queue
 * will retry) are not "out of quota", so they propagate untouched and the backup is never spent on them.
 *
 * A backup with small limits (e.g. a free per-minute token cap) may be unable to take the job at all (a long meeting). Then the
 * ORIGINAL quota error is raised, with a note, instead of a confusing error from the backup.
 */
export class FallbackLlm implements LlmProvider {
  constructor(private primary: LlmProvider, private backup: LlmProvider, private onFallback?: (what: string, why: string) => void) {}
  get embedModel() { return this.primary.embedModel; }
  get embedMetered() { return this.primary.embedMetered; }
  embed: LlmProvider["embed"] = (t, k) => this.primary.embed(t, k);

  private async run<T>(what: string, f: (p: LlmProvider) => Promise<T>): Promise<T> {
    try { return await f(this.primary); }
    catch (e) {
      if (!(e instanceof DailyQuotaError || e instanceof GeminiUnavailableError)) throw e;
      this.onFallback?.(what, e.message);
      try { return await f(this.backup); }
      catch (e2) {
        if (isPermanent(e2) && !(e2 instanceof DailyQuotaError)) {
          const note = `${e.message} The backup provider couldn't take this one either (${(e2 as Error).message.slice(0, 140)})`;
          // Keep the primary's own kind of failure: quota stays a (non-retried) quota error; an overload stays transient so the queue retries it.
          throw e instanceof DailyQuotaError ? new DailyQuotaError(note, e.model, e.retryAfterSec) : new GeminiUnavailableError(note, e.model);
        }
        throw e2;
      }
    }
  }
  insights: LlmProvider["insights"] = (a) => this.run("insights", (p) => p.insights(a));
  summarize: LlmProvider["summarize"] = (a) => this.run("summarize", (p) => p.summarize(a));
  answer: LlmProvider["answer"] = (a) => this.run("answer", (p) => p.answer(a));
}
