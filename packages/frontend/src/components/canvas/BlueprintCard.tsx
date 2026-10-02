import type { BlueprintInstance, FlowKind } from '@flow/shared';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';

interface BlueprintCardProps {
  blueprint: BlueprintInstance;
  flowKind: FlowKind;
  /** The id the item is stored under, if it was saved; without one there is nothing to link to. */
  flowId: string | null;
}

function formatInputValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Shown instead of the node canvas for an automation or script made from a blueprint. Home
 * Assistant fills in its triggers and steps from the blueprint's inputs, so there is nothing to
 * edit as nodes here; the card says so in plain words and links to Home Assistant's own editor.
 */
export function BlueprintCard({ blueprint, flowKind, flowId }: BlueprintCardProps) {
  const { t } = useTranslation('common');
  const { config, isRemote } = useHass();
  const inputs = Object.entries(blueprint.use_blueprint.input ?? {});
  // Remote mode talks to the server in the connection settings; embedded, the panel is served from
  // Home Assistant itself.
  const origin = (isRemote ? config.url : window.location.origin)?.replace(/\/+$/, '');

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <section className="pointer-events-auto flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-flow-card border border-flow-border bg-flow-panel p-4 shadow-flow-pop">
        <h2 className="font-semibold text-base text-flow-text">{t('blueprint.heading')}</h2>

        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] text-flow-text-muted uppercase tracking-wide">
            {t('blueprint.path')}
          </span>
          <span className="break-all font-mono text-flow-text text-xs">
            {blueprint.use_blueprint.path}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-flow-text-muted uppercase tracking-wide">
            {t('blueprint.inputs')}
          </span>
          {inputs.length === 0 ? (
            <span className="font-mono text-flow-text-muted text-xs">
              {t('blueprint.noInputs')}
            </span>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
              {inputs.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-flow-text-muted">{name}</dt>
                  <dd className="break-all text-flow-text">{formatInputValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <p className="text-flow-text-secondary text-sm">{t('blueprint.readOnly')}</p>

        {origin && flowId && (
          <a
            href={`${origin}/config/${flowKind}/edit/${encodeURIComponent(flowId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-focus-ring inline-flex items-center gap-1.5 self-start rounded-flow-control bg-flow-accent px-3 py-1.5 font-mono text-flow-on-accent text-xs transition-colors duration-flow-fast hover:bg-flow-accent-hover"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('blueprint.openInHa')}
          </a>
        )}
      </section>
    </div>
  );
}
