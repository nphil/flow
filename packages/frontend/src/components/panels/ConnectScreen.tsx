import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_INVALID_HTTPS_TO_HTTP,
} from 'home-assistant-js-websocket';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowMark } from '@/components/layout/FlowMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HassConfig } from '@/contexts/HassContext';

interface ConnectScreenProps {
  config: HassConfig;
  /** Surfaced by HassContext when a *previously working* connection drops or an auth retry fails. */
  connectionError: string | null;
  onConnect: (config: HassConfig) => void;
}

type Status = 'idle' | 'testing' | 'error';

/**
 * Design doc §12: standalone web-app mode's boot gate. Shown full-screen whenever the app is
 * running outside the HA panel iframe and isn't connected yet (design doc §12: "no parent
 * hass -> ConnectScreen"). Replaces the old HassSettings modal -- validates BOTH the REST API
 * and the websocket auth handshake before ever handing the credentials to HassContext, so a
 * bad token/URL never reaches the app shell in a half-connected state.
 */
export function ConnectScreen({ config, connectionError, onConnect }: ConnectScreenProps) {
  const { t } = useTranslation(['dialogs', 'common']);
  const [url, setUrl] = useState(config.url);
  const [token, setToken] = useState(config.token);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleConnect = async () => {
    const trimmedUrl = url.trim().replace(/\/$/, '');
    const trimmedToken = token.trim();
    if (!trimmedUrl || !trimmedToken) {
      setStatus('error');
      setErrorMessage(t('dialogs:connect.errors.missingFields'));
      return;
    }

    setStatus('testing');
    setErrorMessage('');

    try {
      const response = await fetch(`${trimmedUrl}/api/`, {
        headers: { Authorization: `Bearer ${trimmedToken}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 401) {
        setStatus('error');
        setErrorMessage(t('dialogs:connect.errors.invalidToken'));
        return;
      }
      if (!response.ok) {
        setStatus('error');
        setErrorMessage(
          t('dialogs:connect.errors.httpError', {
            status: response.status,
            statusText: response.statusText,
          })
        );
        return;
      }
      const body = await response.json();
      if (body?.message !== 'API running.') {
        setStatus('error');
        setErrorMessage(t('dialogs:connect.errors.unexpectedResponse'));
        return;
      }

      // Websocket auth handshake, proven independently of the REST check above -- then closed
      // immediately; HassContext establishes the app's real, persistent connection once we
      // hand back a config it accepts.
      const auth = createLongLivedTokenAuth(trimmedUrl, trimmedToken);
      const probe = await createConnection({ auth });
      probe.close();

      onConnect({ url: trimmedUrl, token: trimmedToken });
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      if (error === ERR_INVALID_AUTH) {
        setErrorMessage(t('dialogs:connect.errors.invalidToken'));
      } else if (error === ERR_INVALID_HTTPS_TO_HTTP) {
        setErrorMessage(t('dialogs:connect.errors.mixedContent'));
      } else if (
        error === ERR_CANNOT_CONNECT ||
        (error instanceof TypeError && error.message.toLowerCase().includes('fetch'))
      ) {
        setErrorMessage(t('dialogs:connect.errors.corsHint', { origin: window.location.origin }));
      } else {
        setErrorMessage(
          error instanceof Error ? error.message : t('dialogs:connect.errors.connectionFailed')
        );
      }
    }
  };

  const displayedError = status === 'error' ? errorMessage : connectionError;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-flow-bg p-4">
      <div className="w-full max-w-md rounded-flow-modal border border-flow-border bg-flow-panel p-6 shadow-flow-modal">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <FlowMark size={40} className="text-flow-text" />
          <h1
            className="font-serif text-2xl text-flow-text"
            style={{ letterSpacing: '-0.01em', fontWeight: 600 }}
          >
            {t('dialogs:connect.title')}
          </h1>
          <p className="font-mono text-flow-text-secondary text-xs">
            {t('dialogs:connect.subtitle')}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="connect-url"
              className="font-mono text-[11px] text-flow-text-muted uppercase tracking-wide"
            >
              {t('dialogs:connect.urlLabel')}
            </Label>
            <Input
              id="connect-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleConnect()}
              placeholder={t('dialogs:connect.urlPlaceholder')}
              className="border-flow-border bg-flow-bg font-mono text-flow-text placeholder:text-flow-text-muted focus-visible:ring-[var(--accent)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="connect-token"
              className="font-mono text-[11px] text-flow-text-muted uppercase tracking-wide"
            >
              {t('dialogs:connect.tokenLabel')}
            </Label>
            <Input
              id="connect-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleConnect()}
              placeholder={t('dialogs:connect.tokenPlaceholder')}
              className="border-flow-border bg-flow-bg font-mono text-flow-text text-sm placeholder:text-flow-text-muted focus-visible:ring-[var(--accent)]"
            />
            <p className="font-mono text-[10px] text-flow-text-muted">
              {t('dialogs:connect.tokenHelp')}
            </p>
          </div>

          {displayedError && (
            <div className="flex items-start gap-2 rounded-flow-control border border-[var(--danger)] p-2.5 font-mono text-[var(--danger)] text-xs">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-pre-wrap">{displayedError}</span>
            </div>
          )}

          <Button
            onClick={handleConnect}
            disabled={status === 'testing' || !url.trim() || !token.trim()}
            className="w-full bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover"
          >
            {status === 'testing' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('dialogs:connect.testing')}
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {t('dialogs:connect.connect')}
              </>
            )}
          </Button>

          <p className="text-center font-mono text-[10px] text-flow-text-muted">
            {t('dialogs:connect.securityNote')}
          </p>
        </div>
      </div>
    </div>
  );
}
