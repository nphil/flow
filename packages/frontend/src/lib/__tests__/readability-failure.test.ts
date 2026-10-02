import type * as Transpiler from '@flow/transpiler';
import type { Node } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import type { FlowNodeData } from '@/store/flow-store';
import { readabilityOf } from '../readability';

vi.mock('@flow/transpiler', async (importOriginal) => ({
  ...(await importOriginal<typeof Transpiler>()),
  lintFlowGraph: () => {
    throw new Error('rule exploded');
  },
}));

describe('readabilityOf when the lint engine throws', () => {
  it('reports no findings instead of breaking the editor', () => {
    const logged = vi.spyOn(logger, 'error').mockReturnValue(undefined);
    const trigger: Node<FlowNodeData> = {
      id: 't1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'state' },
    };
    const report = readabilityOf({
      nodes: [trigger],
      edges: [],
      flowId: '11111111-1111-4111-8111-111111111111',
      flowName: 'Test',
      flowDescription: '',
      flowMetadata: { mode: 'single' },
      userVariables: undefined,
      userTriggerVariables: undefined,
    });

    expect(report.findings).toEqual([]);
    expect(report.nodeCount).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
