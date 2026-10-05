import * as F from "./fakes";
import type { StorageProvider } from "./types";
import { LocalStorage } from "./storage/local";
import { S3Storage } from "./storage/s3";
import { RemoteEmbeddings } from "./llm/remote-embed";
import { GeminiLlm } from "./llm/gemini";
import { LocalEmbeddings, WithEmbedder } from "./llm/local-embed";
import { FallbackLlm } from "./llm/fallback";
import { OpenAiCompatLlm } from "./llm/openai-compat";
import { FallbackStt, WhisperStt } from "./stt/whisper";
import { GeminiStt } from "./stt/gemini";
import { OutboxEmail } from "./email/outbox";
import { ResendEmail } from "./email/resend";
import path from "node:path";
export * from "./types";
export * from "./fakes";

/** Provider selection by env. Anything unset or "fake" resolves to the fixture implementation. */
const pick = (k: string) => process.env[k] ?? "fake";
let _local: LocalEmbeddings | undefined;
const localEmbedder = () => (_local ??= new LocalEmbeddings()); // one instance per process, so the model loads once
const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export function getProviders() {
  const baseLlm = pick("LLM_PROVIDER") === "gemini"
    ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL, fallbackModels: list(process.env.GEMINI_FALLBACK_MODELS), embedModels: list(process.env.GEMINI_EMBED_MODELS) })
    : new F.FakeLlm();
  const groqKey = process.env.GROQ_API_KEY ?? "", groqBase = "https://api.groq.com/openai/v1";
  const geminiStt = pick("STT_PROVIDER") === "gemini"
    ? new GeminiStt({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_STT_MODEL ?? process.env.GEMINI_MODEL, fallbackModels: list(process.env.GEMINI_STT_FALLBACK_MODELS) })
    : new F.FakeStt();
  // STT_FALLBACK_PROVIDER=whisper: when Gemini's daily audio allowance is gone, Whisper (Groq) transcribes instead (no speaker separation).
  const stt = geminiStt instanceof GeminiStt && process.env.STT_FALLBACK_PROVIDER === "whisper" && groqKey
    ? new FallbackStt(geminiStt, new WhisperStt({ apiKey: groqKey, baseUrl: groqBase, model: process.env.GROQ_STT_MODEL ?? "whisper-large-v3" }), (why) => console.warn(`[stt] ${why} Falling back to Whisper (Groq); speakers won't be separated.`))
    : geminiStt;
  // EMBED_PROVIDER: "local" (default for real LLMs: free, no quota, runs on this machine) or "gemini" (hosted, 1000 texts/day free).
  // LLM_FALLBACK_PROVIDER=groq: when Gemini's daily allowance is gone, Groq answers instead (short meetings and Ask; free tier is 8k tokens/min).
  const withBackup = baseLlm instanceof GeminiLlm && process.env.LLM_FALLBACK_PROVIDER === "groq" && groqKey
    ? new FallbackLlm(baseLlm, new OpenAiCompatLlm({ apiKey: groqKey, baseUrl: groqBase, model: process.env.GROQ_LLM_MODEL ?? "qwen/qwen3.8-27b", label: "Groq", maxInputTokens: Number(process.env.GROQ_MAX_INPUT_TOKENS) || 4500 }),
        (what, why) => console.warn(`[llm] ${why} Using Groq for ${what}.`))
    : baseLlm;
  // EMBED_PROVIDER=remote: the worker machine embeds (EMBED_URL + EMBED_TOKEN); for the web app on serverless hosting.
  const embedKind = process.env.EMBED_PROVIDER ?? "local";
  const llm = pick("LLM_PROVIDER") !== "gemini" ? withBackup
    : embedKind === "local" ? new WithEmbedder(withBackup, localEmbedder())
    : embedKind === "remote" ? new WithEmbedder(withBackup, new RemoteEmbeddings({ url: process.env.EMBED_URL ?? "", token: process.env.EMBED_TOKEN ?? "" }))
    : withBackup;
  // STORAGE_PROVIDER=s3: any S3-compatible bucket (Cloudflare R2, MinIO, AWS). Otherwise the local disk.
  const storage: StorageProvider = pick("STORAGE_PROVIDER") === "s3"
    ? new S3Storage({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET ?? "", accessKeyId: process.env.S3_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_SECRET_KEY ?? "", forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false" })
    : new LocalStorage();
  // EMAIL_PROVIDER: "outbox" (default; writes .html files under .data/outbox), "resend", or "fake" (in memory).
  const mail = process.env.EMAIL_PROVIDER || "outbox";
  const email = mail === "resend" ? new ResendEmail({ apiKey: process.env.RESEND_API_KEY ?? "", from: process.env.EMAIL_FROM ?? "" })
    : mail === "fake" ? new F.FakeEmail() : new OutboxEmail(process.env.OUTBOX_DIR ?? path.join(process.cwd().split("/apps/")[0]!, ".data", "outbox"));
  return {
    storage, stt, llm,
    calendar: new F.FakeCalendar(), email,
    selected: { storage: pick("STORAGE_PROVIDER"), stt: pick("STT_PROVIDER"), llm: pick("LLM_PROVIDER") },
  };
}
export { IcsCalendar, parseIcs } from "./calendar/ics";
export { GoogleCalendar, GoogleAuthError, parseGoogleEvents } from "./calendar/google";
export { LocalStorage } from "./storage/local";
export { S3Storage, contentTypeFor } from "./storage/s3";
export { RemoteEmbeddings } from "./llm/remote-embed";
export { GeminiLlm } from "./llm/gemini";
export { normalizeInsights, normalizeSummary, extractJson } from "./llm/normalize";
export { GeminiStt } from "./stt/gemini";
export { normalizeChunk, parseClock } from "./stt/normalize";
export { geminiEmbed, normalize, EMBED_DIMS } from "./llm/embed";
export { fakeEmbedding } from "./fakes";
export { OutboxEmail } from "./email/outbox";
export { ResendEmail } from "./email/resend";
export { MicrosoftCalendar, MicrosoftAuthError, parseGraphEvents } from "./calendar/microsoft";
export { OpenAiCompatLlm } from "./llm/openai-compat";
export { LocalEmbeddings, WithEmbedder } from "./llm/local-embed";
export { FallbackLlm } from "./llm/fallback";
export { WhisperStt, FallbackStt, looksLikeNoise } from "./stt/whisper";
