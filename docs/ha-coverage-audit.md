# Home Assistant coverage audit

How well Flow opens and saves Home Assistant 2026.9 automations and scripts without changing their meaning, and how readable the result is on the canvas.

- **Fixtures**: `__tests__/ha-roundtrip-fixtures/{automations,scripts}/*.yaml`, one complete Home Assistant config per file, written in the shape HA stores (plural `triggers:`/`conditions:`/`actions:`, `trigger:` and `action:` keys) plus dedicated fixtures for the legacy spellings. Every fixture's triggers, conditions and actions were validated against a live Home Assistant 2026.9 (`validate_config`, no automation was saved); top-level keys were checked against the automation/script schema in HA core. Entity, device and webhook ids are synthetic.
- **Check**: `roundTripConfig()` (`packages/transpiler/src/semantic`): open the config in Flow, save it back, compare canonical forms. The corpus test (`packages/transpiler/src/__tests__/ha-roundtrip-corpus.test.ts`) lists every failing fixture in `KNOWN_GAPS` and asserts that it still fails, so fixing a construct without removing its entry turns the suite red. The three older fixtures owned by the transpiler work are not in that list.
- **Snapshot**: measured on `main` at v1.3.0 (`b83bb6e`). Re-run the corpus test after every transpiler change; this table is a snapshot, the test is the live check.

## Result classes

| Class | Meaning |
| --- | --- |
| OK | Opens, saves back, same meaning, no alias or note lost. |
| LOST DATA | Something in the config (a field, an alias, a note) is silently dropped; the step itself still exists. |
| CHANGED MEANING | The saved config behaves differently, or Home Assistant would reject it (guard dropped, step replaced by `unknown.unknown`, wrong values). |
| REWRITTEN | The saved config has a different shape with (as far as analysed) the same behavior. The strict checker flags it, so it counts as a gap until Flow keeps the original shape or the checker learns the equivalence. |
| REJECTED (cannot open) | Flow refuses to open the config or crashes. |
| OPENS BUT STATE-MACHINE | Opens but is saved with the lossy state-machine strategy. None observed: every fixture that opens is saved with the native strategy. |

## Summary

345 fixtures (322 automations, 23 scripts) were run; the three older fixtures owned by the transpiler work are not counted.

| Area | Fixtures | OK | LOST DATA | CHANGED MEANING | REWRITTEN | REJECTED (cannot open) | OPENS BUT STATE-MACHINE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Automation-level | 32 | 19 | 2 | 9 | 0 | 2 | 0 |
| Triggers | 68 | 63 | 0 | 2 | 0 | 3 | 0 |
| Conditions | 66 | 38 | 1 | 14 | 7 | 6 | 0 |
| Actions | 156 | 107 | 4 | 33 | 12 | 0 | 0 |
| Scripts | 23 | 0 | 0 | 0 | 0 | 23 | 0 |
| **Total** | **345** | **227** | **7** | **58** | **19** | **34** | **0** |

## Coverage tables

Each row is one fixture; `construct` is the comment at the top of the fixture file. Fixtures live under `__tests__/ha-roundtrip-fixtures/automations/` (areas 1 to 4) and `.../scripts/` (area 5).

### 1. Automation-level

