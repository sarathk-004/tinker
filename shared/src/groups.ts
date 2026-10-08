import { z } from 'zod';

/**
 * Groups are boundaries drawn around components ("Backend", "AWS / eu-west-1"). A group is named by a PATH: "AWS / eu-west-1 / Private
 * network" is the group "Private network" inside "eu-west-1" inside "AWS". A component carries the path of the innermost group it is in
 * (`metadata.group`) and is also in every group above it. Putting a group inside another is renaming its path.
 */
export const GROUP_SEPARATOR = ' / ';
export const MAX_GROUP_DEPTH = 4;
export const MAX_GROUP_SEGMENT = 40;

/** Clean a typed group name into a path: split on "/", trim each part, drop empty parts, collapse spaces, join with " / ". */
export function normalizeGroupPath(input: string): string {
  return input
    .split('/')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(GROUP_SEPARATOR);
}

export const groupSegments = (path: string): string[] => (path ? path.split(GROUP_SEPARATOR) : []);
/** The name shown on the boundary: the last part of the path. */
export const groupLabel = (path: string): string => { const parts = groupSegments(path); return parts[parts.length - 1] ?? ''; };
export const groupParent = (path: string): string => groupSegments(path).slice(0, -1).join(GROUP_SEPARATOR);
export const groupJoin = (...parts: string[]): string => parts.filter(Boolean).join(GROUP_SEPARATOR);

/** Is a component whose innermost group is `memberPath` inside the group `path` (or exactly in it)? */
export const isInGroup = (memberPath: string | undefined, path: string): boolean => !!memberPath && (memberPath === path || memberPath.startsWith(path + GROUP_SEPARATOR));

/** Every group a component belongs to, outermost first: "A / B / C" is in "A", "A / B" and "A / B / C". */
export function groupChain(path: string | undefined): string[] {
  const parts = groupSegments(path ?? '');
  return parts.map((_, i) => parts.slice(0, i + 1).join(GROUP_SEPARATOR));
}

/** Replace the group `from` (and everything inside it) by `to` in one component's path. Untouched when it is not in `from`. */
export function renameInPath(memberPath: string, from: string, to: string): string {
  if (memberPath === from) return to;
  return memberPath.startsWith(from + GROUP_SEPARATOR) ? to + memberPath.slice(from.length) : memberPath;
}

/** A valid group path: at most four levels, each part 1 to 40 characters, already in the normalised form. */
export const groupPathSchema = z
  .string()
  .max(MAX_GROUP_DEPTH * (MAX_GROUP_SEGMENT + GROUP_SEPARATOR.length))
  .refine((p) => p === normalizeGroupPath(p) && p.length > 0, { message: 'group name must be non-empty parts joined by " / "' })
  .refine((p) => groupSegments(p).length <= MAX_GROUP_DEPTH, { message: `groups can be nested at most ${MAX_GROUP_DEPTH} deep` })
  .refine((p) => groupSegments(p).every((s) => s.length <= MAX_GROUP_SEGMENT), { message: `a group name can have at most ${MAX_GROUP_SEGMENT} characters per part` });
