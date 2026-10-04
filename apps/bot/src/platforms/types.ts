export interface SpeakerEvent { name: string; atMs: number }
export interface ChatMessage { from: string; text: string; atMs: number }

/** One implementation per platform (meet, zoom, teams). Recording, sidecar and upload are shared. */
export interface PlatformAdapter {
  join(url: string, displayName: string): Promise<{ admitted: boolean; reason?: string }>;
  postConsent(message: string): Promise<void>;
  watchSpeakers(cb: (e: SpeakerEvent) => void): void;
  watchChat(cb: (m: ChatMessage) => void): void;
  detectEnd(): Promise<"ended" | "removed" | "alone">;
}
