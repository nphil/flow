import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { describeNode, type NodeDescription } from '@/lib/describeNode';

/** Plain-English description of one node in the current UI language (see lib/describeNode.ts). */
export function useNodeDescription(
  type: string | undefined,
  data: Record<string, unknown>
): NodeDescription {
  const { t } = useTranslation('nodes');
  return useMemo(() => describeNode(type, data, t), [type, data, t]);
}

/** Describer for lists of nodes (debug trace, simulator) where a hook per row is not possible. */
export function useDescribeNode(): (
  type: string | undefined,
  data: Record<string, unknown>
) => NodeDescription {
  const { t } = useTranslation('nodes');
  return useCallback((type, data) => describeNode(type, data, t), [t]);
}
