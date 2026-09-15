import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEMORY_POLICY } from './MemoryPolicy';
import type { Memory } from './MemoryTypes';

export async function loadMemories(storageKey: string): Promise<Memory[]> {
  try {
    const jsonStr = await AsyncStorage.getItem(storageKey);
    return jsonStr ? (JSON.parse(jsonStr) as Memory[]) : [];
  } catch (e) {
    console.error('MemoryEngine: load failed', e);
    return [];
  }
}

export async function saveMemories(storageKey: string, memories: Memory[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(memories));
  } catch (e) {
    console.error('MemoryEngine: save failed', e);
  }
}

export function enforceMemoryCaps(existing: Memory[], newMemory: Memory): Memory[] {
  const episodic = existing.filter((m) => m.type === 'episodic' || !m.type);
  const semantic = existing.filter((m) => m.type === 'semantic');
  const summaries = existing.filter((m) => m.type === 'summary');

  while (episodic.length >= MEMORY_POLICY.maxEpisodic) episodic.shift();
  while (semantic.length >= MEMORY_POLICY.maxSemantic) semantic.shift();
  while (summaries.length >= MEMORY_POLICY.maxSummary) summaries.shift();

  return [...episodic, ...semantic, ...summaries, newMemory];
}

export function toContextString(memories: Memory[]): string {
  if (memories.length === 0) return '';
  return memories.map((m) => `- ${m.text}`).join('\n');
}
