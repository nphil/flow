import type { FlowGraph } from '@flow/shared';
import type { ParseResult, TracePathMap } from '@flow/transpiler';
import { transpiler } from '@flow/transpiler';
import { AlertTriangle, Check, Copy, Download, FileCode, FileUp, Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { copyToClipboard } from '@/utils/copy-to-clipboard';

type ImportSource = 'paste' | 'upload';

export interface ImportApplyPayload {
  graph: FlowGraph;
  nodePathMap: TracePathMap | null;
}

interface ImportExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which top-level tab to open on -- design doc §4 header overflow has separate "Import
   * YAML"/"Export YAML" entries that both open this one dialog (design doc §8). */
  initialTab: 'import' | 'export';
  /** Left to the caller so it can route through the shared unsaved-changes guard first. */
  onApply: (mode: 'new' | 'replace', payload: ImportApplyPayload) => void;
}

/**
 * Unified Import/Export dialog (design doc §8), replacing the old AutomationImportDialog's
 * "open from HA" import path and the standalone ImportYamlDialog/YamlPreview export button.
 */
export function ImportExportDialog({
  open,
  onOpenChange,
  initialTab,
  onApply,
}: ImportExportDialogProps) {
  const { t } = useTranslation(['dialogs', 'common', 'errors']);
  const [topTab, setTopTab] = useState<'import' | 'export'>(initialTab);
  const [importSource, setImportSource] = useState<ImportSource>('paste');
  const [yamlText, setYamlText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [copied, setCopied] = useState(false);

  const flowName = useFlowStore((s) => s.flowName);
  const nodes = useFlowStore((s) => s.nodes);
  const toFlowGraph = useFlowStore((s) => s.toFlowGraph);

  useEffect(() => {
    if (!open) return;
    setTopTab(initialTab);
    setImportSource('paste');
    setYamlText('');
    setParseResult(null);
    setParseError(null);
    setCopied(false);
  }, [open, initialTab]);

  useEffect(() => {
    if (!yamlText.trim()) {
      setParseResult(null);
      setParseError(null);
      return;
    }
    let cancelled = false;
    setIsParsing(true);
    transpiler
      .fromYaml(yamlText)
      .then((result) => {
        if (cancelled) return;
        setParseResult(result);
        setParseError(
          result.success ? null : result.errors?.join('\n') || t('errors:import.parseFailed')
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setParseResult(null);
        setParseError(error instanceof Error ? error.message : t('errors:import.parseFailed'));
      })
      .finally(() => {
        if (!cancelled) setIsParsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [yamlText, t]);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    file
      .text()
      .then(setYamlText)
      .catch(() => setParseError(t('errors:import.fileReadFailed')));
  };

  const handleApply = (mode: 'new' | 'replace') => {
    if (!parseResult?.success || !parseResult.graph) return;
    onApply(mode, { graph: parseResult.graph, nodePathMap: parseResult.nodePathMap ?? null });
    onOpenChange(false);
  };

  const exportYaml = useMemo(() => {
    if (topTab !== 'export' || nodes.length === 0) return null;
    try {
      const graph = toFlowGraph();
      const result = transpiler.transpile(graph);
      return result.success ? (result.yaml ?? '') : null;
    } catch {
      return null;
    }
  }, [topTab, nodes, toFlowGraph]);

  const handleCopyExport = async () => {
    if (!exportYaml) return;
    await copyToClipboard(exportYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadExport = () => {
    if (!exportYaml) return;
    const slug =
      (flowName || 'automation')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'automation';
    const blob = new Blob([exportYaml], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}.yaml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const nodeCount = parseResult?.graph?.nodes.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader>
          <DialogTitle className="text-flow-text">{t('dialogs:importExport.title')}</DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {t('dialogs:importExport.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={topTab}
          onValueChange={(value) => setTopTab(value as 'import' | 'export')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-2 rounded-flow-control bg-flow-elevated p-1">
            <TabsTrigger
              value="import"
              className="rounded-flow-control font-mono text-xs data-[state=active]:bg-flow-panel data-[state=active]:text-flow-text data-[state=active]:shadow-flow-card"
            >
              {t('dialogs:importExport.importTab')}
            </TabsTrigger>
            <TabsTrigger
              value="export"
              className="rounded-flow-control font-mono text-xs data-[state=active]:bg-flow-panel data-[state=active]:text-flow-text data-[state=active]:shadow-flow-card"
            >
              {t('dialogs:importExport.exportTab')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex gap-1 rounded-flow-control bg-flow-elevated p-1">
              <button
                type="button"
                onClick={() => setImportSource('paste')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-flow-control px-2 py-1.5 font-mono text-xs transition-colors duration-flow-fast',
                  importSource === 'paste'
                    ? 'bg-flow-panel text-flow-text shadow-flow-card'
                    : 'text-flow-text-muted hover:text-flow-text'
                )}
              >
                <FileCode className="h-3.5 w-3.5" />
                {t('dialogs:importExport.pasteYaml')}
              </button>
              <button
                type="button"
                onClick={() => setImportSource('upload')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-flow-control px-2 py-1.5 font-mono text-xs transition-colors duration-flow-fast',
                  importSource === 'upload'
                    ? 'bg-flow-panel text-flow-text shadow-flow-card'
                    : 'text-flow-text-muted hover:text-flow-text'
                )}
              >
                <FileUp className="h-3.5 w-3.5" />
                {t('dialogs:importExport.uploadYaml')}
              </button>
            </div>

            {importSource === 'paste' ? (
              <Textarea
                value={yamlText}
                onChange={(event) => setYamlText(event.target.value)}
                placeholder={t('dialogs:importExport.pastePlaceholder')}
                className="min-h-[220px] flex-1 resize-none border-flow-border bg-flow-bg font-mono text-flow-text text-xs placeholder:text-flow-text-muted focus-visible:ring-[var(--accent)]"
              />
            ) : (
              <label className="flex min-h-[220px] flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-flow-card border border-flow-border border-dashed text-flow-text-muted transition-colors duration-flow-fast hover:border-flow-accent hover:text-flow-text">
                <Upload className="h-6 w-6" />
                <span className="font-mono text-xs">
                  {yamlText
                    ? t('dialogs:importExport.fileLoaded')
                    : t('dialogs:importExport.uploadPrompt')}
                </span>
                <input
                  type="file"
                  accept=".yaml,.yml"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            )}

            {yamlText.trim() && (
              <div className="rounded-flow-control border border-flow-border bg-flow-bg p-3 font-mono text-xs">
                {isParsing ? (
                  <span className="text-flow-text-muted">{t('dialogs:importExport.parsing')}</span>
                ) : parseError ? (
                  <div className="flex items-start gap-2 text-[var(--danger)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-pre-wrap">{parseError}</span>
                  </div>
                ) : parseResult?.success ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[var(--ok)]">
                      <Check className="h-3.5 w-3.5" />
                      {t('dialogs:importExport.nodeCount', { count: nodeCount })}
                    </div>
                    {parseResult.warnings.length > 0 && (
                      <ul className="list-inside list-disc text-[var(--warn)]">
                        {parseResult.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                disabled={!parseResult?.success}
                onClick={() => handleApply('replace')}
                className="border-flow-border text-flow-text hover:bg-flow-elevated"
              >
                {t('dialogs:importExport.replaceCurrent')}
              </Button>
              <Button
                disabled={!parseResult?.success}
                onClick={() => handleApply('new')}
                className="bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover"
              >
                {t('dialogs:importExport.applyAsNew')}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="export" className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            {exportYaml ? (
              <pre className="min-h-[220px] flex-1 overflow-auto rounded-flow-control border border-flow-border bg-flow-bg p-3 font-mono text-flow-text text-xs">
                {exportYaml}
              </pre>
            ) : (
              <div className="flex min-h-[220px] flex-1 items-center justify-center rounded-flow-control border border-flow-border text-flow-text-muted text-sm">
                {t('dialogs:importExport.nothingToExport')}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={!exportYaml}
                onClick={handleCopyExport}
                className="border-flow-border text-flow-text hover:bg-flow-elevated"
              >
                <Copy className="mr-2 h-4 w-4" />
                {copied ? t('common:buttons.copied') : t('common:buttons.copy')}
              </Button>
              <Button
                disabled={!exportYaml}
                onClick={handleDownloadExport}
                className="bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('dialogs:importExport.download')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