#### Identity and metadata

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| hide_entity is deprecated but still accepted by Home Assistant | `hide-entity-deprecated.yaml` | LOST DATA | `hide_entity` is dropped on save (only `initial_state: false` survives). |
| Every automation-level option on one automation | `meta-all-top-level-options.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode queued becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| Identity fields of an automation: id, alias and a one-line description | `meta-id-alias-description.yaml` | OK | - |
| Alias and a multi-line description with quotes, colons, hash signs and accents | `meta-multiline-description-special-characters.yaml` | OK | - |
| Shape the UI editor saves: numeric-string id, empty description, empty conditions list | `meta-ui-style-empty-description.yaml` | OK | - |

#### Mode and run limits

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| max_exceeded: critical on a parallel automation | `max-exceeded-critical.yaml` | OK | - |
| max_exceeded: debug on a parallel automation | `max-exceeded-debug.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode parallel becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: error on a parallel automation | `max-exceeded-error.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode parallel becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: fatal (a synonym of critical in the HA log level list) | `max-exceeded-fatal.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode queued becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: info on a queued automation | `max-exceeded-info.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode queued becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: notset on a queued automation | `max-exceeded-notset.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode queued becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: silent on a single-mode automation (suppress the "already running" warning) | `max-exceeded-silent.yaml` | OK | - |
| max_exceeded written in upper case (HA upper-cases the value before checking it) | `max-exceeded-uppercase-silent.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode parallel becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: warn (a synonym of warning in the HA log level list) | `max-exceeded-warn.yaml` | CHANGED MEANING | `max_exceeded` outside Flow's enum (silent/warning/critical) invalidates the whole metadata block: mode parallel becomes single and max/max_exceeded vanish (initial_state, trace too when set). |
| max_exceeded: warning (the HA default level, written out) on a queued automation | `max-exceeded-warning.yaml` | OK | - |
| mode: parallel with an explicit limit of simultaneous runs | `mode-parallel-with-max.yaml` | OK | - |
| mode: queued with an explicit queue length | `mode-queued-with-max.yaml` | OK | - |
| mode: restart - a classic motion light that restarts its delay on every new motion | `mode-restart-motion-timer.yaml` | OK | - |
| mode: single written out explicitly (the default) | `mode-single-explicit.yaml` | OK | - |

#### Startup, trace, variables, empty conditions

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| An explicit empty conditions list, as the UI editor writes it | `conditions-empty-list.yaml` | OK | - |
| initial_state: false - the automation starts switched off after every restart | `initial-state-false.yaml` | OK | - |
| initial_state: true - the automation always starts switched on | `initial-state-true.yaml` | LOST DATA | `initial_state: true` is dropped on save (only `initial_state: false` survives). |
| trace.stored_traces keeps more debug traces than the default of five | `trace-stored-traces.yaml` | OK | - |
| trigger_variables are available when the triggers are attached (limited templates only) | `trigger-variables-top-level.yaml` | OK | - |
| Both automation-level `variables` and `trigger_variables` on one automation | `variables-and-trigger-variables-together.yaml` | OK | - |
| Automation-level variables: scalars, a nested dict, lists, a list of dicts and templates | `variables-top-level-nested.yaml` | OK | - |

#### Blueprints

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| A blueprint instance whose blueprint needs no inputs at all | `blueprint-instance-no-inputs.yaml` | REJECTED (cannot open) | Cannot open: a `use_blueprint` config has no triggers or actions (`Graph must have at least one trigger node`). |
| An automation created from a blueprint: no triggers or actions, only use_blueprint + inputs | `blueprint-instance-with-inputs.yaml` | REJECTED (cannot open) | Cannot open: a `use_blueprint` config has no triggers or actions (`Graph must have at least one trigger node`). |

#### Legacy spellings and list shapes

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Plural triggers/conditions/actions keys that still use the old `platform:` and `service:` names | `legacy-platform-and-service-in-plural-keys.yaml` | OK | - |
| Legacy spelling: trigger, condition and action are single mappings, not lists | `legacy-single-mapping-values.yaml` | OK | - |
| Legacy spelling: singular trigger/condition/action keys holding lists, `platform:` and `service:` | `legacy-singular-keys-trigger-condition-action.yaml` | OK | - |
| A trigger-list entry holding only `triggers:` is merged into the main list by Home Assistant | `triggers-nested-list-flattened.yaml` | CHANGED MEANING | A `- triggers: [...]` entry is saved as `{trigger: state, triggers: [...]}`, an invalid state trigger without entity_id; Home Assistant disables the automation. |

### 2. Triggers

#### State trigger

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| State trigger with neither `from` nor `to`: fires on every state change | `trigger-state-any-change.yaml` | OK | - |
| State trigger on an attribute with numeric `from` and `to` values | `trigger-state-attribute-from-to-numbers.yaml` | REJECTED (cannot open) | Schema rejects numeric `from`/`to` (attribute triggers); only strings and string lists are accepted. |
| State trigger on an attribute value instead of the entity state | `trigger-state-attribute.yaml` | OK | - |
| State trigger watching a list of entities | `trigger-state-entity-list.yaml` | OK | - |
| State trigger with `for` as a duration mapping | `trigger-state-for-dict.yaml` | OK | - |
| State trigger with `for` as a bare number of seconds | `trigger-state-for-seconds-number.yaml` | OK | - |
| State trigger with `for` as an HH:MM:SS string | `trigger-state-for-string.yaml` | OK | - |
| State trigger whose `for` mapping holds a template | `trigger-state-for-template-dict.yaml` | OK | - |
| State trigger whose `for` is one template string | `trigger-state-for-template-string.yaml` | OK | - |
| `from: null` on its own: also a state-change-only trigger | `trigger-state-from-null.yaml` | CHANGED MEANING | `to: null` / `from: null` is dropped, so the trigger also starts firing on attribute-only updates (meaning change). |
| State trigger where `from` and `to` are lists of states | `trigger-state-from-to-lists.yaml` | OK | - |
| State trigger with both `from` and `to` as strings | `trigger-state-from-to-strings.yaml` | OK | - |
| not_from / not_to guards that exclude unavailable and unknown | `trigger-state-not-from-not-to.yaml` | OK | - |
| not_from as a single string next to a `to` value | `trigger-state-not-from-string.yaml` | OK | - |
| `to: null` limits the state trigger to real state changes (attribute-only updates do not fire it) | `trigger-state-to-null.yaml` | CHANGED MEANING | `to: null` / `from: null` is dropped, so the trigger also starts firing on attribute-only updates (meaning change). |
| State trigger on one entity with `to` as a plain string | `trigger-state-to-string.yaml` | OK | - |

#### Numeric state trigger

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Numeric state trigger with an upper and a lower threshold | `trigger-numeric-state-above-below.yaml` | OK | - |
| Numeric state trigger on an attribute | `trigger-numeric-state-attribute.yaml` | OK | - |
| Numeric state trigger with only `below` | `trigger-numeric-state-below-only.yaml` | OK | - |
| Numeric state trigger over a list of entities | `trigger-numeric-state-entity-list.yaml` | OK | - |
| Numeric state trigger that must hold for ten minutes | `trigger-numeric-state-for.yaml` | OK | - |
| Numeric state trigger whose thresholds are other entities | `trigger-numeric-state-helper-thresholds.yaml` | OK | - |
| Numeric state trigger that computes the value with a template | `trigger-numeric-state-value-template.yaml` | OK | - |

#### Time and time pattern triggers

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Time trigger that fires an offset before the time held by an entity | `trigger-time-entity-with-offset.yaml` | OK | - |
| Time trigger at a fixed time of day | `trigger-time-fixed.yaml` | OK | - |
| Time trigger that follows an input_datetime helper | `trigger-time-input-datetime.yaml` | OK | - |
| Time trigger with a list mixing fixed times and a helper entity | `trigger-time-list-of-times.yaml` | OK | - |
| Time pattern trigger using hours, minutes and seconds together | `trigger-time-pattern-hours-minutes-seconds.yaml` | OK | - |
| Time pattern trigger: every five minutes | `trigger-time-pattern-minutes.yaml` | OK | - |
| Time trigger restricted to weekdays | `trigger-time-weekday.yaml` | OK | - |

#### Other trigger types (sun, zone, event, mqtt, webhook, template, homeassistant, device, calendar, geo_location, conversation, persistent_notification, tag)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Calendar trigger when an event ends | `trigger-calendar-event-end.yaml` | OK | - |
| Calendar trigger fifteen minutes before an event starts | `trigger-calendar-event-start-offset.yaml` | OK | - |
| Conversation (sentence) trigger with a list of phrases | `trigger-conversation-sentences.yaml` | OK | - |
| Device trigger (placeholder ids): a light device reports `turned_on` | `trigger-device-light-turned-on.yaml` | OK | - |
| Event trigger that filters on the event context and on templated event data | `trigger-event-context-and-template-data.yaml` | OK | - |
| Event trigger for one custom event type | `trigger-event-single-type.yaml` | OK | - |
| Event trigger with a list of event types and an event_data filter | `trigger-event-type-list-with-data.yaml` | OK | - |
| Geolocation trigger when a feed entity appears in a zone | `trigger-geo-location-enter.yaml` | OK | - |
| Home Assistant shutdown trigger | `trigger-homeassistant-shutdown.yaml` | OK | - |
| Home Assistant start trigger | `trigger-homeassistant-start.yaml` | OK | - |
| MQTT trigger on a topic with an exact payload | `trigger-mqtt-topic-payload.yaml` | OK | - |
| MQTT trigger with a wildcard topic, value_template, QoS and encoding | `trigger-mqtt-wildcard-value-template.yaml` | OK | - |
| Persistent notification trigger for added and removed notifications | `trigger-persistent-notification.yaml` | OK | - |
| Purpose-specific sun trigger with `options` instead of top-level fields | `trigger-sun-purpose-specific-sunset.yaml` | OK | - |
| Sun trigger (legacy options) at sunrise with no offset | `trigger-sun-sunrise.yaml` | OK | - |
| Sun trigger (legacy options) at sunset with a negative offset | `trigger-sun-sunset-with-offset.yaml` | OK | - |
| Tag trigger with several tags and several scanner devices | `trigger-tag-multiple-tags-and-devices.yaml` | OK | - |
| Tag trigger for one tag scanned on one scanner device | `trigger-tag-scanned.yaml` | OK | - |
| Template trigger that must stay true for five minutes | `trigger-template-for.yaml` | OK | - |
| Template trigger that fires when the template turns true | `trigger-template-simple.yaml` | OK | - |
| Webhook trigger with explicit allowed methods and local_only | `trigger-webhook-methods-local-only.yaml` | OK | - |
| Zone trigger when a person enters a zone | `trigger-zone-enter.yaml` | OK | - |
| Zone trigger for several trackers leaving a zone | `trigger-zone-leave-multiple-entities.yaml` | OK | - |

#### Purpose-specific triggers (`<domain>.<name>` with `target` and `options`)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Purpose-specific trigger targeting two areas, with behavior and `for` options | `trigger-purpose-area-list-with-options.yaml` | REJECTED (cannot open) | Schema rejects a purpose-specific trigger whose `target` has no `entity_id` (area/floor/label/device only). |
| Purpose-specific trigger with a list option: climate HVAC mode changed | `trigger-purpose-climate-hvac-mode-changed.yaml` | OK | - |
| Purpose-specific trigger on a door sensor | `trigger-purpose-door-opened.yaml` | OK | - |
| Purpose-specific trigger for an event entity receiving an event type | `trigger-purpose-event-received.yaml` | OK | - |
| Purpose-specific numeric trigger: light brightness crossing a threshold | `trigger-purpose-light-brightness-crossed-threshold.yaml` | OK | - |
| Purpose-specific trigger `light.turned_on` with an entity target | `trigger-purpose-light-turned-on-entity.yaml` | OK | - |
| Purpose-specific trigger whose target mixes floor, label, device and entity ids | `trigger-purpose-target-floor-label-device-entity.yaml` | OK | - |
| Purpose-specific zone trigger (target + options.zone) | `trigger-purpose-zone-entered.yaml` | OK | - |

#### Trigger id, alias, note, enabled, variables

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Two triggers share the same id (allowed by Home Assistant) | `trigger-duplicate-ids.yaml` | OK | - |
| A disabled trigger between two enabled ones | `trigger-fields-disabled.yaml` | OK | - |
| Trigger `enabled` driven by a limited template evaluated when the automation loads | `trigger-fields-enabled-template.yaml` | REJECTED (cannot open) | Schema rejects a trigger `enabled` that is a template string (boolean only). |
| Every trigger carries an id, an alias and a note | `trigger-fields-id-alias-note.yaml` | OK | - |
| Trigger-level variables that are set when that trigger fires | `trigger-fields-variables.yaml` | OK | - |
| Several different trigger types on one automation, each with an id | `trigger-multiple-different-types.yaml` | OK | - |
| One automation, several triggers: a choose routes each trigger id to its own actions | `trigger-routing-by-trigger-id-with-choose.yaml` | OK | - |

### 3. Conditions

#### Condition types and shorthand forms (automation root)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Alias and note on a state, numeric_state, template, time, sun and trigger condition | `condition-alias-note-on-every-leaf-type.yaml` | OK | - |
| Root condition: explicit `and` group | `condition-and-explicit.yaml` | OK | - |
| Root condition: device condition (placeholder ids) | `condition-device-light-is-on.yaml` | OK | - |
| Root conditions: a disabled condition behaves as if it were removed | `condition-disabled.yaml` | OK | - |
| Root condition whose `enabled` is a limited template evaluated at load time | `condition-enabled-template.yaml` | CHANGED MEANING | `enabled` template on a condition is saved as a `template` condition whose text is the JSON of the original condition (never true). |
| Alias and note on a condition group and on each of its members | `condition-group-alias-and-note.yaml` | LOST DATA | Prose is dropped on save: 2 alias(es): Alex is home, It is cold. |
| Root condition written with a list under the `condition:` key (an implicit `and`) | `condition-list-shorthand-condition-key.yaml` | CHANGED MEANING | `condition:` holding a list is saved as a `template` condition whose text is the JSON of the original condition (never true). |
| Root condition: and containing or containing not (three levels deep) | `condition-nested-and-or-not-three-deep.yaml` | OK | - |
| Root condition: explicit `not` group with two members (passes when none is true) | `condition-not-explicit.yaml` | OK | - |
| Root condition: numeric state between two thresholds | `condition-numeric-state-above-below.yaml` | OK | - |
| Root condition: numeric state of an attribute over several entities | `condition-numeric-state-attribute-entity-list.yaml` | OK | - |
| Root condition: numeric state with only `below` | `condition-numeric-state-below-only.yaml` | OK | - |
| Root condition: thresholds taken from other entities | `condition-numeric-state-helper-thresholds.yaml` | OK | - |
| Root condition: numeric state with a value_template adjusting the reading | `condition-numeric-state-value-template.yaml` | OK | - |
| Root condition: explicit `or` group | `condition-or-explicit.yaml` | OK | - |
| Root condition: purpose-specific condition with an area target and an option | `condition-purpose-specific-area-target.yaml` | OK | - |
| Root condition: purpose-specific `light.is_on` with a target and a behavior option | `condition-purpose-specific-light-is-on.yaml` | OK | - |
| Root condition: `and:` shorthand (no `condition:` key) | `condition-shorthand-and.yaml` | REJECTED (cannot open) | Parser crash (`Cannot read properties of undefined (reading 'id')`) on shorthand `and:`/`or:`/`not:` conditions. |
| Root conditions: bare template strings mixed with full condition mappings | `condition-shorthand-bare-template-strings.yaml` | CHANGED MEANING | Three root conditions (two bare template strings and a state condition) collapse into a single state condition: the two template guards are dropped. |
| Root condition: shorthand groups nested inside each other | `condition-shorthand-nested-groups.yaml` | REJECTED (cannot open) | Parser crash (`Cannot read properties of undefined (reading 'id')`) on shorthand `and:`/`or:`/`not:` conditions. |
| Root condition: `not:` shorthand | `condition-shorthand-not.yaml` | REJECTED (cannot open) | Parser crash (`Cannot read properties of undefined (reading 'id')`) on shorthand `and:`/`or:`/`not:` conditions. |
| Root condition: `or:` shorthand with an alias | `condition-shorthand-or.yaml` | REJECTED (cannot open) | Parser crash (`Cannot read properties of undefined (reading 'id')`) on shorthand `and:`/`or:`/`not:` conditions. |
| Root conditions written as one bare template string instead of a list | `condition-shorthand-single-template-string.yaml` | REJECTED (cannot open) | Parser crash (`Cannot read properties of undefined (reading 'id')`) when `conditions:` is one bare template string. |
| Root condition: attribute compared with a numeric value | `condition-state-attribute-number.yaml` | CHANGED MEANING | State condition on a numeric attribute is saved as a `template` condition whose text is the JSON of the original condition (never true). |
| Root condition: attribute matching any of several values | `condition-state-attribute-state-list.yaml` | OK | - |
| Root condition: attribute value instead of the entity state | `condition-state-attribute.yaml` | OK | - |
| Root condition: several entities with `match: any` | `condition-state-entity-list-match-any.yaml` | OK | - |
| Root condition: state held for a duration given as a mapping | `condition-state-for-mapping.yaml` | OK | - |
| Root condition: `for` mapping holding templates | `condition-state-for-template.yaml` | OK | - |
| Root condition: the expected state is read from a helper entity | `condition-state-helper-entity-reference.yaml` | OK | - |
| Root condition: one entity matching any of several states | `condition-state-multiple-states.yaml` | OK | - |
| Root condition: state of one entity | `condition-state-single-entity.yaml` | OK | - |
| Root condition: legacy sun condition between sunset and sunrise with offsets | `condition-sun-after-before-offsets.yaml` | OK | - |
| Root condition: purpose-specific sun condition `sun.is_up` | `condition-sun-purpose-specific-is-up.yaml` | OK | - |
| Root condition: a multi-line template condition written as a block scalar | `condition-template-multiline.yaml` | OK | - |
| Root condition: a single-line template condition | `condition-template-simple.yaml` | OK | - |
| Root condition: time window across midnight plus weekdays | `condition-time-after-before-weekday.yaml` | OK | - |
| Root condition: only an `after` time | `condition-time-after-only.yaml` | OK | - |
| Root condition: time window defined by helper and sensor entities | `condition-time-entities.yaml` | OK | - |
| Root condition: only weekdays | `condition-time-weekday-only.yaml` | OK | - |
| Root condition: automation continues for any of several trigger ids | `condition-trigger-id-list.yaml` | OK | - |
| Root condition: trigger identified by its index (an integer id) | `condition-trigger-index-id.yaml` | CHANGED MEANING | Trigger condition with an integer id is saved as a `template` condition whose text is the JSON of the original condition (never true). |
| Root condition: automation only continues for one trigger id | `condition-trigger-single-id.yaml` | OK | - |
| Root condition: legacy zone condition (entity inside a zone) | `condition-zone-legacy.yaml` | OK | - |
| Root condition: purpose-specific `zone.in_zone` with target and options | `condition-zone-purpose-specific-in-zone.yaml` | OK | - |

#### Conditions in every position (if, choose, repeat, inline steps)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| `choose` branches whose conditions are long-form and shorthand groups | `conditions-in-choose-groups.yaml` | CHANGED MEANING | A `not:` shorthand condition in a `choose` branch is saved as `condition: template` plus a stray `not:` key. |
| `choose` whose branches use state, numeric_state, time, sun and template conditions | `conditions-in-choose-leaf-types.yaml` | OK | - |
| `choose` branch conditions written as one bare template string | `conditions-in-choose-template-string.yaml` | CHANGED MEANING | A bare template-string condition (`"{{ ... }}"`) is spread into a character map (`0: '{'`, `1: '{'`, ...); the saved condition is invalid. |
| `if` whose conditions are an `or` group containing an `and` and a `not` | `conditions-in-if-group-long-form.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| `if` using the `or:` and `and:` shorthand group spellings | `conditions-in-if-group-shorthand.yaml` | CHANGED MEANING | An `or:`/`and:` shorthand group in an `if` is saved as `condition: numeric_state` with a stray `or:` key, and the if is hoisted to root conditions. |
| `if` with several leaf condition types (state, numeric_state, template, time) and an else branch | `conditions-in-if-leaf-types.yaml` | OK | - |
| `if` list mixing bare template strings with a state condition | `conditions-in-if-mixed-bare-templates.yaml` | CHANGED MEANING | A bare template-string condition (`"{{ ... }}"`) is spread into a character map (`0: '{'`, `1: '{'`, ...); the saved condition is invalid. |
| `if` written as one bare template string | `conditions-in-if-template-string.yaml` | CHANGED MEANING | `if: "<template>"` (a bare string) is saved as a call to the non-existent action `unknown.unknown`; the else branch moves into `data`. |
| `if` using a trigger condition and a purpose-specific zone condition | `conditions-in-if-trigger-and-zone.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| `repeat.while` and `repeat.until` written as bare template strings | `conditions-in-repeat-shorthand.yaml` | REJECTED (cannot open) | Schema rejects `repeat.while`/`until` written as a bare template string (a list is required). |
| `repeat.until` with a numeric_state condition and a template | `conditions-in-repeat-until.yaml` | OK | - |
| `repeat.while` with a state condition and a template using repeat.index | `conditions-in-repeat-while.yaml` | OK | - |
| Inline `- condition:` steps in the action list: later steps run only while the gates pass | `conditions-inline-step-gating-sequence.yaml` | REWRITTEN | An inline `- condition:` step is rewritten as `if: [cond] then: [rest of the sequence]`; same behavior, different shape. |
| Inline condition step that is an `or` group, followed by more steps | `conditions-inline-step-group.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| A condition step inside a choose branch followed by more steps in that branch | `conditions-inline-step-in-choose-sequence.yaml` | CHANGED MEANING | A `- condition:` step inside a branch is merged into the branch's conditions, so when the gate fails the `else`/`default`/next branch now runs instead of nothing. |
| A condition step in the first choose branch: if it fails the second branch is NOT tried | `conditions-inline-step-in-first-choose-branch-with-second-branch.yaml` | CHANGED MEANING | A `- condition:` step inside a branch is merged into the branch's conditions, so when the gate fails the `else`/`default`/next branch now runs instead of nothing. |
| A condition step inside `then`: when it fails it only ends the `then` branch, the step after the `if` still runs | `conditions-inline-step-in-if-then.yaml` | REWRITTEN | A `- condition:` step inside `then` is merged into the if's conditions; equivalent here (no else), but the shape changes. |
| A condition step at the start of one parallel branch | `conditions-inline-step-in-parallel-branch.yaml` | REWRITTEN | An inline `- condition:` step is rewritten as `if: [cond] then: [rest of the sequence]`; same behavior, different shape. |
| A condition step inside a repeat sequence | `conditions-inline-step-in-repeat-sequence.yaml` | REWRITTEN | An inline `- condition:` step is rewritten as `if: [cond] then: [rest of the sequence]`; same behavior, different shape. |
| A condition step inside `then` of an if that also has an else: when the gate fails, neither the rest of then nor else runs | `conditions-inline-step-in-then-with-else.yaml` | CHANGED MEANING | A `- condition:` step inside a branch is merged into the branch's conditions, so when the gate fails the `else`/`default`/next branch now runs instead of nothing. |
| Condition steps written as `condition: "<template>"` and as `or:` shorthand | `conditions-step-template-shorthand.yaml` | CHANGED MEANING | A `condition: "<template>"` step is moved to the root `conditions:` as an invalid `{condition: "<template>"}` entry, and an `or:` shorthand step is replaced by `unknown.unknown`. |

