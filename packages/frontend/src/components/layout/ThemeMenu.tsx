import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import {
  PALETTE_LABELS,
  STATIC_PALETTES,
  type StaticPalette,
  useFlowTheme,
} from '@/hooks/useFlowTheme';
import { cn } from '@/lib/utils';

const MODES = ['auto', 'light', 'dark'] as const;

function PaletteRow({
  palette,
  choice,
  onPick,
}: {
  palette: StaticPalette;
  choice: string;
  onPick: (value: string) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center justify-between gap-3 rounded-flow-control px-2 py-1.5">
      <span className="font-mono text-flow-text text-xs">{PALETTE_LABELS[palette]}</span>
      <div className="flex gap-1">
        {MODES.map((mode) => {
          const value = mode === 'auto' ? palette : `${palette}-${mode}`;
          const active = choice === value;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onPick(value)}
              className={cn(
                'ui-focus-ring rounded-flow-control px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors duration-flow-fast',
                active
                  ? 'bg-flow-accent text-flow-on-accent'
                  : 'text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text'
              )}
            >
              {t(`theme.${mode}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Palette × mode picker (design doc §2/§11): header overflow menu → Theme submenu content.
 * 'ha' (design doc §11's chameleon palette) has no explicit light/dark of its own -- it always
 * auto-follows the parent Home Assistant theme -- so it gets one row instead of three buttons.
 * Design doc §12: hidden entirely in standalone mode, where there is no parent HA theme to read.
 */
export function ThemeMenu() {
  const { t } = useTranslation('common');
  const { choice, setTheme } = useFlowTheme();
  const { isRemote } = useHass();

  return (
    <div className="w-60 p-1">
      {STATIC_PALETTES.map((palette) => (
        <PaletteRow
          key={palette}
          palette={palette}
          choice={choice}
          onPick={(value) =>
            setTheme(value as StaticPalette | `${StaticPalette}-${'light' | 'dark'}`)
          }
        />
      ))}
      {!isRemote && (
        <>
          <div className="my-1 h-px bg-flow-border" />
          <button
            type="button"
            onClick={() => setTheme('ha')}
            className={cn(
              'ui-focus-ring flex w-full items-center justify-between rounded-flow-control px-2 py-1.5 font-mono text-xs transition-colors duration-flow-fast',
              choice === 'ha' ? 'text-flow-accent' : 'text-flow-text hover:bg-flow-elevated'
            )}
          >
            {PALETTE_LABELS.ha}
            {choice === 'ha' && <Check className="h-3.5 w-3.5" />}
          </button>
          <p className="px-2 pt-1 pb-0.5 text-[10px] text-flow-text-muted">{t('theme.haHint')}</p>
        </>
      )}
    </div>
  );
}
