import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import {
  forEachItemsToLines,
  forEachItemsToYaml,
  hasComplexForEachItems,
  linesToForEachItems,
  parseForEachYaml,
} from '@/utils/forEachItems';

interface ForEachEditorProps {
  /** Selected node id — used only to key the YAML-mode buffer so it resets per node (see
   * ForEachYamlEditor); ActionFields doesn't remount across same-type node switches. */
  nodeId: string;
  items: unknown[];
  onChange: (items: unknown[]) => void;
}

/**
 * Editor for `repeat.for_each` (design doc §6): a plain one-item-per-line textarea while every
 * item is a scalar, falling back to a YAML foldout the moment any item is complex (object/array/
 * multi-line string — see hasComplexForEachItems). `sequence` (the loop body) has no canvas
 * representation; it's only reachable via the node's own per-node YAML foldout in PropertyPanel's
 * footer, which dumps the whole `repeat` block, `sequence` included, unchanged.
 */
export function ForEachEditor({ nodeId, items, onChange }: ForEachEditorProps) {
  const { t } = useTranslation(['nodes']);
  const label = t('nodes:actions.forEach.itemsLabel');
  const description = t('nodes:actions.forEach.itemsDescription');

  if (hasComplexForEachItems(items)) {
    return (
      <ForEachYamlEditor
        key={nodeId}
        items={items}
        onChange={onChange}
        label={label}
        description={description}
      />
    );
  }

  return (
    <FormField label={label} description={description}>
      <Textarea
        value={forEachItemsToLines(items)}
        onChange={(e) => onChange(linesToForEachItems(e.target.value))}
        placeholder={t('nodes:actions.forEach.itemsPlaceholder')}
        className="font-mono text-sm"
        rows={Math.min(Math.max(items.length, 3), 8)}
      />
    </FormField>
  );
}

function ForEachYamlEditor({
  items,
  onChange,
  label,
  description,
}: {
  items: unknown[];
  onChange: (items: unknown[]) => void;
  label: string;
  description: string;
}) {
  const { t } = useTranslation(['nodes']);
  const [open, setOpen] = useState(true);
  // Local buffer, not derived straight from `items`: while the user is mid-edit with
  // momentarily-invalid YAML, we keep showing exactly what they typed instead of reformatting
  // or reverting it. Keyed by nodeId (see ForEachEditor) so switching nodes gets a fresh buffer.
  const [text, setText] = useState(() => forEachItemsToYaml(items));

  return (
    <FormField label={label} description={description}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 font-mono text-flow-text-muted text-xs hover:text-flow-text-secondary">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('nodes:yamlFoldout.toggle')}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const parsed = parseForEachYaml(e.target.value);
              if (parsed !== null) onChange(parsed);
            }}
            className="font-mono text-xs"
            rows={Math.min(Math.max(items.length * 2, 4), 12)}
          />
        </CollapsibleContent>
      </Collapsible>
    </FormField>
  );
}
