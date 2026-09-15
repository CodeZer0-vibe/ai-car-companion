export interface MusicMention {
  track: string;
  artist?: string;
}

function cleanSegment(value: string): string {
  return value
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractMusicMention(text: string): MusicMention | null {
  const src = text.trim();
  if (!src) return null;

  const patterns: RegExp[] = [
    /(?:now\s+playing|playing|listening\s+to)\s+(.+?)\s+by\s+(.+)/i,
    /(?:now\s+playing|playing|listening\s+to)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = src.match(pattern);
    if (!match) continue;

    const track = cleanSegment(match[1] ?? '');
    if (!track) return null;

    const artist = cleanSegment(match[2] ?? '');
    return artist ? { track, artist } : { track };
  }

  return null;
}
