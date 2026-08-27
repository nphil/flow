# Home Assistant Add-on: Flow Web

_Flow's automation editor, packaged as a standalone web app._

![Supports amd64 Architecture](https://img.shields.io/badge/amd64-yes-green.svg)
![Supports aarch64 Architecture](https://img.shields.io/badge/aarch64-yes-green.svg)

Runs the same web app as the [Flow](https://github.com/nphil/flow) HACS integration's
panel, served on its own port instead of inside the Home Assistant frontend — for its own
hostname, a kiosk tab, or behind your own reverse proxy.

See [DOCS.md](./DOCS.md) for connecting it to a Home Assistant instance (URL, long-lived
token, and the CORS setting it requires).
