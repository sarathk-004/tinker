import { create } from 'zustand';

export interface ConversationTurn {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant';
  text: string;
  actions?: string[];
  source?: 'gemini' | 'local_fallback';
}

interface ConversationState {
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'id' | 'timestamp'>) => void;
  getHistory: () => ConversationTurn[];
  clear: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  turns: [],

  addTurn: (turn) => {
    const entry: ConversationTurn = {
      ...turn,
      id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    set((state) => ({ turns: [...state.turns, entry] }));
  },

  getHistory: () => get().turns,

  clear: () => set({ turns: [] }),
}));
