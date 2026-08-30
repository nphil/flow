import { useTranslation } from 'react-i18next';
import type { NodeCatalogEntry } from '@/components/nodes/catalog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useFuzzySearch } from '@/hooks/useFuzzySearch';

export interface QuickAddPosition {
  screenX: number;
  screenY: number;
}

interface QuickAddMenuProps {
  /** Screen position to anchor the menu at, or `null` when closed. */
  position: QuickAddPosition | null;
  /** Node-type choices to offer — the caller filters NODE_CATALOG per context. */
  items: NodeCatalogEntry[];
  onSelect: (entry: NodeCatalogEntry) => void;
  onClose: () => void;
}

/**
 * Searchable node-type picker anchored at an arbitrary canvas point via a
 * zero-size `position: fixed` div (there's no trigger element to anchor to).
 * Serves three flows in FlowCanvas.tsx: a connection dropped on empty canvas
 * (`onConnectEnd`), double-click / context-menu add on empty canvas, and the
 * edge "+" insert. Node-type choices come from the same NODE_CATALOG as the
 * left palette, pre-filtered by the caller for what the spot can accept.
 */
export function QuickAddMenu({ position, items, onSelect, onClose }: QuickAddMenuProps) {
  const { t } = useTranslation(['common', 'nodes']);

  const { query, setQuery, filteredItems } = useFuzzySearch<NodeCatalogEntry>(items, {
    keys: ['label'],
    threshold: 0.4,
    ignoreLocation: true,
  });

  return (
    <Popover
      open={position !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {position && (
        <>
          <PopoverAnchor asChild>
            <div
              style={{
                position: 'fixed',
                left: position.screenX,
                top: position.screenY,
                width: 0,
                height: 0,
              }}
            />
          </PopoverAnchor>
          <PopoverContent className="w-64 overflow-hidden rounded-flow-card border border-flow-border bg-flow-panel p-0 shadow-flow-pop">
            <Command shouldFilter={false} className="bg-transparent">
              <CommandInput
                autoFocus
                placeholder={t('nodes:quickAdd.searchPlaceholder')}
                value={query}
                onValueChange={setQuery}
                className="font-mono text-flow-text text-xs"
              />
              <CommandList>
                <CommandEmpty className="py-4 text-center font-mono text-flow-text-muted text-xs">
                  {t('combobox.noOptions')}
                </CommandEmpty>
                <CommandGroup>
                  {filteredItems.map((entry, index) => (
                    <CommandItem
                      key={`${entry.kind}-${entry.group}-${index}`}
                      value={entry.label}
                      onSelect={() => onSelect(entry)}
                      className="gap-2 font-mono text-flow-text text-xs data-[selected=true]:bg-flow-elevated"
                    >
                      <entry.icon className="h-3.5 w-3.5 text-flow-text-secondary" />
                      {entry.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </>
      )}
    </Popover>
  );
}
