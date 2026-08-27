import { Clock, GitBranch, Hourglass, type LucideIcon, OctagonX, Play, Variable, Zap } from 'lucide-react';

/**
 * Left-palette groups (design doc §4): "Drag to canvas OR click-to-add".
 * Six groups over seven catalog entries — flow-control actions (Stop) and
 * plain service-call actions share the `action` node kind but sort into
 * different palette groups via their own entry here.
 */
export type NodeCatalogGroup = 'Triggers' | 'Conditions' | 'Actions' | 'Timing' | 'Data' | 'Flow control';

export interface NodeCatalogEntry {
  /** The React Flow node `type` a new node gets when this entry is placed. */
  kind: string;
  group: NodeCatalogGroup;
  label: string;
  icon: LucideIcon;
  defaultData: Record<string, unknown>;
}

/**
 * Single source of truth for every place a node type can be picked: the left
 * palette (drag/click-to-add) and the canvas quick-add menu (lib/quick-add.ts).
 * `kind`+`defaultData` mirror the shapes `FlowCanvas.tsx`'s drop/quick-add
 * handlers already assign directly onto a new node's `type`/`data`.
 */
export const NODE_CATALOG: NodeCatalogEntry[] = [
  {
    kind: 'trigger',
    group: 'Triggers',
    label: 'Trigger',
    icon: Zap,
    defaultData: { trigger: 'state', entity_id: '' },
  },
  {
    kind: 'condition',
    group: 'Conditions',
    label: 'Condition',
    icon: GitBranch,
    defaultData: { condition: 'state', entity_id: '' },
  },
  {
    kind: 'action',
    group: 'Actions',
    label: 'Action',
    icon: Play,
    defaultData: { service: 'light.turn_on' },
  },
  {
    kind: 'action',
    group: 'Flow control',
    label: 'Stop',
    icon: OctagonX,
    // A `stop` action has no outgoing edge (see ActionNode.tsx / quick-add.ts's
    // hasSourceHandle) — it halts the automation rather than continuing.
    defaultData: { alias: 'Stop', stop: '' },
  },
  {
    kind: 'delay',
    group: 'Timing',
    label: 'Delay',
    icon: Clock,
    defaultData: { delay: '00:00:05' },
  },
  {
    kind: 'wait',
    group: 'Timing',
    label: 'Wait for',
    icon: Hourglass,
    defaultData: { wait_template: '', timeout: '00:01:00' },
  },
  {
    kind: 'set_variables',
    group: 'Data',
    label: 'Set Variables',
    icon: Variable,
    defaultData: { variables: {} },
  },
];
