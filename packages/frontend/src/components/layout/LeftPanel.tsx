import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NODE_CATALOG, type NodeCatalogGroup } from '@/components/nodes/catalog';
import { NodePalette } from '@/components/panels/NodePalette';
import { ResizablePanel } from '@/components/ui/resizable-panel';

const COLLAPSE_STORAGE_KEY = 'flow.panel.left.collapsed';
const GROUP_ORDER: NodeCatalogGroup[] = [
  'Triggers',
  'Conditions',
  'Actions',
  'Timing',
  'Data',
  'Flow control',
];

function loadCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Left palette shell (design doc §4): resizable 200–360 (default 248), collapsible to a
 * 48px icon rail. The rail shows one icon per node-kind group; clicking any of them expands
 * the panel back out rather than adding a node directly (a collapsed rail has no room for
 * per-node detail or drag targets).
 */
export function LeftPanel() {
  const { t } = useTranslation('common');
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore -- the collapsed state still applies for this session.
      }
      return next;
    });
  };

  const groupIcons = GROUP_ORDER.map((group) => ({
    group,
    icon: NODE_CATALOG.find((entry) => entry.group === group)?.icon,
  })).filter((entry): entry is { group: NodeCatalogGroup; icon: NonNullable<typeof entry.icon> } =>
    Boolean(entry.icon)
  );

  return (
    <ResizablePanel
      side="left"
      defaultWidth={248}
      minWidth={200}
      maxWidth={360}
      storageKey="flow.panel.left"
      collapsed={collapsed}
      collapsedWidth={48}
      className="border-flow-border border-r bg-flow-panel"
    >
      <div className="flex items-center justify-between border-flow-border border-b p-2">
        {!collapsed && (
          <span className="px-1 font-mono text-flow-text-muted text-xs uppercase tracking-wide">
            {t('labels.nodes')}
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="ui-focus-ring ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-flow-control text-flow-text-muted transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text"
          title={collapsed ? t('titles.expandPalette') : t('titles.collapsePalette')}
          aria-label={collapsed ? t('titles.expandPalette') : t('titles.collapsePalette')}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
          {groupIcons.map(({ group, icon: Icon }) => (
            <button
              key={group}
              type="button"
              onClick={toggleCollapsed}
              title={group}
              aria-label={group}
              className="ui-focus-ring flex h-9 w-9 items-center justify-center rounded-flow-control text-flow-text-muted transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NodePalette />
        </div>
      )}
    </ResizablePanel>
  );
}