### 4. Actions

#### Service calls: data, targets, templates, legacy spellings

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Service call with continue_on_error: the next step still runs when it fails | `action-service-continue-on-error.yaml` | OK | - |
| Service call data holding a null, booleans, numbers and an empty list | `action-service-data-null-and-boolean-values.yaml` | OK | - |
| Old step spelling: `service:` with `data_template` | `action-service-data-template-legacy.yaml` | OK | - |
| Service call whose whole data is one template that renders to a mapping | `action-service-data-template-string.yaml` | LOST DATA | A step `data:` written as one template string is dropped. |
| Service call with a data mapping (scalars, a list and a nested mapping) | `action-service-data.yaml` | OK | - |
| Old step spelling: `service:` instead of `action:` | `action-service-legacy-service-key.yaml` | OK | - |
| Service call storing its response in a variable that a later step uses | `action-service-response-variable.yaml` | OK | - |
| Old step spelling: `service_template` choosing the service with a template | `action-service-service-template-legacy.yaml` | CHANGED MEANING | A `service_template:` step is saved as a call to the non-existent action `unknown.unknown`. |
| Old step spelling: `entity_id` directly on the step instead of under `target` | `action-service-step-level-entity-id.yaml` | OK | - |
| Service call targeting a list of areas | `action-service-target-area-list.yaml` | OK | - |
| Service call targeting an area | `action-service-target-area.yaml` | OK | - |
| Service call targeting a device id | `action-service-target-device.yaml` | OK | - |
| Service call targeting `entity_id: all` | `action-service-target-entity-all.yaml` | OK | - |
| Service call targeting a list of entities | `action-service-target-entity-list.yaml` | OK | - |
| Service call whose target mixes entity, device, area, floor and label ids (scalars and lists) | `action-service-target-every-kind-mixed.yaml` | OK | - |
| Service call targeting a floor | `action-service-target-floor.yaml` | OK | - |
| Service call targeting a label | `action-service-target-label.yaml` | OK | - |
| Service call whose whole target is one template | `action-service-target-template-string.yaml` | LOST DATA | A step `target:` written as one template string is dropped. |
| Service call whose target ids are templates | `action-service-target-templates.yaml` | OK | - |
| `action` itself is a template choosing between two services | `action-service-template-action-name.yaml` | OK | - |

