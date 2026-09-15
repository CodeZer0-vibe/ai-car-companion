import type { Session } from '@google/genai';

export function closeGeminiSession(session: Session | null): void {
  try { session?.close(); } catch {}
}
