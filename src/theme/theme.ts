import { create } from 'zustand';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'tinker_theme';

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** "System" follows the device: dark when the device prefers dark. Pure apart from the preference it is given. */
export const resolveTheme = (choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme => (choice === 'system' ? (systemPrefersDark ? 'dark' : 'light') : choice);

const systemDark = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice(choice: ThemeChoice): void;
}

export const useTheme = create<ThemeState>((set) => {
  const choice = readThemeChoice();
  return {
    choice,
    resolved: resolveTheme(choice, systemDark()),
    setChoice(next) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage unavailable: it applies for this visit only */
      }
      const resolved = resolveTheme(next, systemDark());
      apply(resolved);
      set({ choice: next, resolved });
    },
  };
});

/** Apply the saved choice, and follow the device while the choice is "system". Call once at start. */
export function initTheme(): void {
  const state = useTheme.getState();
  apply(state.resolved);
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const { choice } = useTheme.getState();
      if (choice !== 'system') return;
      const resolved = resolveTheme(choice, systemDark());
      apply(resolved);
      useTheme.setState({ resolved });
    });
  }
}

/** A theme colour as an rgb() string, read from the page (so exports and canvas drawing match what is on screen). */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const triplet = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return triplet ? `rgb(${triplet})` : fallback;
}
