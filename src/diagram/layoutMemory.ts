import type { LayoutDirection, Position } from '../contracts';

type Positions = Record<string, Position>;
type Layouts = { LR?: Positions; TB?: Positions } | undefined;

export interface LayoutSwitch {
  positions: Positions;
  layoutDir: LayoutDirection;
  /** What to remember for the direction being left (and keep for the other one). */
  layouts: { LR?: Positions; TB?: Positions };
}

const only = (positions: Positions, ids: readonly string[]): Positions => Object.fromEntries(ids.filter((id) => positions[id]).map((id) => [id, positions[id]!]));

/**
 * What happens to positions when the person asks for a direction.
 *  - Same direction as now ("tidy"): compute a fresh arrangement.
 *  - The other direction: remember the arrangement being left, and bring back the one remembered for the new direction, exactly as the
 *    person left it, as long as it still covers every component. Only otherwise is a fresh one computed.
 * Switching LR to TB and back therefore returns to the same picture instead of a recomputed one. Pure.
 */
export function planLayoutSwitch(args: {
  currentDir: LayoutDirection;
  targetDir: LayoutDirection;
  ids: readonly string[];
  current: Positions;
  layouts: Layouts;
  fresh: (dir: LayoutDirection) => Positions;
}): LayoutSwitch {
  const { currentDir, targetDir, ids, current, layouts, fresh } = args;
  if (targetDir === currentDir) return { positions: only(fresh(targetDir), ids), layoutDir: targetDir, layouts: { ...(layouts ?? {}) } };
  const remembered = layouts?.[targetDir];
  const covers = !!remembered && ids.every((id) => remembered[id]);
  return {
    positions: covers ? only(remembered!, ids) : only(fresh(targetDir), ids),
    layoutDir: targetDir,
    layouts: { ...(layouts ?? {}), [currentDir]: only(current, ids) },
  };
}
