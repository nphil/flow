# Flow Web

## What this is

Standalone deployment of Flow — the exact same web app that runs as the Flow panel
inside Home Assistant, packaged to run on its own instead of through the HA frontend.
Reach for it when you want Flow at its own hostname: a bookmark, a kiosk tab, behind
your own reverse proxy.

It talks to your Home Assistant instance over the normal REST + WebSocket API, the same
way any other HA client would. It does not need to run on the same machine, or even the
same network segment (as long as it can reach your HA URL), as the `flow` HACS
integration that actually stores and executes the automations it edits.

## Connecting

On first load you'll see a connect screen asking for:

- **Home Assistant URL** — e.g. `http://homeassistant.local:8123`, or whatever URL you'd
  normally use to reach your HA frontend.
- **Long-lived access token** — create one from your Home Assistant profile page:
  **Security** tab → **Long-Lived Access Tokens** → **Create Token**.

Click **Test & Connect**. Flow validates the URL with a `GET /api/` request and opens an
authenticated WebSocket before storing anything. The URL and token live in this browser's
`localStorage` only — Flow Web has no backend of its own and never sees or persists them
anywhere else. Use **Disconnect** / **Change server** in the overflow menu to switch
instances or sign out; Flow reconnects automatically (with backoff) if the connection
drops.

## CORS

Flow Web is served from a different origin than Home Assistant, so HA must be told to
allow it. Add the exact origin you browse to (scheme + host + port, after any reverse
proxy) to `http.cors_allowed_origins` in Home Assistant's `configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - http://homeassistant.local:8099
```

Restart Home Assistant Core after changing this. A "CORS" or "unreachable" error on the
connect screen almost always means this origin is missing or doesn't match exactly
(scheme and port included).

## Security

The long-lived token you give Flow Web is a **full-admin credential** for the connected
Home Assistant instance: whoever holds it — or has access to a signed-in Flow Web tab —
can read, create, edit, delete, enable/disable, and manually trigger any automation, and
depending on the HA user it belongs to, potentially far more than that. Treat it like an
admin password:

- Only expose this add-on's port on networks you trust. Don't put it on the open internet
  without your own authentication in front of it (a reverse proxy with its own auth, a
  VPN, or Home Assistant's own remote-access mechanisms).
- Mint a dedicated long-lived token for it rather than reusing one from elsewhere, so it
  can be revoked independently if this instance is ever compromised.
- For everyday use, prefer the in-HA Flow panel from the `flow` HACS integration — it
  rides on Home Assistant's own authenticated session with no separate token to manage.
  Flow Web is for the cases where you specifically want Flow outside the HA frontend.

## Updating

This add-on's `version` and the `custom_components/flow` release it downloads always
match (see the add-on's Dockerfile), so updating it in the Supervisor Add-on Store like
any other add-on keeps the standalone app in lockstep with that release, whether or not
you also have the HACS integration installed anywhere.
