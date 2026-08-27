import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

/**
 * Shared scaffolding for the design doc §14 "Picker UX contract" popover, used by
 * EntityPicker and DevicePicker. Desktop: Popover. Mobile (<768px, reusing the existing
 * useIsMobile breakpoint from design doc §4): bottom-anchored full-width Dialog.
 */

export const MAX_RECENT_PICKS = 8;
export const MAX_RESULTS = 60;

/** Reads up to `MAX_RECENT_PICKS` recently-picked ids from localStorage, most-recent-first. */
export function readRecentPicks(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Unshifts `id` onto the recent-picks list, dedupes, caps at `MAX_RECENT_PICKS`, and persists it. */
export function pushRecentPick(storageKey: string, id: string): void {
  try {
    const next = [id, ...readRecentPicks(storageKey).filter((existing) => existing !== id)].slice(
      0,
      MAX_RECENT_PICKS
    );
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Ignore storage errors (private browsing, quota, disabled storage, etc.)
  }
}

interface PickerPopoverShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  /** Accessible title for the mobile Dialog (visually hidden; the search input is the visible label). */
  title: string;
  children: ReactNode;
}

export function PickerPopoverShell({
  open,
  onOpenChange,
  trigger,
  title,
  children,
}: PickerPopoverShellProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="top-auto bottom-0 left-0 grid max-h-[80vh] w-full max-w-full translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 rounded-t-flow-card rounded-b-none border-flow-border bg-flow-panel p-0 shadow-flow-modal">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[420px] border-flow-border bg-flow-panel p-0 text-flow-text"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export interface FilterChipOption {
  value: string;
  label: string;
  count: number;
}

interface FilterChipProps {
  label: string;
  options: FilterChipOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Single-select "radio-style" filter pill: outline+label when inactive, filled+value+count+clear when active. */
export function FilterChip({ label, options, value, onChange }: FilterChipProps) {
  const active = options.find((option) => option.value === value);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        active
          ? 'border-flow-accent bg-flow-accent-subtle text-flow-accent'
          : 'border-flow-border text-flow-text-muted'
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={options.length === 0}
            className="inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{active ? `${label}: ${active.label}` : label}</span>
            {active && <span className="font-mono">{`(${active.count})`}</span>}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          <DropdownMenuRadioGroup value={value ?? ''} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
                <span className="ml-auto pl-2 font-mono text-flow-text-muted text-xs">
                  {option.count}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {active && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label} filter`}
          className="rounded-full text-flow-text-muted hover:text-flow-danger"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
