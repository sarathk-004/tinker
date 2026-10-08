// From Dither Kit (https://tripwire.sh/dither-kit, MIT), added with `dither-kit add gradient`. Kept as published.
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** Tailwind-aware className combiner â€” local copy so the chart pack is
 * self-contained and portable as a registry. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
