## 1.0.2

- Consistent Flow styling everywhere: legacy CAFE token system removed; all inputs, selects, dialogs, menus, and the nested-condition editor restyled to the Flow design system.
- Responsive right panel: content reflows via container queries at any panel width, long entity ids truncate, button rows wrap.
- Tab strip and filter chips scroll horizontally with an edge fade when the panel is narrow.

## 1.0.1

- Fix: saving no longer rejects automations using shared trigger ids or trigger-condition references (Home Assistant-legal patterns).

<!-- https://developers.home-assistant.io/docs/apps/presentation#keeping-a-changelog -->

## 1.0.0

- Initial release. Serves the `v1.0.0` Flow web bundle; standalone (Home Assistant URL +
  long-lived token) mode only, no ingress.
