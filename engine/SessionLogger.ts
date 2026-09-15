import * as FileSystem from 'expo-file-system/legacy';

export type LogType = 'ACTION' | 'USER' | 'GEMINI' | 'EMOTION' | 'SYSTEM';

interface LogEntry {
  time: string;
  type: LogType;
  content: string;
}

/**
 * Session Logger — captures all user interactions, speech, and Gemini responses.
 * Every entry is printed to Metro console in real time with timestamps.
 * Full log is written to documentDirectory/session_log.txt at session end.
 */
const MAX_ENTRIES = 500;

export class SessionLogger {
  private entries: LogEntry[] = [];
  private logPath: string;
  private sessionStartTime: string;

  constructor() {
    const now = new Date();
    this.sessionStartTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.logPath = (FileSystem.documentDirectory ?? '') + 'session_log.txt';
  }

  public log(type: LogType, content: string) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry: LogEntry = { time, type, content };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }

    // Live Metro output — easy to read at a glance
    const typeLabel = type.padEnd(7);
    const icon = this.icon(type);
    console.log(`${icon} [${time}] ${typeLabel} | ${content}`);
  }

  /**
   * Print full session summary to Metro console — call this at any time.
   */
  public printSummary() {
    const divider = '─'.repeat(60);
    console.log(`\n${divider}`);
    console.log(`📋 SESSION LOG — started ${this.sessionStartTime}`);
    console.log(divider);
    for (const e of this.entries) {
      const icon = this.icon(e.type);
      console.log(`${icon} [${e.time}] ${e.type.padEnd(7)} | ${e.content}`);
    }
    console.log(`${divider}\n`);
  }

  /**
   * Write full log to file on device. Path is logged to Metro.
   * On iOS dev build: accessible via Xcode > Devices > Download Container.
   */
  public async saveToFile() {
    try {
      const lines = [`=== Dashboard Pet Session Log ===`,
        `Started: ${this.sessionStartTime}`,
        `Entries: ${this.entries.length}`,
        ``,
        ...this.entries.map(e => `[${e.time}] ${e.type.padEnd(7)} | ${e.content}`),
        ``,
        `=== END ===`
      ].join('\n');

      await FileSystem.writeAsStringAsync(this.logPath, lines, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      console.log(`📁 Session log saved: ${this.logPath}`);
    } catch (e) {
      console.warn('SessionLogger: could not save log file', e);
    }
  }

  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  public clear() {
    this.entries = [];
  }

  private icon(type: LogType): string {
    switch (type) {
      case 'ACTION':  return '👆';
      case 'USER':    return '🗣️ ';
      case 'GEMINI':  return '🤖';
      case 'EMOTION': return '😶';
      case 'SYSTEM':  return '⚙️ ';
    }
  }
}
