import { Search } from 'lucide-react';
import { type DragEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type NodeCatalogEntry,
  type NodeCatalogGroup,
  NODE_CATALOG,
} from '@/components/nodes/catalog';
import { useFuzzySearch } from '@/hooks/useFuzzySearch';
import { cn, generateNodeId } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

const GROUP_ORDER: NodeCatalogGroup[] = [
  'Triggers',
  'Conditions',
  'Actions',
  'Timing',
  'Data',
  'Flow control',
];

/** Design doc §3: each palette group renders in its own node-kind color. */
const GROUP_TOKEN_CLASS: Record<NodeCatalogGroup, string> = {
  Triggers: 'text-flow-node-trigger',
  Conditions: 'text-flow-node-condition',
  Actions: 'text-flow-node-action',
  Timing: 'text-flow-node-timing',
  Data: 'text-flow-node-data',
  'Flow control': 'text-flow-node-flowctl',
};

/**
 * Left palette (design doc §4): grouped node cards, drag-to-canvas or click-to-add, fuzzy
 * search on top. `NODE_CATALOG` is the single source of truth for what a node type is and
 * what data it starts with -- this component only renders and positions it.
 */
export function NodePalette() {
  const { t } = useTranslation('common');
  const addNode = useFlowStore((s) => s.addNode);
  const nodes = useFlowStore((s) => s.nodes);
  const { query, setQuery, filteredItems } = useFuzzySearch(NODE_CATALOG, {
    keys: ['label', 'group'],
    threshold: 0.4,
  });

  const groupedEntries = useMemo(() => {
    const byGroup: Record<NodeCatalogGroup, NodeCatalogEntry[]> = {
      Triggers: [],
      Conditions: [],
      Actions: [],
      Timing: [],
      Data: [],
      'Flow control': [],
    };
    for (const entry of filteredItems) {
      byGroup[entry.group].push(entry);
    }
    return GROUP_ORDER.filter((group) => byGroup[group].length > 0).map((group) => ({
      group,
      entries: byGroup[group],
    }));
  }, [filteredItems]);

  const handleAddNode = useCallback(
    (entry: NodeCatalogEntry) => {
      // Simple staggered layout so a click-added node never lands on top of an existing one;
      // auto-arrange (header) is the tool for anything more deliberate.
      const baseX = nodes.length * 250 + 250;
      const baseY = 150;

      addNode({
        id: generateNodeId(entry.kind),
        type: entry.kind,
        position: { x: baseX, y: baseY },
        data: { ...entry.defaultData },
      });
    },
    [addNode, nodes.length]
  );

  const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>, entry: NodeCatalogEntry) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({ type: entry.kind, defaultData: entry.defaultData })
    );
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-flow-border border-b p-2">
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-flow-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('placeholders.searchNodes')}
            className="ui-focus-ring w-full rounded-flow-control border border-flow-border bg-flow-bg py-1.5 pr-2 pl-7 font-mono text-flow-text text-xs placeholder:text-flow-text-muted focus-visible:border-flow-accent"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groupedEntries.length === 0 && (
          <p className="p-3 text-center font-mono text-flow-text-muted text-xs">
            {t('placeholders.noNodesFound')}
          </p>
        )}
        {groupedEntries.map(({ group, entries }) => (
          <div key={group} className="mb-3">
            <h3
              className={cn(
                'mb-1.5 px-1 font-mono text-[11px] uppercase tracking-wide',
                GROUP_TOKEN_CLASS[group]
              )}
            >
              {group}
            </h3>
            <div className="space-y-1">
              {entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={`${group}-${entry.label}`}
                    type="button"
                    draggable
                    onDragStart={(event) => handleDragStart(event, entry)}
                    onClick={() => handleAddNode(entry)}
                    className="ui-focus-ring flex w-full cursor-grab items-center gap-2.5 rounded-flow-control border border-flow-border bg-flow-elevated px-2.5 py-2 text-left transition-colors duration-flow-fast hover:border-flow-accent active:cursor-grabbing"
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', GROUP_TOKEN_CLASS[group])} />
                    <span className="font-mono text-flow-text text-xs">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
