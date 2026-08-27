import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutomationsTab } from '@/components/panels/AutomationsTab';
import { PropertyPanel } from '@/components/panels/PropertyPanel';
import { YamlPreview } from '@/components/panels/YamlPreview';
import { DebugTab } from '@/components/simulator/DebugTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DirtyGuard } from '@/hooks/useDirtyGuard';
import { useScrollFade } from '@/hooks/useScrollFade';
import { cn } from '@/lib/utils';
type RightPanelTab = 'automations' | 'properties' | 'yaml' | 'debug';

interface RightPanelProps {
  dirtyGuard: DirtyGuard;
  className?: string;
}

/**
 * Right panel tab shell (design doc §4): Automations (default -- the new primary workflow) |
 * Properties | YAML | Debug. Content-only -- callers (desktop: ResizablePanel, mobile:
 * MobileDrawer) own the panel's chrome/positioning.
 */
export function RightPanel({ dirtyGuard, className }: RightPanelProps) {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<RightPanelTab>('automations');
  const { ref: tabsListRef, isOverflowing: tabsOverflowing } = useScrollFade<HTMLDivElement>();

  // Design doc §5 "scrollable tab strip": keep the active tab in view when it's selected
  // programmatically (e.g. opening a node jumps to Properties) rather than only on click.
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab, tabsListRef]);

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
        <TabsTrigger
          value="automations"
          className="shrink-0 whitespace-nowrap rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.automations')}
        </TabsTrigger>
        <TabsTrigger
          value="properties"
          className="shrink-0 whitespace-nowrap rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.properties')}
        </TabsTrigger>
        <TabsTrigger
          value="yaml"
          className="shrink-0 whitespace-nowrap rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.yaml')}
        </TabsTrigger>
        <TabsTrigger
          value="debug"
          className="shrink-0 whitespace-nowrap rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.debug')}
        </TabsTrigger>
      </TabsList>

      <div className="flow-panel-container min-h-0 flex-1 overflow-hidden">
        <TabsContent value="automations" className="mt-0 h-full">
          <AutomationsTab dirtyGuard={dirtyGuard} className="h-full" />
        </TabsContent>
        <TabsContent value="properties" className="mt-0 h-full overflow-y-auto">
          <PropertyPanel />
        </TabsContent>
        <TabsContent value="yaml" className="mt-0 h-full">
          <YamlPreview />
        </TabsContent>
        <TabsContent value="debug" className="mt-0 h-full">
          <DebugTab className="h-full" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
