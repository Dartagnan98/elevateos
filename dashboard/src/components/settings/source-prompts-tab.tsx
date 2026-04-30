'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconFolderPlus,
  IconPlugConnected,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  SOURCE_PROMPT_CATEGORIES,
  SOURCE_CONNECTION_BLUEPRINTS,
  SOURCE_SETUP_PROMPTS,
  type SourceConnectionBlueprint,
  type SourcePromptCategory,
  type SourceSetupPrompt,
} from '@/lib/realestate/source-setup-prompts';

const CONNECTOR_STEPS = [
  'Collect customer setup info',
  'Build adapter or import path',
  'Write Elevate source records',
  'Feed dashboard surfaces',
] as const;

type ConnectorState = 'not_configured' | 'connected' | 'import_only' | 'needs_operator' | 'blocked' | 'error';

interface SourceConnectorStatus {
  id: string;
  label: string;
  state: ConnectorState;
  sourceExists: boolean;
  sourceDir: string;
  sourcePath: string;
  statusPath: string;
  artifactsDir: string;
  connectionType: string | null;
  syncMode: string | null;
  authStatus: string | null;
  ownerAgent: string;
  enabledUiSurfaces: string[];
  connected: boolean;
  importOnly: boolean;
  blocked: boolean;
  lastError: string | null;
  nextOperatorStep: string | null;
  lastCheckedAt: string | null;
  recordCounts: Record<string, number>;
}

interface SourceConnectorsResponse {
  org: string;
  toolsRoot: string;
  toolsRootSource: 'config' | 'local-test-root';
  toolsRootIo?: 'local' | 'remote';
  sourceRoot: string;
  connectors: SourceConnectorStatus[];
}

const STATE_LABELS: Record<ConnectorState, string> = {
  not_configured: 'Not configured',
  connected: 'Connected',
  import_only: 'Import only',
  needs_operator: 'Needs setup',
  blocked: 'Blocked',
  error: 'Error',
};

function stateVariant(state: ConnectorState | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'connected') return 'default';
  if (state === 'blocked' || state === 'error') return 'destructive';
  if (state === 'import_only') return 'secondary';
  return 'outline';
}

function recordTotal(connector: SourceConnectorStatus | undefined): number {
  if (!connector) return 0;
  return Object.values(connector.recordCounts).reduce((sum, value) => sum + value, 0);
}