#### Device, scene, event, variables, conversation response

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Device action (placeholder ids) with the empty `metadata` the editor writes | `action-device-light-turn-on.yaml` | OK | - |
| Fire an event using the older `event_data_template` key | `action-event-data-template.yaml` | LOST DATA | `event_data_template` is dropped: the event fires without its data. |
| Fire an event with event_data | `action-event-with-data.yaml` | OK | - |
| Fire an event that has no data at all | `action-event-without-data.yaml` | OK | - |
| Scene step (`scene:` instead of an action call) | `action-scene-activate.yaml` | CHANGED MEANING | A `scene:` step is saved as a call to the non-existent action `unknown.unknown` (scene id moved into `data`); HA cannot run it. |
| set_conversation_response set to null clears the response | `action-set-conversation-response-null.yaml` | CHANGED MEANING | `set_conversation_response: null` (clear the reply) is saved as an empty `{}` step, which Home Assistant rejects. |
| set_conversation_response with plain text | `action-set-conversation-response-plain.yaml` | OK | - |
| set_conversation_response with a template | `action-set-conversation-response-template.yaml` | OK | - |
| A variables step defining scalars and a list | `action-variables-step-scalars.yaml` | OK | - |
| A variables step with templates and a nested mapping | `action-variables-step-templates-and-nested.yaml` | OK | - |
| Two variables steps where the second uses the first | `action-variables-two-steps-in-order.yaml` | OK | - |

#### Delay

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Delay given as a fractional number of seconds | `action-delay-fractional-seconds.yaml` | REWRITTEN | `delay: 5` is saved as `delay: "5"`; HA reads both as 5 s, the strict checker sees a type change. |
| Delay given as an HH:MM string | `action-delay-hhmm-string.yaml` | OK | - |
| Delay given as an HH:MM:SS string | `action-delay-hhmmss-string.yaml` | OK | - |
| Delay mapping using days, hours, minutes, seconds and milliseconds together | `action-delay-mapping-all-units.yaml` | CHANGED MEANING | `delay` with `days` is shortened (1 d 2 h 3 min 4.5 s becomes 2 h 3 min 4.5 s); the days are lost. |
| Delay mapping with only milliseconds | `action-delay-mapping-milliseconds-only.yaml` | OK | - |
| Delay mapping with only minutes | `action-delay-mapping-minutes.yaml` | OK | - |
| Delay mapping whose unit values are templates | `action-delay-mapping-with-templates.yaml` | CHANGED MEANING | A delay mapping with templates is rewritten into one long `format(...)` template that repeats every sub-expression three times; non-deterministic parts such as `random` give inconsistent values. |
| Delay given as a quoted number of seconds | `action-delay-numeric-string.yaml` | OK | - |
| Delay given as a bare number of seconds | `action-delay-seconds-number.yaml` | REWRITTEN | `delay: 5` is saved as `delay: "5"`; HA reads both as 5 s, the strict checker sees a type change. |
| Delay computed by one template | `action-delay-template-string.yaml` | OK | - |

