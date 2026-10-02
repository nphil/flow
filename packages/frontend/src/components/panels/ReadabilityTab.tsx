import type { ReadabilityFinding } from '@flow/transpiler';
import { CheckCircle2, ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KIND_TEXT } from '@/components/nodes/nodeVisuals';
import { useDescribeNode } from '@/components/nodes/useNodeDescription';
import { Button } from '@/components/ui/button';
import { type ReadabilityApi, useReadability } from '@/hooks/useReadability';
import { cn } from '@/lib/utils';
import { getNodeKind } from '@/utils/nodeData';

interface ReadabilityTabProps {
  /** Switches the right panel to Properties (where the automation's own settings live). */
  onOpenProperties: () => void;
  className?: string;
}

const CHIP_CLASS =
  'shrink-0 rounded-full border border-flow-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide';

interface FindingRowProps {
  finding: ReadabilityFinding;
  api: ReadabilityApi;
  onOpenProperties: () => void;
}

function FindingRow({ finding, api, onOpenProperties }: FindingRowProps) {
  const { t } = useTranslation(['panels', 'nodes']);
  const describeNode = useDescribeNode();
  const node = finding.nodeId ? api.graph.nodes.find((n) => n.id === finding.nodeId) : undefined;
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const title = node
    ? describeNode(node.type, data).title
    : t('panels:readability.automationLevel');

  const handleOpen = () => {
    if (node) {
      api.focusNode(node.id);
    } else {
      api.deselectAll();
      onOpenProperties();
    }
  };

  return (
    <li className="rounded-flow-card border border-flow-border bg-flow-elevated">
      <button
        type="button"
        className="ui-focus-ring flex w-full flex-col items-start gap-1 rounded-flow-card p-3 text-left transition-colors duration-flow-fast hover:bg-flow-panel"
        title={
          node
            ? t('panels:readability.showOnCanvas', { name: title })
            : t('panels:readability.openProperties')
        }
        onClick={handleOpen}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className={cn(CHIP_CLASS, node ? KIND_TEXT[getNodeKind(node.type, data)] : '')}>
            {node ? t(`nodes:types.${node.type}`) : t('panels:readability.automationLevel')}
          </span>
          {node && (
            <span className="min-w-0 truncate font-medium text-flow-text text-xs">{title}</span>
          )}
        </span>
        <span className="text-flow-text text-sm">{finding.message}</span>
        {finding.detail && <span className="text-flow-text-muted text-xs">{finding.detail}</span>}
      </button>

      {finding.fixes.length > 0 && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {finding.fixes.map((fix) => (
            <div key={fix.label} className="flex flex-col items-start gap-1">
              <Button
                type="button"
                size="sm"
                variant={fix.safe ? 'default' : 'outline'}
                className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
                onClick={() => api.applyFix(fix)}
              >
                {fix.label}
              </Button>
              {fix.note && (
                <p className={cn('text-xs', fix.safe ? 'text-flow-text-muted' : 'text-flow-warn')}>
                  {fix.safe ? fix.note : `${t('panels:readability.unsafeFix')} ${fix.note}`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

interface SectionProps {
  heading: string;
  findings: ReadabilityFinding[];
  api: ReadabilityApi;
  onOpenProperties: () => void;
}

function Section({ heading, findings, api, onOpenProperties }: SectionProps) {
  if (findings.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="font-mono text-[11px] text-flow-text-muted uppercase tracking-wide">
        {heading}
      </h4>
      <ul className="space-y-2">
        {findings.map((finding) => (
          <FindingRow
            key={finding.id}
            finding={finding}
            api={api}
            onOpenProperties={onOpenProperties}
          />
        ))}
      </ul>
    </section>
  );
}

interface EmptyStateProps {
  title: string;
  body: string;
  icon: 'ok' | 'idle';
}

function EmptyState({ title, body, icon }: EmptyStateProps) {
  const Icon = icon === 'ok' ? CheckCircle2 : ListChecks;
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon className={cn('h-8 w-8', icon === 'ok' ? 'text-flow-ok' : 'text-flow-text-muted')} />
      <p className="font-medium text-flow-text text-sm">{title}</p>
      <p className="text-flow-text-muted text-xs">{body}</p>
    </div>
  );
}

/**
 * Readability tab: plain-language findings about the open automation ("This trigger has no
 * name", "Starts again when a sensor comes back from unavailable") with one-click fixes.
 */
export function ReadabilityTab({ onOpenProperties, className }: ReadabilityTabProps) {
  const { t } = useTranslation('panels');
  const api = useReadability();
  const { warnings, suggestions, safeFixCount, nodeCount } = api;

  const summary = useMemo(
    () =>
      [
        warnings.length > 0 && t('readability.warningsCount', { count: warnings.length }),
        suggestions.length > 0 && t('readability.suggestionsCount', { count: suggestions.length }),
      ]
        .filter(Boolean)
        .join(' · '),
    [warnings.length, suggestions.length, t]
  );

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-flow-border border-b p-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-flow-text text-sm">{t('readability.title')}</h3>
          {summary && <p className="text-flow-text-muted text-xs">{summary}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={safeFixCount === 0}
          title={t('readability.fixAllSafeHint')}
          onClick={api.fixAllSafe}
        >
          {t('readability.fixAllSafeCount', { count: safeFixCount })}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {nodeCount === 0 && (
          <EmptyState
            icon="idle"
            title={t('readability.emptyCanvasTitle')}
            body={t('readability.emptyCanvasBody')}
          />
        )}
        {nodeCount > 0 && api.findings.length === 0 && (
          <EmptyState
            icon="ok"
            title={t('readability.emptyTitle')}
            body={t('readability.emptyBody')}
          />
        )}
        <Section
          heading={t('readability.worthFixing')}
          findings={warnings}
          api={api}
          onOpenProperties={onOpenProperties}
        />
        <Section
          heading={t('readability.suggestions')}
          findings={suggestions}
          api={api}
          onOpenProperties={onOpenProperties}
        />
      </div>
    </div>
  );
}
