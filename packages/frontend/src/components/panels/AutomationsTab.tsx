import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  CircleSlash,
  Layers,
  ListOrdered,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useHass } from '@/contexts/HassContext';
import {
  type AutomationFilterChip,
  filterAutomationCatalogItemsByChip,
  planAutomationOpen,
  setAutomationEnabled,
  useAutomationCatalog,
} from '@/hooks/useAutomationCatalog';
import type { DirtyGuard } from '@/hooks/useDirtyGuard';
import { useFuzzySearch } from '@/hooks/useFuzzySearch';
import { useNow } from '@/hooks/useNow';
import { useScrollFade } from '@/hooks/useScrollFade';
import type { AutomationCatalogItem } from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

interface AutomationsTabProps {
  className?: string;
  dirtyGuard: DirtyGuard;
}

const MODE_ICONS: Record<string, LucideIcon> = {
  single: CircleSlash,
  restart: RotateCcw,
  queued: ListOrdered,
  parallel: Layers,
};

const CHIPS: AutomationFilterChip[] = ['all', 'enabled', 'disabled', 'recent'];

/** Reuses the existing shared relative-time keys (dialogs:import.*) rather than duplicating
 * near-identical strings under a new namespace -- also used by DebugTab's trace timestamps. */
function formatRelativeTime(
  iso: string,
  now: number,
  t: TFunction<['panels', 'common', 'dialogs']>
): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('dialogs:import.justNow');
  if (diffMins < 60) return t('dialogs:import.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('dialogs:import.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('dialogs:import.daysAgo', { count: diffDays });
  return new Date(iso).toLocaleDateString();
}

/**
 * Right panel → Automations (design doc §4): THE new primary workflow. A live, searchable,
 * filterable list of every HA automation, backed entirely by data HassContext already pushes
 * reactively (no polling here -- see useAutomationCatalog).
 */
