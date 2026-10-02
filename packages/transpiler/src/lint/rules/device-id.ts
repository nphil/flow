import { NODE_KIND_WORD } from '../nodes';
import type { ReadabilityRule } from '../types';
import { isRecord, isTemplateText, toStringList } from '../values';

const MAX_DEPTH = 10;

/** Device ids written out literally anywhere inside a step (`device_id`, `target.device_id`, ...). */
function literalDeviceIds(value: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  if (Array.isArray(value)) return value.flatMap((item) => literalDeviceIds(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'device_id'
      ? toStringList(child).filter((id) => id.trim() !== '' && !isTemplateText(id))
      : literalDeviceIds(child, depth + 1)
  );
}

/** House rule 2: refer to the entity, not to the device it belongs to. */
export const deviceIdRule: ReadabilityRule = {
  id: 'device-id',
  title: 'Steps that use a device ID',
  check: ({ graph }) =>
    graph.nodes
      .filter((node) => literalDeviceIds(node.data).length > 0)
      .map((node) => ({
        id: `device-id:${node.id}`,
        ruleId: 'device-id',
        severity: 'warning',
        nodeId: node.id,
        message: `This ${NODE_KIND_WORD[node.type]} refers to a device by its ID, which is fragile.`,
        detail:
          'A device ID is a long code that changes if the device is removed and added again, and it does not tell you which device it is. Where you can, use the entity instead (for example a State trigger, or an action that targets the entity).',
        fixes: [],
      })),
};