#### Wait for template / trigger

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| wait_for_trigger written with the old `platform:` key | `action-wait-for-trigger-legacy-platform.yaml` | OK | - |
| wait_for_trigger with a list of two triggers, each with an id | `action-wait-for-trigger-list-of-triggers.yaml` | OK | - |
| wait_for_trigger using a numeric_state trigger and a time trigger | `action-wait-for-trigger-numeric-state.yaml` | OK | - |
| wait_for_trigger holding one trigger mapping instead of a list | `action-wait-for-trigger-single-mapping.yaml` | CHANGED MEANING | A `wait_for_trigger` written as one mapping (not a list) is dropped entirely: the next step takes its place and runs immediately. |
| Branch on which trigger a wait_for_trigger saw (`wait.trigger.id`) | `action-wait-for-trigger-then-choose-on-wait-trigger-id.yaml` | OK | - |
| wait_for_trigger with a mapping timeout and continue_on_timeout: false | `action-wait-for-trigger-timeout-continue-false.yaml` | OK | - |
| wait_for_trigger with an HH:MM:SS timeout and continue_on_timeout: true | `action-wait-for-trigger-timeout-string-continue-true.yaml` | OK | - |
| wait_for_trigger whose timeout mapping holds a template | `action-wait-for-trigger-timeout-template.yaml` | OK | - |
| wait_template without a timeout | `action-wait-template-basic.yaml` | OK | - |
| wait_template with continue_on_timeout written out as true (the default) | `action-wait-template-continue-on-timeout-true.yaml` | OK | - |
| wait_template with a mapping timeout and continue_on_timeout: false (the run stops on timeout) | `action-wait-template-timeout-mapping-stop-on-timeout.yaml` | OK | - |
| wait_template with a timeout given as a bare number of seconds | `action-wait-template-timeout-number.yaml` | CHANGED MEANING | A numeric `timeout` on a wait is dropped, so the wait can block forever (`timeout: 30` / `10`). |
| wait_template with an HH:MM:SS timeout (continue on timeout is the default) | `action-wait-template-timeout-string.yaml` | OK | - |
| wait_template whose timeout is a template | `action-wait-template-timeout-template.yaml` | OK | - |
| A wait with timeout followed by an `if` on `wait.completed` (the timeout idiom) | `action-wait-then-branch-on-wait-completed.yaml` | CHANGED MEANING | A bare template-string condition (`"{{ ... }}"`) is spread into a character map (`0: '{'`, `1: '{'`, ...); the saved condition is invalid. The numeric `timeout` of the preceding wait is also dropped. |
| Two waits sharing one overall timeout through `wait.remaining` | `action-wait-two-waits-sharing-one-timeout.yaml` | CHANGED MEANING | A numeric `timeout` on a wait is dropped, so the wait can block forever (`timeout: 30` / `10`). |

#### Stop

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| stop with a reason as the last step | `action-stop-end-of-automation.yaml` | OK | - |
| stop with `error: true` marks the run as failed | `action-stop-error-true.yaml` | OK | - |
| `stop` inside a choose branch, with more steps after the choose | `action-stop-in-choose-branch.yaml` | REWRITTEN | A decision ladder whose first branch ends in `stop` is rewritten as sequential `if`s; equivalent, different shape. |
| `stop` inside the choose default, with more steps after the choose | `action-stop-in-choose-default.yaml` | OK | - |
| `stop` inside `else`, with more steps after the `if` | `action-stop-in-else-branch.yaml` | OK | - |
| `stop` inside `then`, with more steps after the `if`: stop ends the whole run, not just the branch | `action-stop-in-if-then-followed-by-steps.yaml` | OK | - |
| `stop` inside one parallel branch | `action-stop-in-parallel-branch.yaml` | OK | - |
| `stop` inside a repeat loop ends the whole run | `action-stop-in-repeat.yaml` | CHANGED MEANING | A `stop` inside a guarded branch in a loop is saved after an empty `then: []`, so it runs on every iteration. |
| stop returning a response variable | `action-stop-response-variable.yaml` | OK | - |
| stop with no reason (a null value) | `action-stop-without-reason.yaml` | REWRITTEN | `stop: null` is saved as `stop: ''`. |

#### choose

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| choose branches carry an alias and a note; the default has none | `choose-branch-alias-and-note.yaml` | OK | - |
| choose branch whose `conditions` and `sequence` are single mappings instead of lists | `choose-conditions-mapping-instead-of-list.yaml` | OK | - |
| choose with an explicit empty default | `choose-empty-default.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| choose where one branch does nothing (an empty sequence) so later branches are not tried | `choose-empty-sequence-branch.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| choose with four branches and a default, each branch with several steps | `choose-many-branches-with-default.yaml` | OK | - |
| choose nested inside a choose branch | `choose-nested-choose.yaml` | OK | - |
| choose where two branch conditions overlap: only the first matching branch runs | `choose-overlapping-branches-first-match-wins.yaml` | OK | - |
| choose with exactly one branch (an if without else) | `choose-single-branch-only.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| choose between ordinary steps: shared steps before and after the decision | `choose-with-steps-before-and-after.yaml` | OK | - |
| choose with two branches and no default | `choose-without-default.yaml` | OK | - |

#### if / then / else

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Alias and note on an if step and on its conditions | `if-alias-and-note-on-step-and-conditions.yaml` | OK | - |
| An else-if ladder written as nested if statements in the else branch | `if-else-if-chain.yaml` | OK | - |
| if with an empty then and an else (do nothing when true, act otherwise) | `if-empty-then-with-else.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| if with three conditions that must all hold | `if-multiple-conditions-anded.yaml` | OK | - |
| else branch holding an if AND another step (so it is not a plain else-if ladder) | `if-nested-in-else-with-extra-steps.yaml` | OK | - |
| if nested inside the then branch of another if | `if-nested-in-then.yaml` | OK | - |
| if/then/else with several steps in both branches | `if-then-else.yaml` | OK | - |
| if/then without an else | `if-then-only.yaml` | OK | - |
| Two independent ifs back to back, then a shared final step | `if-two-ifs-in-a-row.yaml` | OK | - |

#### repeat

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Alias and note on a repeat step and on a step inside it | `repeat-alias-and-note.yaml` | OK | - |
| repeat with a fixed count | `repeat-count-number.yaml` | OK | - |
| repeat whose count is a template | `repeat-count-template.yaml` | CHANGED MEANING | `repeat.count` given as a template is dropped from the saved repeat. |
| repeat.for_each over a list of mappings | `repeat-for-each-dicts.yaml` | OK | - |
| repeat.for_each over a literal list of strings | `repeat-for-each-scalars.yaml` | OK | - |
| repeat.for_each over a template query, with a condition on repeat.item inside | `repeat-for-each-template-query-with-item-condition.yaml` | OK | - |
| for_each loop whose body is a choose on the current item | `repeat-for-each-with-choose-inside.yaml` | OK | - |
| repeat.index, repeat.first and repeat.last used inside a counted loop | `repeat-index-first-last-variables.yaml` | OK | - |
| A counted repeat nested inside a for_each repeat | `repeat-nested-loops.yaml` | OK | - |
| A guard `if ... then stop` followed by a repeat-until loop: the guard must stay outside the loop condition | `repeat-until-after-if-guard-with-stop.yaml` | OK | - |
| repeat until a condition holds (runs at least once), with steps after the loop | `repeat-until-loop.yaml` | OK | - |
| Poll idiom: repeat until a sensor reports, waiting between attempts | `repeat-until-poll-with-wait-and-delay.yaml` | OK | - |
| A guard `if ... then stop` followed by a repeat-while loop | `repeat-while-after-if-guard-with-stop.yaml` | OK | - |
| repeat while a condition holds, with steps after the loop | `repeat-while-loop.yaml` | OK | - |

