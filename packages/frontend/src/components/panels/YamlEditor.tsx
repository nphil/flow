import { transpiler } from '@flow/transpiler';
import CodeEditor from '@uiw/react-textarea-code-editor';

import { useEffect } from 'react';
import { useFlowTheme } from '@/hooks/useFlowTheme';
import { useFlowStore } from '@/store/flow-store';

interface YamlEditorProps {
  yaml: string;
  errors: string[];
  warnings: string[];
  onYamlChange?: (yaml: string) => void;
}

export function YamlEditor({ yaml, errors, warnings, onYamlChange }: YamlEditorProps) {
  const fromFlowGraph = useFlowStore((s) => s.fromFlowGraph);
  const setTracePathMap = useFlowStore((s) => s.setTracePathMap);
  const { mode } = useFlowTheme();

  // Keep editor in sync with external YAML (canvas → YAML)
  useEffect(() => {
    // noop: kept to mirror previous lifecycle hook (no deps needed)
  }, []);

  // Handle YAML changes (YAML → canvas)
  const handleChange = async (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = ev.target.value;
    if (onYamlChange) onYamlChange(value);
    try {
      const importResult = await transpiler.fromYaml(value);
      if (!importResult.success || !importResult.graph) {
        // No direct error display here; let parent handle errors
        return;
      }
      fromFlowGraph(importResult.graph);
      setTracePathMap(importResult.nodePathMap ?? null);
    } catch {
      // Ignore, let parent handle errors
    }
  };

  return (
    <div className="flex h-full flex-col">
      <CodeEditor
        value={yaml}
        language="yaml"
        placeholder="Enter YAML..."
        onChange={handleChange}
        data-color-mode={mode}
        padding={12}
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, SF Mono, Consolas, Liberation Mono, Menlo, monospace',
          fontSize: 13,
          height: '100%',
          resize: 'none',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
        }}
      />

      {errors && errors.length > 0 && (
        <div className="border-[var(--danger)] border-t bg-flow-panel px-3 py-2 font-mono text-[var(--danger)] text-xs">
          {errors.join('\n')}
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="border-[var(--warn)] border-t bg-flow-panel px-3 py-2 font-mono text-[var(--warn)] text-xs">
          {warnings.join('\n')}
        </div>
      )}
    </div>
  );
}
