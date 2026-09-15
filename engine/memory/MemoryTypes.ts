export type MemoryType = 'episodic' | 'semantic' | 'summary';

export interface Memory {
  id: string;
  text: string;
  embedding: number[];
  timestamp: number;
  type: MemoryType;
}

export const MEMORY_STORAGE_KEY = '@dashboard_pet_memories';
