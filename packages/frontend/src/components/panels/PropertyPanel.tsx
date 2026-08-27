import type { FlowNode } from '@flow/shared';
import { dump } from 'js-yaml';
import { ChevronDown, ChevronRight, Copy, CopyPlus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getHandledProperties } from '@/config/handledProperties';
import { useHass } from '@/contexts/HassContext';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { cn, generateNodeId } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import type { HassEntity } from '@/types/hass';
import { getNodeKind, type NodeKind } from '@/utils/nodeData';
import { AutomationSettingsPanel } from './AutomationSettingsPanel';
import { NodeFields } from './NodeFields';
import { PropertyEditor } from './PropertyEditor';

/** Kind-colored chip text/background (design doc §3/§6): mirrors the exact recipe canvas nodes
 * use for their own kind-colored icon chip (components/nodes/nodeVisuals.tsx) so a node's
 * PropertyPanel header reads as "the same color" as its canvas card. Kept local rather than
 * imported since nodeVisuals.tsx doesn't export these maps. */
const KIND_TEXT: Record<NodeKind, string> = {
  trigger: 'text-flow-node-trigger',
  condition: 'text-flow-node-condition',
  action: 'text-flow-node-action',
  timing: 'text-flow-node-timing',
  data: 'text-flow-node-data',
  flowctl: 'text-flow-node-flowctl',
  unknown: 'text-flow-node-unknown',
};

const KIND_VAR: Record<NodeKind, string> = {
  trigger: '--node-trigger',
  condition: '--node-condition',
  action: '--node-action',
  timing: '--node-timing',
  data: '--node-data',
  flowctl: '--node-flowctl',
  unknown: '--node-unknown',
};

interface PropertyPanelProps {
  className?: string;
}

/**
 * Node editor (design doc §6): header (kind-colored chip + inline alias edit), the existing
 * type-specific field dispatch, a common section every step type shares (Enabled, Notes), and a
 * footer (Duplicate, Delete, per-node YAML foldout). Falls back to AutomationSettingsPanel when
 * no node is selected.
 */
