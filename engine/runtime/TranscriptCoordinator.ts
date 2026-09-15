import { APP_RUNTIME } from './AppRuntimeConfig';
import { mergeTranscriptChunk, normalizeTranscriptChunk } from './transcript/TranscriptNormalizer';

export type TranscriptSpeaker = 'user' | 'gemini';

interface TranscriptCoordinatorConfig {
  userFlushDelayMs?: number;
  geminiFlushDelayMs?: number;
  onUserFlush: (text: string) => void;
  onGeminiFlush: (text: string) => void;
}

const DEFAULT_USER_FLUSH_DELAY_MS = APP_RUNTIME.transcriptFlushUserMs;
const DEFAULT_GEMINI_FLUSH_DELAY_MS = APP_RUNTIME.transcriptFlushGeminiMs;

export class TranscriptCoordinator {
  private readonly userFlushDelayMs: number;
  private readonly geminiFlushDelayMs: number;
  private readonly onUserFlush: (text: string) => void;
  private readonly onGeminiFlush: (text: string) => void;

  private userBuffer = '';
  private geminiBuffer = '';
  private userTimer: ReturnType<typeof setTimeout> | null = null;
  private geminiTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TranscriptCoordinatorConfig) {
    this.userFlushDelayMs = config.userFlushDelayMs ?? DEFAULT_USER_FLUSH_DELAY_MS;
    this.geminiFlushDelayMs = config.geminiFlushDelayMs ?? DEFAULT_GEMINI_FLUSH_DELAY_MS;
    this.onUserFlush = config.onUserFlush;
    this.onGeminiFlush = config.onGeminiFlush;
  }

  public ingest(speaker: TranscriptSpeaker, text: string) {
    const chunk = normalizeTranscriptChunk(text);
    if (!chunk) return;

    if (speaker === 'user') {
      this.userBuffer = mergeTranscriptChunk(this.userBuffer, chunk);
      if (this.userTimer) clearTimeout(this.userTimer);
      this.userTimer = setTimeout(() => this.flushUser(), this.userFlushDelayMs);
      return;
    }

    this.geminiBuffer = mergeTranscriptChunk(this.geminiBuffer, chunk);
    if (this.geminiTimer) clearTimeout(this.geminiTimer);
    this.geminiTimer = setTimeout(() => this.flushGemini(), this.geminiFlushDelayMs);
  }

  public flushAll() {
    this.clearTimers();
    this.flushUser();
    this.flushGemini();
  }

  public clearTimers() {
    if (this.userTimer) {
      clearTimeout(this.userTimer);
      this.userTimer = null;
    }
    if (this.geminiTimer) {
      clearTimeout(this.geminiTimer);
      this.geminiTimer = null;
    }
  }

  public dispose() {
    this.clearTimers();
    this.userBuffer = '';
    this.geminiBuffer = '';
  }

  private flushUser() {
    const text = this.userBuffer.trim();
    if (!text) return;
    this.userBuffer = '';
    this.onUserFlush(text);
  }

  private flushGemini() {
    const text = this.geminiBuffer.trim();
    if (!text) return;
    this.geminiBuffer = '';
    this.onGeminiFlush(text);
  }
}
