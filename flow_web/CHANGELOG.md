## 1.3.0

- Round-trip fix: automations that stop a branch early (`stop` guards), wait with a timeout, use root conditions, `variables` lookup steps, `max`/`max_exceeded`, or a templated `repeat.for_each` now open and save back exactly as written. They used to fall back to a lossy state-machine rewrite (or fail to open).
- A branch that ends in `stop` is shown as a dead end on the canvas, and the steps after the guard stay at the same level in the saved YAML instead of being nested into an `else`.
- Empty `else: []` / `default: []` are no longer written.
- Every card on the canvas now says in plain English what the step does: timeouts, loops, stops, variables, trigger details. Your own alias stays the title.
- Editing a templated `repeat.for_each` keeps the template instead of replacing it with a list.
- New acceptance gate (`yarn verify:ha`) and an offline fixture corpus compare what Home Assistant stores with what Flow saves.

## 1.2.2

- Header and canvas polish: marquee floor tuned so no readable character is unrevealable.

## 1.2.1

- Marquee jitter fix for clipped text.

## 1.2.0

- Stacked header identity, auto-scrolling clipped labels, palette drag-and-drop, and lossless alias/note round-trips.

## 1.1.0

- Canvas toolbar merged into the top bar, more readable nodes, and the transpiler opens any Home Assistant-valid automation.

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