export function AutomationsTab({ className, dirtyGuard }: AutomationsTabProps) {
  const { t } = useTranslation(['panels', 'common', 'dialogs']);
  const { hass, config: hassConfig, entities, isRemote, connectionError } = useHass();
  const [chip, setChip] = useState<AutomationFilterChip>('all');
  const now = useNow();
  const { ref: chipRowRef, isOverflowing: chipsOverflowing } = useScrollFade<HTMLDivElement>();

  // Design doc §5 "scrollable filter-chip row": keep the active chip in view -- mirrors
  // RightPanel.tsx's tab strip treatment. `chip` is the intentional re-run trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    chipRowRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [chip, chipRowRef]);

  const {
    catalogItems,
    areaIdToName,
    isLoading: registriesLoading,
  } = useAutomationCatalog({
    hass,
    hassConfig,
    entities,
  });

  const chipFiltered = useMemo(
    () => filterAutomationCatalogItemsByChip(catalogItems, chip, now),
    [catalogItems, chip, now]
  );

  const { query, setQuery, filteredItems } = useFuzzySearch(chipFiltered, {
    keys: ['friendly_name', 'entity_id', 'description', 'tags'],
    threshold: 0.4,
  });

  const automationId = useFlowStore((s) => s.automationId);
  const reset = useFlowStore((s) => s.reset);
  const setFlowName = useFlowStore((s) => s.setFlowName);
  const openAutomationById = useFlowStore((s) => s.openAutomationById);

  const counts = useMemo(
    () => ({
      all: catalogItems.length,
      enabled: catalogItems.filter((item) => item.enabled).length,
      disabled: catalogItems.filter((item) => !item.enabled).length,
      recent: filterAutomationCatalogItemsByChip(catalogItems, 'recent', now).length,
    }),
    [catalogItems, now]
  );

  const handleToggle = async (item: AutomationCatalogItem, enabled: boolean) => {
    if (!hass) return;
    try {
      await setAutomationEnabled(getHomeAssistantAPI(hass, hassConfig), item, enabled);
    } catch (error) {
      toast.error(
        t('panels:automationsTab.toggleFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  const handleRowClick = (item: AutomationCatalogItem) => {
    const plan = planAutomationOpen(item.automation_id, dirtyGuard.isDirty);
    const open = () => {
      openAutomationById(plan.automationId).catch((error: unknown) => {
        toast.error(
          t('panels:automationsTab.openFailed', {
            message: error instanceof Error ? error.message : String(error),
          })
        );
      });
    };
    if (plan.action === 'open') {
      open();
    } else {
      dirtyGuard.requestConfirm(open);
    }
  };

  const handleNewAutomation = () => {
    dirtyGuard.guard(() => {
      reset();
      setFlowName(t('common:defaults.newAutomation'));
    });
  };

  const showConnectionError = isRemote && !!connectionError;
  const showLoading = !showConnectionError && (!hass || registriesLoading);
  const showEmpty = !showConnectionError && !showLoading && catalogItems.length === 0;
  const showNoResults =
    !showConnectionError && !showLoading && !showEmpty && filteredItems.length === 0;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex flex-col gap-2 border-flow-border border-b p-2">
        <button
          type="button"
          onClick={handleNewAutomation}
          className="ui-focus-ring flex items-center justify-center gap-2 rounded-flow-control bg-flow-accent px-3 py-2 font-mono text-flow-on-accent text-xs transition-colors duration-flow-fast hover:bg-flow-accent-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('panels:automationsTab.newAutomation')}
        </button>

        <div className="relative">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-flow-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('panels:automationsTab.searchPlaceholder')}
            className="ui-focus-ring w-full rounded-flow-control border border-flow-border bg-flow-bg py-1.5 pr-2 pl-7 font-mono text-flow-text text-xs placeholder:text-flow-text-muted focus-visible:border-flow-accent"
          />
        </div>

        <div
          ref={chipRowRef}
          className={cn(
            'flow-scroll-strip flex gap-1 overflow-x-auto',
            chipsOverflowing && 'flow-scroll-fade'
          )}
        >
          {CHIPS.map((chipOption) => (
            <button
              key={chipOption}
              type="button"
              data-state={chip === chipOption ? 'active' : 'inactive'}
              onClick={() => setChip(chipOption)}
              className={cn(
                'ui-focus-ring shrink-0 whitespace-nowrap rounded-flow-control px-1.5 py-1 font-mono text-[11px] transition-colors duration-flow-fast',
                chip === chipOption
                  ? 'bg-flow-accent text-flow-on-accent'
                  : 'bg-flow-elevated text-flow-text-muted hover:text-flow-text'
              )}
            >
              {`${t(`panels:automationsTab.chips.${chipOption}`)} (${counts[chipOption]})`}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showConnectionError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="font-serif text-flow-text text-lg">
              {t('panels:automationsTab.connectionErrorHeadline')}
            </p>
            <p className="font-mono text-flow-text-muted text-xs">{connectionError}</p>
          </div>
        ) : showLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-flow-text-muted" />
          </div>
        ) : showEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="font-serif text-flow-text text-lg">
              {t('panels:automationsTab.emptyHeadline')}
            </p>
            <p className="font-mono text-flow-text-muted text-xs">
              {t('panels:automationsTab.emptyBody')}
            </p>
          </div>
        ) : showNoResults ? (
          <p className="p-6 text-center font-mono text-flow-text-muted text-xs">
            {t('panels:automationsTab.noResults')}
          </p>
        ) : (
          <ul>
            {filteredItems.map((item) => {
              const isActive = automationId === item.automation_id;
              const ModeIcon = (item.mode && MODE_ICONS[item.mode]) || MODE_ICONS.single;
              const areaName = item.area_id ? areaIdToName[item.area_id] : undefined;

              return (
                <li key={item.entity_id}>
                  {/* biome-ignore lint/a11y/useSemanticElements: contains a nested real <button> (the Switch); a <button> wrapper here would be invalid HTML. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleRowClick(item);
                      }
                    }}
                    title={item.friendly_name}
                    className={cn(
                      'ui-focus-ring flex w-full cursor-pointer items-center gap-3 border-flow-border border-b py-2.5 pr-3 pl-3 transition-colors duration-flow-fast',
                      isActive
                        ? 'border-l-2 border-l-flow-accent bg-flow-elevated pl-[10px]'
                        : 'hover:bg-flow-elevated'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-flow-text text-xs">
                          {item.friendly_name}
                        </span>
                        <ModeIcon
                          className="h-3 w-3 shrink-0 text-flow-text-muted"
                          aria-label={item.mode ?? 'single'}
                        />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-flow-text-muted">
                        <span>
                          {item.last_triggered
                            ? formatRelativeTime(item.last_triggered, now, t)
                            : t('dialogs:import.never')}
                        </span>
                        {areaName && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5" />
                            {areaName}
                          </span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={item.enabled}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(checked) => handleToggle(item, checked)}
                      className="shrink-0 data-[state=checked]:bg-flow-accent data-[state=unchecked]:bg-flow-elevated"
                      aria-label={
                        item.enabled
                          ? t('panels:automationsTab.disable')
                          : t('panels:automationsTab.enable')
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