export function PropertyPanel({ className }: PropertyPanelProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const removeNode = useFlowStore((s) => s.removeNode);
  const setNodes = useFlowStore((s) => s.setNodes);
  const selectNode = useFlowStore((s) => s.selectNode);
  const validateNode = useFlowStore((s) => s.validateNode);
  const { hass, entities } = useHass();

  // Use entities from hass object directly
  const effectiveEntities = useMemo(() => {
    if (hass?.states && Object.keys(hass.states).length > 0) {
      return Object.values(hass.states).map((state: HassEntity) => ({
        entity_id: state.entity_id,
        state: state.state,
        attributes: state.attributes || {},
        last_changed: state.last_changed || '',
        last_updated: state.last_updated || '',
        context: state.context,
      }));
    }
    return entities;
  }, [hass, entities]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  // Get handled properties for this node type - must be before early return
  // For device triggers/conditions, we need to exclude ALL current node properties to prevent duplicates
  // since device field components handle them dynamically based on API metadata
  const handledProperties = useMemo(() => {
    if (!selectedNode) {
      return getHandledProperties('trigger', []);
    }

    const baseHandled = getHandledProperties(selectedNode.type || 'trigger', []);
    const nodeData = selectedNode.data;

    // Check if this is a device-based node (trigger or condition with device_id)
    const triggerType = typeof nodeData.trigger === 'string' ? nodeData.trigger : '';
    const deviceId = typeof nodeData.device_id === 'string' ? nodeData.device_id : '';
    const isDeviceNode = triggerType === 'device' || deviceId;

    // For device nodes, exclude ALL properties to prevent duplicates with API-driven fields
    if (isDeviceNode && (selectedNode.type === 'trigger' || selectedNode.type === 'condition')) {
      const allNodeProperties = Object.keys(nodeData);
      const handledSet = new Set([...baseHandled, ...allNodeProperties]);
      return handledSet;
    }

    return baseHandled;
  }, [selectedNode]);

  // Must be before early return — hooks can't be called conditionally.
  const { getFieldError } = useNodeErrors(selectedNode?.id ?? '');
  const kind: NodeKind = selectedNode
    ? getNodeKind(selectedNode.type, selectedNode.data as Record<string, unknown>)
    : 'unknown';

  if (!selectedNode) {
    return <AutomationSettingsPanel />;
  }

  const handleChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, { [key]: value });
  };

  const handleDeleteProperty = (key: string) => {
    updateNodeData(selectedNode.id, { [key]: undefined });
  };

  const handleDuplicate = () => {
    const newId = generateNodeId(selectedNode.type ?? 'node');
    const duplicate = {
      ...selectedNode,
      id: newId,
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      selected: true,
    };
    setNodes([...nodes.map((n) => ({ ...n, selected: false })), duplicate]);
    selectNode(newId);
    validateNode(newId);
  };

  const handleDelete = () => {
    removeNode(selectedNode.id);
  };

  return (
    <div className={cn('h-full flex-1 space-y-4 overflow-y-auto p-4', className)}>
      {/* Header: kind-colored chip + inline-editable alias */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
              KIND_TEXT[kind]
            )}
            style={{
              backgroundColor: `color-mix(in srgb, var(${KIND_VAR[kind]}) 16%, transparent)`,
            }}
          >
            {selectedNode.type
              ? // @ts-expect-error -- TS cannot infer that type exists here
                t(`nodes:types.${selectedNode.type}`)
              : t('nodes:types.node')}
          </span>
          <span className="min-w-0 truncate font-mono text-[10px] text-flow-text-muted">
            {t('nodes:panel.nodeId', { id: selectedNode.id })}
          </span>
        </div>

        <Input
          type="text"
          value={typeof selectedNode.data.alias === 'string' ? selectedNode.data.alias : ''}
          onChange={(e) => handleChange('alias', e.target.value)}
          placeholder={t('placeholders.optionalDisplayName')}
          className="h-auto border-none bg-transparent px-0 font-medium text-base text-flow-text shadow-none focus-visible:ring-0"
        />

        {/* ID field — triggers only. Home Assistant's action-step schemas
            (service call, delay, wait, set_variables, ...) don't support a
            per-step `id:` at all, only triggers do (for `trigger.id`
            templating and `choose:`/`condition: trigger` routing) — real HA
            rejects it outright ("extra keys not allowed") on any other step
            type, it's not just ignored. */}
        {selectedNode.type === 'trigger' && (
          <div className="flex flex-col gap-1.5">
            <Label className="font-mono text-flow-text-secondary text-xs">{t('labels.id')}</Label>
            <Input
              type="text"
              value={typeof selectedNode.data.id === 'string' ? selectedNode.data.id : ''}
              onChange={(e) => handleChange('id', e.target.value || undefined)}
              placeholder={t('placeholders.optionalUniqueId')}
              className="font-mono"
            />
            <FieldError message={getFieldError('id')} />
          </div>
        )}
      </div>

      <Separator />

      {/* Node-specific fields */}
      <NodeFields
        node={selectedNode as FlowNode}
        onChange={handleChange}
        entities={effectiveEntities}
      />

      {/* Additional properties editor */}
      <PropertyEditor
        node={selectedNode as FlowNode}
        handledProperties={handledProperties}
        onChange={handleChange}
        onDelete={handleDeleteProperty}
      />

      <Separator />

      {/* Common section: every step type shares Enabled + Notes */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="node-enabled" className="font-mono text-flow-text-secondary text-xs">
            {t('labels.enabled')}
          </Label>
          <Switch
            id="node-enabled"
            checked={selectedNode.data.enabled !== false}
            onCheckedChange={(checked) => handleChange('enabled', checked ? undefined : false)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="node-note" className="font-mono text-flow-text-secondary text-xs">
            {t('nodes:panel.notes')}
          </Label>
          <Textarea
            id="node-note"
            value={typeof selectedNode.data.note === 'string' ? selectedNode.data.note : ''}
            onChange={(e) => handleChange('note', e.target.value || undefined)}
            placeholder={t('nodes:panel.notesPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <Separator />

      {/* Footer: duplicate/delete + per-node YAML foldout */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-2">
            <CopyPlus className="h-3.5 w-3.5" />
            {t('toolbar.duplicateNode')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="gap-2 text-flow-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('toolbar.deleteNode')}
          </Button>
        </div>

        <NodeYamlFoldout node={selectedNode as FlowNode} />
      </div>
    </div>
  );
}

/** Read-only YAML view of just this node's data (design doc §6), with a copy-to-clipboard
 * button — the per-node counterpart to the automation-level YamlPreview panel. */
function NodeYamlFoldout({ node }: { node: FlowNode }) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const yamlText = useMemo(() => {
    try {
      return dump(node.data).trimEnd();
    } catch {
      return '';
    }
  }, [node.data]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(yamlText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-1 font-mono text-flow-text-muted text-xs hover:text-flow-text-secondary">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('common:labels.yaml')}
        </CollapsibleTrigger>
        {open && (
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 gap-1 px-2 text-xs">
            <Copy className="h-3 w-3" />
            {copied ? t('common:buttons.copied') : t('common:buttons.copy')}
          </Button>
        )}
      </div>
      <CollapsibleContent className="pt-2">
        <Textarea
          readOnly
          value={yamlText}
          className="font-mono text-xs"
          rows={Math.min(Math.max(yamlText.split('\n').length, 3), 14)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
