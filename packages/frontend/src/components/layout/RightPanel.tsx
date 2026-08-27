import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutomationsTab } from '@/components/panels/AutomationsTab';
import { PropertyPanel } from '@/components/panels/PropertyPanel';
import { YamlPreview } from '@/components/panels/YamlPreview';
import { DebugTab } from '@/components/simulator/DebugTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DirtyGuard } from '@/hooks/useDirtyGuard';

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

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as RightPanelTab)}
      className={className ? `flex min-h-0 flex-col ${className}` : 'flex min-h-0 flex-1 flex-col'}
    >
      <TabsList className="h-auto justify-start gap-4 rounded-none border-flow-border border-b bg-transparent px-3 py-0">
        <TabsTrigger
          value="automations"
          className="rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.automations')}
        </TabsTrigger>
        <TabsTrigger
          value="properties"
          className="rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.properties')}
        </TabsTrigger>
        <TabsTrigger
          value="yaml"
          className="rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.yaml')}
        </TabsTrigger>
        <TabsTrigger
          value="debug"
          className="rounded-none border-transparent border-b-2 bg-transparent px-0.5 py-2.5 font-mono text-flow-text-muted text-xs shadow-none data-[state=active]:border-flow-accent data-[state=active]:bg-transparent data-[state=active]:text-flow-text data-[state=active]:shadow-none"
        >
          {t('labels.debug')}
        </TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-hidden">
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