#### parallel

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Alias and note on parallel step, on its sequence branches and on steps inside | `parallel-branch-alias-and-note.yaml` | LOST DATA | Prose is dropped on save: 3 alias(es): Tell everyone at once, Light branch, Notification branch; 1 note(s): The two branches do not depend on each other.. |
| Steps after a parallel only run once every branch has finished | `parallel-followed-by-steps.yaml` | OK | - |
| parallel inside a choose branch | `parallel-in-choose-branch.yaml` | CHANGED MEANING | A `parallel` inside an `if`/`choose` branch is saved as plain sequential steps (no longer concurrent). |
| parallel inside the then branch of an if | `parallel-in-if-then.yaml` | CHANGED MEANING | A `parallel` inside an `if`/`choose` branch is saved as plain sequential steps (no longer concurrent). |
| parallel mixing a bare action branch with a sequence branch | `parallel-mixed-single-and-sequence-branches.yaml` | OK | - |
| A parallel inside a parallel branch, followed by a step that must run once after the inner pair | `parallel-nested-parallel.yaml` | CHANGED MEANING | A `parallel` nested in a branch is flattened: the step after it is copied into each inner branch (runs twice) and the inner branches are no longer joined first. |
| parallel whose branches are `sequence:` groups with several steps each | `parallel-sequence-branches.yaml` | OK | - |
| parallel with two plain actions (each runs at the same time) | `parallel-single-actions.yaml` | OK | - |
| parallel written with a single mapping instead of a list | `parallel-single-mapping-branch.yaml` | CHANGED MEANING | `parallel:` given as one mapping is saved as a call to the non-existent action `unknown.unknown`. |

#### Nested sequence

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| A sequence group inside a sequence group | `sequence-nested-inside-sequence.yaml` | CHANGED MEANING | A nested `sequence:` group is saved as a call to the non-existent action `unknown.unknown` (the whole group moved into `data`). Also loses 2 alias(es): Outer group, Inner group. |
| A nested `sequence:` step with an alias, followed by another group | `sequence-nested-with-alias.yaml` | CHANGED MEANING | A nested `sequence:` group is saved as a call to the non-existent action `unknown.unknown` (the whole group moved into `data`). Also loses 2 alias(es): Turn on devices, Send notifications. |

#### Disabled steps (`enabled: false`)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| A disabled choose block between two enabled steps | `disabled-step-choose.yaml` | CHANGED MEANING | A disabled `if`/`choose` loses its own `enabled: false`; the flag is copied onto the first condition and first steps instead, so the block runs with its conditions disabled (always true). |
| A disabled inline condition step: it no longer gates the steps after it | `disabled-step-condition.yaml` | REWRITTEN | An inline `- condition:` step is rewritten as `if: [cond] then: [rest of the sequence]`; same behavior, different shape. |
| A disabled delay: the steps around it run back to back | `disabled-step-delay.yaml` | OK | - |
| A disabled device action between two enabled steps | `disabled-step-device-action.yaml` | OK | - |
| A disabled fire-event step between two enabled steps | `disabled-step-event.yaml` | OK | - |
| A disabled if/then/else block between two enabled steps | `disabled-step-if.yaml` | CHANGED MEANING | A disabled `if`/`choose` loses its own `enabled: false`; the flag is copied onto the first condition and first steps instead, so the block runs with its conditions disabled (always true). |
| A disabled step inside a choose branch and inside its default | `disabled-step-inside-choose-branch.yaml` | OK | - |
| A disabled step inside an if/then branch | `disabled-step-inside-if-then.yaml` | REWRITTEN | An `if`/`choose` (or a leading condition step) that is the only step is hoisted into the root `conditions:`; same in single mode, but root conditions also gate restart/queued runs. |
| A disabled step inside a parallel branch | `disabled-step-inside-parallel-branch.yaml` | OK | - |
| A disabled step inside a repeat sequence | `disabled-step-inside-repeat.yaml` | OK | - |
| A disabled parallel block between two enabled steps | `disabled-step-parallel.yaml` | CHANGED MEANING | `enabled: false` is removed from a disabled `parallel`; its branches run. |
| A disabled repeat block between two enabled steps | `disabled-step-repeat.yaml` | REWRITTEN | `enabled: false` moves from the `repeat` onto each inner step: the loop still iterates but every step in it is disabled (no side effects). |
| A disabled scene step between two enabled steps | `disabled-step-scene.yaml` | CHANGED MEANING | A `scene:` step is saved as a call to the non-existent action `unknown.unknown` (scene id moved into `data`); HA cannot run it. |
| A disabled nested sequence group between two enabled steps | `disabled-step-sequence-group.yaml` | CHANGED MEANING | A nested `sequence:` group is saved as a call to the non-existent action `unknown.unknown` (the whole group moved into `data`). Also loses 1 alias(es): Optional extras. |
| A disabled service call between two enabled steps | `disabled-step-service-call.yaml` | OK | - |
| A disabled set_conversation_response between two enabled steps | `disabled-step-set-conversation-response.yaml` | OK | - |
| A disabled stop: the run carries on past it | `disabled-step-stop.yaml` | OK | - |
| A disabled variables step: later steps fall back to the default in the template | `disabled-step-variables.yaml` | OK | - |
| A disabled wait_for_trigger with a timeout | `disabled-step-wait-for-trigger.yaml` | OK | - |
| A disabled wait_template with a timeout | `disabled-step-wait-template.yaml` | OK | - |

#### Alias and note on every step kind

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Alias and note on choose (and its branch), if, repeat, parallel (and its branch), sequence and stop steps | `alias-note-on-flow-control-step-kinds.yaml` | CHANGED MEANING | A nested `sequence:` group is saved as a call to the non-existent action `unknown.unknown` (the whole group moved into `data`). Also loses 4 alias(es): Choose alias, Parallel alias, Parallel branch alias; 3 note(s): Choose note., Parallel note.. |
| Alias and note on a service call, device action, scene, event, delay, waits, variables, conversation response and condition step | `alias-note-on-simple-step-kinds.yaml` | CHANGED MEANING | A `scene:` step is saved as a call to the non-existent action `unknown.unknown` (scene id moved into `data`); HA cannot run it. Also loses 1 alias(es): Scene alias; 4 note(s): Scene note., Event note.. |

