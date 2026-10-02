import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
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
  /** A literal list of items, or a template string that produces the list at run time. */
  value: unknown[] | string;
  onChange: (value: unknown[] | string) => void;
}

/** Example shown in the empty template box (code, so it is not translated). */
const TEMPLATE_PLACEHOLDER = "{{ ['light.kitchen', 'light.bedroom'] }}";

/**
 * Editor for `repeat.for_each` (design doc §6): a plain one-item-per-line textarea while every
 * item is a scalar, falling back to a YAML foldout the moment any item is complex (object/array/
 * multi-line string — see hasComplexForEachItems). `sequence` (the loop body) has no canvas
 * representation; it's only reachable via the node's own per-node YAML foldout in PropertyPanel's
 * footer, which dumps the whole `repeat` block, `sequence` included, unchanged.
 */
export function ForEachEditor({ nodeId, value, onChange }: ForEachEditorProps) {
  const { t } = useTranslation(['nodes']);
  const label = t('nodes:actions.forEach.itemsLabel');
  const description = t('nodes:actions.forEach.itemsDescription');

  // A template string stays a string: it is only ever replaced when the user picks "list".
  if (typeof value === 'string') {
    return (
      <div className="flex flex-col gap-1">
        <FormField
          label={t('nodes:actions.forEach.templateLabel')}
          description={t('nodes:actions.forEach.templateDescription')}
        >
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={TEMPLATE_PLACEHOLDER}
            className="font-mono text-sm"
          />
        </FormField>
        <ModeSwitchButton label={t('nodes:actions.forEach.useList')} onClick={() => onChange([])} />
      </div>
    );
  }

  const items = value;

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
    <div className="flex flex-col gap-1">
      <FormField label={label} description={description}>
        <Textarea
          value={forEachItemsToLines(items)}
          onChange={(e) => onChange(linesToForEachItems(e.target.value))}
          placeholder={t('nodes:actions.forEach.itemsPlaceholder')}
          className="font-mono text-sm"
          rows={Math.min(Math.max(items.length, 3), 8)}
        />
      </FormField>
      <ModeSwitchButton
        label={t('nodes:actions.forEach.useTemplate')}
        onClick={() => onChange('')}
      />
    </div>
  );
}

/** Quiet text button that flips the editor between a literal list and a template. */
function ModeSwitchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto self-start px-0 text-flow-text-muted text-xs"
      onClick={onClick}
    >
      {label}
    </Button>
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
