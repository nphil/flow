import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useHass } from '../contexts/HassContext';
import { useMediaQuery } from './useMediaQuery';

/**
 * Flow's six shipped static palettes (packages/frontend/src/theme/tokens.css defines a
 * `html[data-theme="<palette>-light"]` / `-dark` block for each). 'ha' is a seventh,
 * runtime-derived "chameleon" choice -- see applyHaTheme below.
 */
export type StaticPalette = 'catppuccin' | 'nord' | 'tokyo' | 'gruvbox' | 'rosepine' | 'everforest';
export type PaletteChoice = StaticPalette | 'ha';
export type ThemeMode = 'light' | 'dark';

export const STATIC_PALETTES: readonly StaticPalette[] = [
  'catppuccin',
  'nord',
  'tokyo',
  'gruvbox',
  'rosepine',
  'everforest',
];

export const PALETTE_LABELS: Record<PaletteChoice, string> = {
  catppuccin: 'Catppuccin',
  nord: 'Nord',
  tokyo: 'Tokyo Night',
  gruvbox: 'Gruvbox',
  rosepine: 'Rosé Pine',
  everforest: 'Everforest',
  ha: 'Home Assistant',
};

const STORAGE_KEY = 'flow.theme';
const DEFAULT_PALETTE: StaticPalette = 'catppuccin';

function isStaticPalette(value: string): value is StaticPalette {
  return (STATIC_PALETTES as readonly string[]).includes(value);
}

/**
 * The exact catppuccin-light/-dark token blocks from tokens.css, duplicated here in JS.
 * Two jobs:
 *  1. 'ha' mode's "closest static palette" fallback for every token design doc §11's HA
 *     mapping table does not cover (node-kind colors, --on-accent) -- Node-kind colors stay
 *     Flow's own per the spec, they never come from the parent HA theme.
 *  2. The fallback for any single HA custom property that cannot be read (missing var,
 *     cross-origin parent in standalone/remote mode, etc.), applied per-token rather than
 *     aborting 'ha' mode entirely.
 */
const CATPPUCCIN_FALLBACK: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--bg': '#EFF1F5',
    '--bg-panel': '#E6E9EF',
    '--bg-elevated': '#DCE0E8',
    '--border': '#BCC0CC',
    '--text': '#4C4F69',
    '--text-secondary': '#5C5F77',
    '--text-muted': '#6C6F85',
    '--accent': '#8839EF',
    '--accent-hover': '#7526DC',
    '--on-accent': '#FFFFFF',
    '--danger': '#D20F39',
    '--ok': '#2F7D1E',
    '--warn': '#9C6500',
    '--node-trigger': '#DF8E1D',
    '--node-condition': '#1E66F5',
    '--node-action': '#40A02F',
    '--node-timing': '#7287FD',
    '--node-data': '#179299',
    '--node-flowctl': '#EA76CB',
    '--node-unknown': '#6C6F85',
  },
  dark: {
    '--bg': '#1E1E2E',
    '--bg-panel': '#272739',
    '--bg-elevated': '#313244',
    '--border': '#3B3D52',
    '--text': '#CDD6F4',
    '--text-secondary': '#A6ADC8',
    '--text-muted': '#9399B2',
    '--accent': '#CBA6F7',
    '--accent-hover': '#DDC2FF',
    '--on-accent': '#1E1E2E',
    '--danger': '#F38BA8',
    '--ok': '#A6E3A1',
    '--warn': '#F9E2AF',
    '--node-trigger': '#F9E2AF',
    '--node-condition': '#89B4FA',
    '--node-action': '#A6E3A1',
    '--node-timing': '#B4BEFE',
    '--node-data': '#94E2D5',
    '--node-flowctl': '#F5C2E7',
    '--node-unknown': '#9399B2',
  },
};

const INLINE_TOKEN_NAMES = Object.keys(CATPPUCCIN_FALLBACK.light);

/**
 * design doc §11: the "Home Assistant" chameleon palette maps these parent-frontend custom
 * properties onto Flow's own semantic tokens. Everything not listed here (node-kind colors,
 * --on-accent, shadows/radii/motion/fonts) keeps using the closest static palette by mode.
 */
const HA_VAR_MAP: Record<string, string> = {
  '--bg': '--primary-background-color',
  '--bg-panel': '--card-background-color',
  '--text': '--primary-text-color',
  '--text-secondary': '--secondary-text-color',
  '--accent': '--primary-color',
  '--border': '--divider-color',
  '--danger': '--error-color',
  '--warn': '--warning-color',
  '--ok': '--success-color',
};