function formatCheckedAt(value: string | null | undefined): string {
  if (!value) return 'Never checked';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Checked recently';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function SourceConnectionItem({
  item,
  connector,
  busy,
  onInitialize,
}: {
  item: SourceConnectionBlueprint;
  connector: SourceConnectorStatus | undefined;
  busy: boolean;
  onInitialize: (sourceId: string) => void;
}) {
  const state = connector?.state ?? 'not_configured';

  return (
    <div className="grid gap-3 rounded-md border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.source}</h3>
            <Badge variant={stateVariant(state)}>{STATE_LABELS[state]}</Badge>
            {recordTotal(connector) > 0 && (
              <Badge variant="outline">{recordTotal(connector)} records</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Blueprint for turning this source into Elevate data and product UI.
          </p>
        </div>
        <IconPlugConnected className="mt-0.5 shrink-0 text-muted-foreground" size={17} />
      </div>
      <dl className="grid gap-3 text-sm">
        <div className="grid gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Need</dt>
          <dd className="leading-relaxed">{item.informationNeeded}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connector</dt>
          <dd className="leading-relaxed">{item.connectionLayer}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UI landing</dt>
          <dd className="leading-relaxed">{item.uiDestination}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Done when</dt>
          <dd className="leading-relaxed text-muted-foreground">{item.successSignal}</dd>
        </div>
      </dl>
      {connector && (
        <div className="grid gap-2 rounded-md bg-muted/35 p-3 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{connector.connectionType ?? 'manual_import'}</Badge>
            <Badge variant="outline">{connector.syncMode ?? 'manual'}</Badge>
            <Badge variant="outline">{connector.ownerAgent}</Badge>
          </div>
          <code className="break-all text-muted-foreground">{connector.sourceDir}</code>
          {connector.nextOperatorStep && (
            <p className="leading-relaxed text-muted-foreground">{connector.nextOperatorStep}</p>
          )}
          {connector.lastError && (
            <p className="flex items-center gap-1 text-destructive">
              <IconAlertTriangle size={14} />
              {connector.lastError}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{formatCheckedAt(connector?.lastCheckedAt)}</span>
        <Button
          type="button"
          size="sm"
          variant={connector?.sourceExists ? 'outline' : 'default'}
          onClick={() => onInitialize(item.id)}
          disabled={busy}
        >
          <IconFolderPlus size={16} />
          {busy ? 'Writing...' : connector?.sourceExists ? 'Update test files' : 'Initialize test files'}
        </Button>
      </div>
    </div>
  );
}

function SourceConnectionPanel({
  data,
  loading,
  error,
  actionId,
  onRefresh,
  onInitialize,
}: {
  data: SourceConnectorsResponse | null;
  loading: boolean;
  error: string;
  actionId: string | null;
  onRefresh: () => void;
  onInitialize: (sourceId: string) => void;
}) {
  const connectorsById = useMemo(() => new Map(
    data?.connectors.map((connector) => [connector.id, connector]) ?? []
  ), [data]);

  return (
    <section className="grid gap-4">
      <div className="grid gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconDatabase size={18} />
          Connection Blueprints
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Use these prompts to build the connector layer between customer tools and ElevateOS. Each source needs setup
          info, an adapter or import path, normalized records, and a clear dashboard landing.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/35 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={data?.toolsRootSource === 'config' ? 'default' : 'secondary'}>
              {data?.toolsRootSource === 'config' ? 'Configured root' : 'Local test root'}
            </Badge>
            {data?.toolsRootIo && (
              <Badge variant="outline">{data.toolsRootIo === 'remote' ? 'Remote SSH' : 'Local files'}</Badge>
            )}
            {loading && <Badge variant="outline">Loading</Badge>}
            {error && <Badge variant="destructive">Load issue</Badge>}
          </div>
          <code className="mt-2 block break-all text-xs text-muted-foreground">
            {data?.sourceRoot ?? 'Connector source root will appear after loading.'}
          </code>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={loading || Boolean(actionId)}>
          <IconRefresh size={16} />
          Refresh status
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-2 rounded-md border bg-muted/35 p-3 sm:grid-cols-4">
        {CONNECTOR_STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-2 rounded-sm bg-background px-3 py-2 text-sm">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold">
              {index + 1}
            </span>
            <span className="leading-snug">{step}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {SOURCE_CONNECTION_BLUEPRINTS.map((item) => (
          <SourceConnectionItem
            key={item.id}
            item={item}
            connector={connectorsById.get(item.id)}
            busy={actionId === item.id}
            onInitialize={onInitialize}
          />
        ))}
      </div>
    </section>
  );
}

function PromptCard({
  prompt,
  copied,
  onCopy,
}: {
  prompt: SourceSetupPrompt;
  copied: boolean;
  onCopy: (prompt: SourceSetupPrompt) => void;
}) {
  return (
    <Card className="rounded-md">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconSparkles size={18} />
              {prompt.title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{prompt.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{prompt.badge}</Badge>
            <Badge variant="secondary">{prompt.owner}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {prompt.requirements.map((item) => (
            <Badge key={item} variant="outline" className="font-normal">
              {item}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          readOnly
          value={prompt.prompt}
          className="min-h-72 resize-y font-mono text-xs leading-relaxed"
          aria-label={`${prompt.title} connection prompt`}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => onCopy(prompt)}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? 'Copied' : 'Copy connection prompt'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SourcePromptsTab() {
  const [active, setActive] = useState<SourcePromptCategory | 'all'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<SourceConnectorsResponse | null>(null);
  const [connectorsLoading, setConnectorsLoading] = useState(true);
  const [connectorsError, setConnectorsError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const prompts = useMemo(() => (
    active === 'all'
      ? SOURCE_SETUP_PROMPTS
      : SOURCE_SETUP_PROMPTS.filter((prompt) => prompt.category === active)
  ), [active]);

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true);
    setConnectorsError('');
    try {
      const res = await fetch('/api/settings/source-connectors');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConnectors(body as SourceConnectorsResponse);
    } catch (err) {
      setConnectorsError(err instanceof Error ? err.message : 'Failed to load source connectors');
    } finally {
      setConnectorsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  async function initializeConnector(sourceId: string) {
    setActionId(sourceId);
    setConnectorsError('');
    try {
      const res = await fetch('/api/settings/source-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scaffold', sourceId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConnectors(body as SourceConnectorsResponse);
    } catch (err) {
      setConnectorsError(err instanceof Error ? err.message : 'Failed to initialize source connector');
    } finally {
      setActionId(null);
    }
  }

  async function copyPrompt(prompt: SourceSetupPrompt) {
    await navigator.clipboard.writeText(prompt.prompt);
    setCopied(prompt.id);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="grid gap-4">
      <SourceConnectionPanel
        data={connectors}
        loading={connectorsLoading}
        error={connectorsError}
        actionId={actionId}
        onRefresh={loadConnectors}
        onInitialize={initializeConnector}
      />

      <Card className="rounded-md">
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Connector Prompts</h2>
              <p className="text-sm text-muted-foreground">
                Copy a one-shot build prompt that tells an AI or local assistant how to connect the source to ElevateOS.
              </p>
            </div>
            <Badge variant="outline">{SOURCE_SETUP_PROMPTS.length} connector packs</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={active} onValueChange={(value) => setActive(value as SourcePromptCategory | 'all')}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {SOURCE_PROMPT_CATEGORIES.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SOURCE_PROMPT_CATEGORIES.map((category) => (
          <TabsContent key={category.id} value={category.id}>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {prompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  copied={copied === prompt.id}
                  onCopy={copyPrompt}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