#### Deep combinations, realistic automations, structure stress, kitchen sinks

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| choose inside repeat inside a parallel branch inside a nested sequence | `deep-choose-in-repeat-in-parallel-in-sequence.yaml` | CHANGED MEANING | A nested `sequence:` group is saved as a call to the non-existent action `unknown.unknown` (the whole group moved into `data`). Also loses 1 alias(es): Outer group. |
| Every choose branch waits or delays differently, then all continue with the same two steps | `deep-diamond-choose-branches-converge-on-shared-tail.yaml` | OK | - |
| An else-if ladder whose rungs contain waits, delays and a stop, followed by shared steps | `deep-if-ladder-with-waits-and-stops.yaml` | REWRITTEN | A decision ladder whose first branch ends in `stop` is rewritten as sequential `if`s; equivalent, different shape. |
| Nested ifs where both levels converge into a shared step, then another shared step | `deep-nested-ifs-converge-twice.yaml` | OK | - |
| repeat inside choose inside if inside a parallel branch, plus a second branch | `deep-repeat-in-choose-in-if-in-parallel.yaml` | OK | - |
| Wait for a trigger with a timeout, stop with a message when it timed out, otherwise carry on | `deep-wait-timeout-guard-then-continue.yaml` | CHANGED MEANING | A bare template-string condition (`"{{ ... }}"`) is spread into a character map (`0: '{'`, `1: '{'`, ...); the saved condition is invalid. |
| One large automation using almost every construct: identity, mode, variables, many triggers and conditions, and every step kind nested | `kitchen-sink-every-construct.yaml` | CHANGED MEANING | A bare template-string condition (`"{{ ... }}"`) is spread into a character map (`0: '{'`, `1: '{'`, ...); the saved condition is invalid. Also loses 1 alias(es): Tidy up. |
| A large automation written entirely with the older spellings (singular keys, platform, service, data_template, device ids) | `kitchen-sink-legacy-spellings.yaml` | OK | - |
| Realistic: check a list of doors, stop with a notice if one is open, otherwise arm the alarm | `realistic-alarm-arming-with-door-check.yaml` | OK | - |
| Realistic: remind every 5 minutes while a door stays open, at most three times | `realistic-door-left-open-reminder.yaml` | OK | - |
| Realistic: close the garage when it was left open, verify it closed, and report either way | `realistic-garage-auto-close.yaml` | OK | - |
| Realistic: a daily digest of low batteries built with a template list and a for_each loop | `realistic-low-battery-digest.yaml` | OK | - |
| Realistic: a motion light with on/off trigger ids, a dark-only gate and restart mode | `realistic-motion-light-with-timeout.yaml` | OK | - |
| Realistic: arrival lights using a zone trigger, sun condition and a parallel notification | `realistic-presence-lights-with-sun-and-zone.yaml` | CHANGED MEANING | A `parallel` of plain actions is saved as sequential steps (no longer concurrent). |
| Realistic (house rule): an actuating state trigger pins `from` and `to`, and a condition re-checks the sensor is not unavailable | `realistic-sensor-unavailable-guard.yaml` | OK | - |
| Realistic: three time triggers with ids, a choose that sets a different setpoint for each | `realistic-thermostat-schedule-with-trigger-ids.yaml` | OK | - |
| Realistic: a conversation trigger that picks a scene from the sentence and replies | `realistic-voice-command-scene.yaml` | OK | - |
| Realistic: power drops below a threshold for two minutes, then announce and wait for the door to open | `realistic-washer-done-notification.yaml` | OK | - |
| Structure stress: choose with a wait inside a repeat-until loop | `structure-choose-inside-repeat-until-with-wait.yaml` | CHANGED MEANING | A `choose` with a branch and a default inside a `repeat: until` is saved as `if: [cond] then: []` followed by the branch steps and the default steps as plain steps: they all run on every iteration. |
| Structure stress: an if/else inside one parallel branch, then a shared step after the parallel | `structure-if-inside-parallel-branch-converging.yaml` | CHANGED MEANING | The step after a `parallel` whose branches hold an `if` or a loop is copied into each branch (it runs once per branch, inside the branch, instead of once after all branches finished). |
| Structure stress: every parallel branch runs its own repeat loop, then one shared step | `structure-parallel-branches-each-with-a-loop.yaml` | CHANGED MEANING | The step after a `parallel` whose branches hold an `if` or a loop is copied into each branch (it runs once per branch, inside the branch, instead of once after all branches finished). |
| Structure stress: a repeat-until loop nested inside a repeat-while loop | `structure-repeat-until-inside-repeat-while.yaml` | CHANGED MEANING | A `repeat: until` nested in a `repeat: while` disappears: its body is inlined once per outer iteration followed by an empty `if: [until condition] then: []`. |
| Structure stress: a loop that stops itself from a choose branch, with steps after the loop | `structure-stop-inside-while-loop-after-choose.yaml` | CHANGED MEANING | A `choose` (door off -> stop) inside a `repeat: while` is merged into the loop's `while:` list and the rest of the loop body (notification, delay) is dropped; the loop now only runs while the door is off. |

### 5. Scripts

#### Scripts (`scripts/`)

