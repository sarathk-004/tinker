import type { AWSServiceIcon, SystemNodeType } from '../types/diagram';
import { CATALOG, CATEGORIES, type Category } from '../catalog/services';
import { scoreText } from './search';

export interface QuickComponent {
  label: string;
  type: SystemNodeType;
  awsIcon: AWSServiceIcon;
  subType?: string;
  category: Category;
  /** What it is for, in everyday words (searched, never shown). */
  keywords: string;
}

export const PALETTE: QuickComponent[] = CATALOG.map((c) => ({ label: c.label, type: c.type, awsIcon: c.id, subType: c.subType, category: c.category, keywords: c.keywords }));

/**
 * Components matching what was typed, best first: a name or service match beats a category match, which beats a match in the plain words
 * for what it does ("monitoring" finds CloudWatch, X-Ray and Grafana; "encrypt" finds KMS). No query: everything, in category order.
 */
export function searchComponents(query: string, items: readonly QuickComponent[] = PALETTE): QuickComponent[] {
  const q = query.trim();
  if (!q) return [...items].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  return items
    .map((c, index) => {
      const name = Math.max(scoreText(c.label, q), scoreText(c.subType ?? '', q));
      const purpose = Math.max(scoreText(c.category, q, false), scoreText(c.keywords, q, false)) * 0.6;
      return { c, index, score: Math.max(name, purpose) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.c);
}

export function groupByCategory(items: readonly QuickComponent[], keepOrder = false): Array<{ category: Category; items: QuickComponent[] }> {
  const categories = keepOrder ? [...new Set(items.map((c) => c.category))] : CATEGORIES.filter((cat) => items.some((c) => c.category === cat));
  return categories.map((category) => ({ category, items: items.filter((c) => c.category === category) }));
}
