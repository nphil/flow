## 1.4.0

- Scripts: a new **Scripts** tab opens any Home Assistant script on the canvas, lets you edit it and saves it back with the same steps. Fields, icon, mode and variables are kept, and Run starts a script.
- Automations and scripts made from a blueprint open read-only (Home Assistant builds their steps), showing the blueprint and its inputs, instead of failing to open.
- New **Readability** tab: plain-language tips on the open automation or script (steps without a name, templates a built-in condition can replace, literal `device_id`s, state triggers that fire when a sensor comes back from `unavailable`) with one-click fixes, and a small dot on the nodes that have a tip.
- Round trip: every automation and script in the 353-fixture test set now opens and saves back as written, with the same steps in the same shape. `choose` stays `choose`, an inline condition step stays a step, `service:` stays `service:`, shorthand `and:`/`or:`/`not:` conditions, templated triggers, waits, delays and settings keep what they had, and a step Flow has no node for (such as `scene:`) is saved exactly as written and shown as such.
- Fix: saving an automation no longer drops its top-level `variables`, and nodes keep the positions you gave them after a save (they used to trade places when a block was followed by more steps).
- Fix: a `repeat` loop (`until` or `count`) whose body starts with a `parallel` block opens and saves back as written instead of being rewritten.
- Fix: an `if` with no else followed by a `parallel` block no longer pulls the rest of the steps into an `else`, and a script that starts with a `parallel` block keeps its alias and note.
- Fix: the state-machine fallback keeps `max`, `max_exceeded`, `initial_state`, `trace` and `trigger_variables`.
- Fix: when a `choose` runs its default branch, the live trace now lights up the default's own step instead of the first condition.
- `yarn verify:ha` checks scripts as well as automations and now needs `HA_URL` and a token instead of built-in addresses.

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