| Construct | Fixture | Result today | What exactly goes wrong |
| --- | --- | --- | --- |
| Script identity: alias, icon and description | `script-alias-icon-description.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script created from a blueprint: only use_blueprint and its inputs | `script-blueprint-instance.yaml` | REJECTED (cannot open) | Cannot open: a `use_blueprint` config has no triggers or actions (`Graph must have at least one trigger node`). |
| A script using choose and if/else | `script-choose-and-if-flow.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script with inline condition steps gating the rest | `script-condition-gate-steps.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script fields using entity, device, area and target selectors | `script-fields-entity-device-area-target.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script fields with required and advanced flags and defaults of several types | `script-fields-required-advanced-defaults.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script fields using select, time, duration, date, color and icon selectors | `script-fields-select-time-duration-color.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script fields using text, number and boolean selectors with name, description, required, default and example | `script-fields-text-number-boolean.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script fields that only have a description and an example (no selector) | `script-fields-without-selectors.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script using identity, mode, fields, variables, trace and several step kinds | `script-full-featured.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script written with `service:` and `data_template` spellings | `script-legacy-service-keys.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script max_exceeded with a log level other than silent or warning | `script-max-exceeded-error.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| The smallest script: an alias and one step | `script-minimal-sequence.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script with mode parallel, a run limit and a silenced overflow warning | `script-mode-parallel-max-exceeded-silent.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script with mode queued and a queue length | `script-mode-queued-with-max.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script with mode restart | `script-mode-restart.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script with no alias, an empty description and the default mode written out | `script-no-alias-description-empty.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script using parallel branches | `script-parallel-flow.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script using repeat, waits and a timeout branch | `script-repeat-and-wait-flow.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script calling an action with a response variable and returning part of it | `script-service-response-then-stop.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| A script that returns data to its caller through `stop` and `response_variable` | `script-stop-with-response-variable.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script trace configuration | `script-trace-stored-traces.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |
| Script-level variables used by the sequence | `script-variables-and-templates.yaml` | REJECTED (cannot open) | Cannot open: a script has no trigger (`Graph must have at least one trigger node`); only automations are parsed. |

## On-canvas readability

Derived from reading `packages/frontend/src/components/nodes/*` (cards), `lib/describeNode.ts` (the sentence on each card), `components/panels/*` and `components/panels/node-fields/*` (side panel editors), `utils/nodeData.ts` and `config/handledProperties.ts`, and by running the real `describeNode` on the parsed fixtures.

How a card is drawn: an icon, a title (the user's alias when there is one, otherwise a plain-English sentence, at most four lines), a subtitle (the sentence, when an alias took the title) and detail lines (two lines each). Disabled steps are dimmed with a "Disabled" badge. Condition nodes have a True and a False exit and the edges carry True/False chips. A step Flow cannot model is drawn as "Unsupported step (kept as is)". **`note` is never drawn on the canvas** (it only exists in the side panel).

| Construct | What the card shows today | Readable? | Problem |
| --- | --- | --- | --- |
| State trigger | "State change of X to on" (plus from, for) | Yes | |
| State trigger with `not_from` / `not_to` | "State change of X" | No | The guard that keeps `unavailable`/`unknown` inert (house rule 3) is invisible; `to: null` is invisible too. |
| State trigger on an attribute | "Change of hvac_action on X to heating" | Yes | |
| Numeric state trigger | above / below / for are spelled out | Yes | `value_template` is not shown. |
| Time trigger with `weekday` | "Every day at 08:00" | No | Says every day although it only fires on the listed weekdays. |
| Time trigger with helper entity and offset | "30 min before the time set in input_datetime.alarm_time" | Yes | |
| Time pattern, sun (legacy), zone, event, mqtt, webhook, template, homeassistant, conversation, geo_location, persistent_notification, tag | One sentence each | Yes | `allowed_methods`, `local_only`, `qos`, `encoding`, `value_template` (mqtt) are not shown. |
| Purpose-specific trigger (`light.turned_on`) | "Light turned on in light.kitchen", options on a detail line | Yes | Area/floor/label-only targets cannot be opened at all (see tables above). The editor has no form for them: they are edited as raw additional properties. |
| Purpose-specific sun trigger | "Sun sunset", detail "Options: offset 45 min, offset type before" | Partly | Reads like a log line, not a sentence. |
| Device trigger / condition / action | "Device action: light turn on (<32-character registry id>)" | No | The raw registry id is shown instead of a device or entity name. |
| Trigger `id` | A detail line | Yes | |
| Trigger `variables`, any `note` | Not shown | No | Only in the side panel. |
| Disabled trigger | Badge, dimmed, detail "Disabled" | Yes | |
| State condition | "X is on", "... for 5 min" | Partly | `match: any` is ignored, so "any of" and "all of" read the same. |
| Numeric state, time, sun, zone, trigger conditions | One sentence each (time window and weekdays spelled out) | Yes | `value_template` is not shown. |
| Template condition | Common idioms (`is_state`, `states() > n`) become sentences, anything else "Template is true: <expression>" | Yes | Long templates are clipped. |
| `and` / `or` / `not` group | "Any of 2 conditions is true" plus up to three child lines, then "+N more" | Partly | Nested groups show only "All 2 conditions are true" / "The condition is not true", without their members. |
| Inline `- condition:` gate step | A condition node whose False exit has no edge | Partly | Nothing says that a failing gate ends the run (or only the branch it is in). |
| `if` / `choose` | No container: a chain of condition nodes with True/False chips; a choose branch alias becomes the condition's title with the sentence as subtitle; the default is the last False exit | Partly | "First match wins" is implicit; alias and note of the `choose` block itself are not shown. |
| Service call | "Turn on light.hallway", "Send notification via mobile_app_phone", "Call x.y"; targets list entities, areas, floors, labels, devices | Partly | `data` (brightness, temperature, ...) is not shown except `message`; templated targets are shown as raw template text. |
| Scene step | "Unsupported step (kept as is), Contains: scene" | No | The saved YAML is not the original: the step becomes a call to `unknown.unknown`. |
| Fire event | "Fire event LOGBOOK_ENTRY" | Partly | Event data is not shown. |
| Delay | "Wait 1 min 30 s" | Partly | `days` are ignored (shown and saved without them); a delay mapping with templates is shown as a long generated `format(...)` template. |
| Wait (template / trigger) | "Wait up to 3 min for event X", detail "Stops the run if it times out" | Yes | A numeric `timeout` never reaches the card (dropped when the file is opened); a single-mapping `wait_for_trigger` is dropped. |
| Variables step | "Set 5 variables: a, b, c +2 more" | Partly | Values are not shown; in the side panel a nested mapping shows as `[object Object]` and a list as comma-joined text, and editing writes the text back instead of the structure. |
| Stop | "Stop here: reason", red "Stop with error: ..." | Yes | `response_variable` is not shown; the card has no outgoing handle. |
| `set_conversation_response` | "Reply to the voice command: ..." | Yes | |
| `repeat.count` | A loop of hidden `_repeat_counter_set_variables_<id>` nodes and "Template is true: _repeat_counter_... < 3" with a back-edge | No | Machine names instead of "repeat 3 times". |
| `repeat.while` / `repeat.until` | The body nodes with a condition node and a back-edge | Partly | No "Repeat" label; `repeat.while` / `until` given as one template string cannot be opened. |
| `repeat.for_each` | One card "Repeat for each of 3 items, 1 step inside" | Partly | The inner steps are not on the canvas. |
| `parallel` | Fan-out edges from the previous node, branches re-join | Partly | No "Parallel" node or label; alias and note on the block and its branches are lost; a mapping instead of a list becomes an unsupported step. |
| Nested `sequence:` group | "Unsupported step" | No | Saved as `unknown.unknown`. |
| Disabled `if` / `choose` / `parallel` | Badge and dimming on inner nodes | No | The block's own flag is moved or removed (see actions table). |
| Alias | Card title, sentence as subtitle | Yes | |
| `note` | Not drawn | No | |
| Scripts and blueprint instances | Cannot be opened | No | Every script fixture and both blueprint fixtures are rejected. |

Side panel notes: the trigger platform dropdown offers 12 platforms (state, numeric_state, time, time_pattern, sun, event, mqtt, webhook, zone, template, homeassistant, device); calendar and purpose-specific triggers have no form. The duration editor knows hours, minutes, seconds and milliseconds only (no days). The `enabled` switch is boolean only (a template `enabled` cannot be edited or even opened on a trigger).

## Prioritized fix list

1. **A guard turns into an unconditional action**: `stop` inside a loop branch is saved after an empty `then`; a gate step inside `then`/`choose` is merged into the conditions so `else`/`default`/the next branch runs when the gate fails; a disabled `if`/`choose`/`parallel` loses its own `enabled: false`. These are the actuation-safety bugs.
2. **Steps replaced by `unknown.unknown`**: `scene:`, `service_template:`, nested `sequence:` groups, `parallel:` as a mapping and `if:` as a bare template string. Home Assistant cannot run the saved step, and the card claims it was kept as is.
3. **Bare template-string conditions and shorthand groups**: `and:`/`or:`/`not:` crash or corrupt on open; bare strings in `if`, `choose` and root lists are spread into character maps or collapsed. Both spellings are in the official docs.
4. **Conditions saved as JSON text**: `state` on a numeric attribute, `trigger` with an integer id, `enabled` templates and a `condition:` list all become a `template` condition that is never true.
5. **Waits and replies lose their content**: numeric `timeout` dropped (the wait can block forever), a single-mapping `wait_for_trigger` vanishes, `set_conversation_response: null` becomes an empty step.
6. **`parallel` changes behavior**: inside `if`/`choose` it becomes sequential, nested parallel duplicates the steps after it.
7. **Metadata**: `max_exceeded` levels outside silent/warning/critical (error, fatal, warn, info, debug, notset, upper case) reset the mode to single and drop `max`, `max_exceeded`, `initial_state` and `trace`; `initial_state: true` and `hide_entity` are dropped even on their own.
8. **Delays**: `days` dropped, a templated mapping rewritten into one long non-deterministic template, `delay: 5` saved as the string `"5"`.
9. **Scripts and blueprint instances cannot be opened** (23 script fixtures, 2 blueprint fixtures): `Graph must have at least one trigger node`.
10. **Trigger schema is too strict**: `enabled` as a template, numeric `from`/`to` on attribute triggers, purpose-specific triggers targeting only an area/floor/label/device; `repeat.while`/`until` as one string.
11. **`to: null` / `from: null` dropped**: the trigger starts firing on attribute-only updates. A nested `- triggers: [...]` list is saved as an invalid trigger.
12. **Prose loss**: alias and note on `parallel`, `sequence`, `choose`, `scene`, `event`, `variables`, `set_conversation_response` steps and on members of condition groups.
13. **Canvas honesty**: show `not_from`/`not_to`, `weekday`, `match: any`, service `data`, device names instead of registry ids, "repeat N times" instead of the counter loop, a Parallel label, and the `note`.
14. **Strictness of the checker** (see below): decide whether the equivalent rewrites (REWRITTEN rows) are accepted or fixed in Flow.

### Notes on the semantic checker

- Too strict for legitimate equivalences: `delay: 5` and `delay: "5"` (HA's `time_period_seconds` reads both as 5 s); an inline `- condition:` step followed by steps versus `if: [cond] then: [rest]`; a lone `if`/`choose` versus the same condition in the root `conditions:` (equal in single mode, not for restart/queued); a choose whose first branch ends in `stop` versus sequential `if`s.
- Too loose: `id` and `description` are not compared (`id` is re-added by Home Assistant on save, a lost `description` would pass); notes are checked by text presence anywhere in the output, not by placement.
- A fixture that fails only because of a strict-checker equivalence is labelled REWRITTEN above, so the fix can be chosen deliberately.
