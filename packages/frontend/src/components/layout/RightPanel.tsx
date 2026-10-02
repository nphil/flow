import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowListTab } from '@/components/panels/FlowListTab';
import { PropertyPanel } from '@/components/panels/PropertyPanel';
import { ReadabilityTab } from '@/components/panels/ReadabilityTab';
import { YamlPreview } from '@/components/panels/YamlPreview';
import { DebugTab } from '@/components/simulator/DebugTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DirtyGuard } from '@/hooks/useDirtyGuard';
import { useReadabilityCounts } from '@/hooks/useReadability';
import { useScrollFade } from '@/hooks/useScrollFade';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

type RightPanelTab = 'automations' | 'scripts' | 'properties' | 'yaml' | 'readability' | 'debug';

/** Every tab trigger looks the same: an underlined mono label, accent underline when active. */
const TAB_TRIGGER_CLASS =
  'shrink-0 whitespace-nowrap rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none';

interface RightPanelProps {
  dirtyGuard: DirtyGuard;
  className?: string;
}

/**
 * Right panel tab shell (design doc §4): Automations (default -- the new primary workflow) |
 * Scripts | Properties | YAML | Readability | Debug. Content-only -- callers (desktop: ResizablePanel, mobile:
 * MobileDrawer) own the panel's chrome/positioning.
 */
export function RightPanel({ dirtyGuard, className }: RightPanelProps) {
  const { t } = useTranslation('common');
  const { t: tPanels } = useTranslation('panels');
  const [tab, setTab] = useState<RightPanelTab>('automations');
  const { ref: tabsListRef, isOverflowing: tabsOverflowing } = useScrollFade<HTMLDivElement>();
  const readability = useReadabilityCounts();
  const propertiesContentRef = useRef<HTMLDivElement>(null);
  const propertiesFocusRequest = useFlowStore((s) => s.propertiesFocusRequest);

  // Canvas double-click on a node (store's requestPropertiesFocus): jump to
  // the Properties tab and move focus into the panel. Counter starts at 0
  // every session (not persisted), so nothing fires on plain mounts; a
  // mobile-drawer mount with a pending request > 0 SHOULD fire — the drawer
  // opens because of that same request.
  useEffect(() => {
    if (propertiesFocusRequest === 0) return;
    setTab('properties');
    requestAnimationFrame(() => {
      propertiesContentRef.current?.focus({ preventScroll: true });
    });
  }, [propertiesFocusRequest]);

  // Design doc §5 "scrollable tab strip": keep the active tab in view when it's selected
  // programmatically (e.g. opening a node jumps to Properties) rather than only on click.
  // `tab` is the intentional re-run trigger (the readability count too: its badge widens the
  // active tab); the body reads the DOM, not the values.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab, tabsListRef, readability.total]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as RightPanelTab)}
      className={className ? `flex min-h-0 flex-col ${className}` : 'flex min-h-0 flex-1 flex-col'}
    >
      <TabsList
        ref={tabsListRef}
        className={cn(
          'flow-scroll-strip h-auto justify-start gap-4 overflow-x-auto rounded-none border-flow-border border-b bg-transparent px-3 py-0',
          tabsOverflowing && 'flow-scroll-fade'
        )}
      >
        <TabsTrigger value="automations" className={TAB_TRIGGER_CLASS}>
          {t('labels.automations')}
        </TabsTrigger>
        <TabsTrigger value="scripts" className={TAB_TRIGGER_CLASS}>
          {t('labels.scripts')}
        </TabsTrigger>
        <TabsTrigger value="properties" className={TAB_TRIGGER_CLASS}>
          {t('labels.properties')}
        </TabsTrigger>
        <TabsTrigger value="yaml" className={TAB_TRIGGER_CLASS}>
          {t('labels.yaml')}
        </TabsTrigger>
        <TabsTrigger value="readability" className={cn(TAB_TRIGGER_CLASS, 'gap-1.5')}>
          {t('labels.readability')}
          {readability.total > 0 && (
            <span
              className={cn(
                'rounded-full border px-1.5 font-mono text-[10px] leading-4',
                readability.warnings > 0
                  ? 'border-flow-warn text-flow-warn'
                  : 'border-flow-border text-flow-text-muted'
              )}
              title={tPanels('readability.tabBadge', { count: readability.total })}
            >
              {readability.total}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="debug" className={TAB_TRIGGER_CLASS}>
          {t('labels.debug')}
        </TabsTrigger>
      </TabsList>

      <div className="flow-panel-container min-h-0 flex-1 overflow-hidden">
        <TabsContent value="automations" className="mt-0 h-full">
          <FlowListTab kind="automation" dirtyGuard={dirtyGuard} className="h-full" />
        </TabsContent>
        <TabsContent value="scripts" className="mt-0 h-full">
          <FlowListTab kind="script" dirtyGuard={dirtyGuard} className="h-full" />
        </TabsContent>
        <TabsContent
          ref={propertiesContentRef}
          tabIndex={-1}
          value="properties"
          className="mt-0 h-full overflow-y-auto outline-none"
        >
          <PropertyPanel />
        </TabsContent>
        <TabsContent value="yaml" className="mt-0 h-full">
          <YamlPreview />
        </TabsContent>
        <TabsContent value="readability" className="mt-0 h-full">
          <ReadabilityTab onOpenProperties={() => setTab('properties')} className="h-full" />
        </TabsContent>
        <TabsContent value="debug" className="mt-0 h-full">
          <DebugTab className="h-full" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
