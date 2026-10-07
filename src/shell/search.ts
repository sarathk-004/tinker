/** What the command palette (Cmd/Ctrl+K) can find and do. Pure, so the ranking is tested without a browser. */
export type PaletteGroup = 'Diagrams' | 'Components' | 'Workspaces' | 'Actions';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  title: string;
  /** Shown under the title and also searched ("Updated 3 h ago", "PostgreSQL", the shortcut). */
  subtitle?: string;
  /** Extra words that should find this item without being shown. */
  keywords?: string;
  run: () => void;
}

const GROUP_ORDER: PaletteGroup[] = ['Diagrams', 'Components', 'Workspaces', 'Actions'];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 0 = no match. Higher is better: the whole text starts with the query, a word starts with it, it appears inside a word, or its
 * letters appear in order ("pgsql" finds "PostgreSQL"). Every word typed must match something, so "orders db" needs both.
 */
export function scoreText(text: string, query: string, fuzzy = true): number {
  const t = norm(text);
  const q = norm(query);
  if (!q) return 1;
  if (!t) return 0;
  const words = q.split(' ');
  let total = 0;
  for (const w of words) {
    let best = 0;
    if (t === w) best = 100;
    else if (t.startsWith(w)) best = 80;
    else if (t.split(' ').some((x) => x.startsWith(w))) best = 60;
    else if (t.includes(w)) best = 40;
    else if (fuzzy && w.length >= 3 && isSubsequence(w, t)) best = 15;
    if (best === 0) return 0;
    total += best;
  }
  return total / words.length;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i] && ++i === needle.length) return true;
  return false;
}

export function rankItems(items: readonly PaletteItem[], query: string, limit = 24): PaletteItem[] {
  const q = query.trim();
  const scored = items
    .map((item, index) => {
      const title = scoreText(item.title, q);
      // The name matters more than the small print, and only the name may match loosely (letters in order): long text would match anything.
      const rest = Math.max(scoreText(item.subtitle ?? '', q, false), scoreText(item.keywords ?? '', q, false)) * 0.5;
      return { item, index, score: Math.max(title, rest) };
    })
    .filter((x) => x.score > 0);
  // With no query keep the natural order inside each group; with one, best match first (group order breaks ties).
  scored.sort((a, b) => (q ? b.score - a.score : 0) || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.index - b.index);
  return scored.slice(0, limit).map((x) => x.item);
}