/** Reads a CSS custom property off the parent HA frontend's <html> (we run in an iframe). */
function readParentCustomProperty(name: string): string {
  try {
    const parentDocument = window.parent && window.parent !== window ? window.parent.document : document;
    return getComputedStyle(parentDocument.documentElement).getPropertyValue(name).trim();
  } catch {
    // Cross-origin parent, or no parent at all (standalone/remote mode) -- caller falls back.
    return '';
  }
}

function applyHaTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const fallback = CATPPUCCIN_FALLBACK[mode];
  for (const [token, value] of Object.entries(fallback)) {
    root.style.setProperty(token, value);
  }
  for (const [flowToken, haVar] of Object.entries(HA_VAR_MAP)) {
    const value = readParentCustomProperty(haVar);
    if (value) root.style.setProperty(flowToken, value);
    // else: the catppuccin fallback set above for this token stands.
  }
}

function clearInlineOverrides(root: HTMLElement) {
  for (const token of INLINE_TOKEN_NAMES) root.style.removeProperty(token);
}

interface ParsedChoice {
  palette: PaletteChoice;
  explicitMode: ThemeMode | null;
}

/** `'catppuccin'` (auto) | `'nord-dark'` (explicit) | `'ha'` (chameleon, always auto). */
function parseStoredChoice(raw: string): ParsedChoice {
  if (raw === 'ha') return { palette: 'ha', explicitMode: null };
  const dash = raw.lastIndexOf('-');
  if (dash > 0) {
    const maybePalette = raw.slice(0, dash);
    const maybeMode = raw.slice(dash + 1);
    if (isStaticPalette(maybePalette) && (maybeMode === 'light' || maybeMode === 'dark')) {
      return { palette: maybePalette, explicitMode: maybeMode };
    }
  }
  if (isStaticPalette(raw)) return { palette: raw, explicitMode: null };
  return { palette: DEFAULT_PALETTE, explicitMode: null };
}

type Listener = () => void;
const listeners = new Set<Listener>();

function readStoredChoice(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

function writeStoredChoice(value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage unavailable (private browsing, quota) -- theme just won't persist.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export interface UseFlowThemeResult {
  /** Raw stored preference, e.g. `'catppuccin'`, `'nord-dark'`, `'ha'`. */
  choice: string;
  /** Resolved palette family actually applied to `<html data-theme>`. */
  palette: PaletteChoice;
  /** Resolved light/dark mode actually applied. */
  mode: ThemeMode;
  /** Persist a new preference: a bare palette (auto), `'palette-mode'` (explicit), or `'ha'`. */
  setTheme: (choice: PaletteChoice | `${StaticPalette}-${ThemeMode}`) => void;
}

/**
 * Applies Flow's theme to `<html>` and keeps it persisted+in sync.
 *
 * Storage: localStorage key `flow.theme`. A bare palette name auto-follows Home Assistant's
 * dark mode (`hass.themes.darkMode`); an explicit `'<palette>-<light|dark>'` pins the mode.
 * `'ha'` is the chameleon palette (design doc §11): it derives Flow's core tokens from the
 * parent Home Assistant theme's own CSS custom properties at runtime instead of a static
 * tokens.css block, and re-derives whenever `hass.themes` changes.
 */
export function useFlowTheme(): UseFlowThemeResult {
  const { hass, isRemote } = useHass();
  const choice = useSyncExternalStore(subscribe, readStoredChoice, () => DEFAULT_PALETTE);
  const { palette, explicitMode } = useMemo(() => parseStoredChoice(choice), [choice]);
  // Design doc §12: standalone mode has no parent HA theme to read darkMode from (the
  // synthetic remote `hass` object hardcodes `themes.darkMode: false`) -- fall back to the
  // OS preference instead so "auto" still actually means something outside the HA iframe.
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const hassDarkMode = isRemote ? systemPrefersDark : (hass?.themes?.darkMode ?? false);
  const mode: ThemeMode = explicitMode ?? (hassDarkMode ? 'dark' : 'light');

  // useLayoutEffect (not useEffect): apply before paint so switching themes never flashes
  // the previous one.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (palette === 'ha') {
      root.dataset.theme = 'ha';
      applyHaTheme(mode);
    } else {
      clearInlineOverrides(root);
      root.dataset.theme = `${palette}-${mode}`;
    }
    // `hass.themes` is a new object reference on every Home Assistant theme push -- exactly
    // the "re-derive on hass theme change" trigger design doc §11 asks for.
  }, [palette, mode, hass?.themes]);

  const setTheme = useCallback((next: PaletteChoice | `${StaticPalette}-${ThemeMode}`) => {
    writeStoredChoice(next);
  }, []);

  return { choice, palette, mode, setTheme };
}
