// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HAActionSchema,
  HAConditionSchema,
  HADelaySchema,
  HATriggerSchema,
  HAVariablesSchema,
  HAWaitSchema,
} from '../schemas/ha-schemas';

/**
 * A2 (enabled everywhere) + step notes.
 *
 * Notes decision: HA 2026.x's own `note:` key (`CONF_NOTE` in HA core's
 * homeassistant/helpers/config_validation.py) is declared on
 * TRIGGER_BASE_SCHEMA, CONDITION_BASE_SCHEMA, and SCRIPT_ACTION_BASE_SCHEMA
 * — every trigger/condition/action type spreads one of these, so `note` is
 * already a first-class, HA-native per-step field, not something we need to
 * invent. It's declared via `vol.Remove(CONF_NOTE)`, which means: present in
 * the config → accepted (not "extra keys not allowed"), just stripped from
 * the schema's *validated* output — but HA's config-save endpoint
 * (BaseEditConfigView.post in homeassistant/components/config/view.py) only
 * uses the validator to decide pass/fail; it writes the *original posted
 * dict* to storage regardless ("We just validate, we don't store that data
 * because we don't want to store the defaults."). So `note` round-trips
 * through real HA storage untouched. Decision: store user notes as
 * `data.note` on every step type, matching HA's own field name exactly —
 * NOT a custom `flow_notes` key (which is *not* declared on any base schema
 * and would hit "extra keys not allowed" on genuinely extra-forbidding
 * per-type schemas like STATE_CONDITION_SCHEMA), and NOT the automation-level
 * `_cafe_metadata` blob (unnecessary once the real field exists).
 *
 * This test covers our own schema/transpiler-side tolerance of `note` +
 * `enabled`; docs/report.md-equivalent (the final task report) cites the
 * exact HA core source lines this was verified against.
 */
describe('A2 + step notes: `enabled` and `note` parse on every step data schema', () => {
  it('HATriggerSchema', () => {
    const result = HATriggerSchema.safeParse({
      trigger: 'state',
      entity_id: 'binary_sensor.motion',
      enabled: false,
      note: 'Disabled until the sensor is recalibrated',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.note).toBe('Disabled until the sensor is recalibrated');
    }
  });

  it('HAConditionSchema', () => {
    const result = HAConditionSchema.safeParse({
      condition: 'state',
      entity_id: 'sensor.x',
      state: 'on',
      enabled: true,
      note: 'Guards against the false-positive case from #123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.note).toBe('Guards against the false-positive case from #123');
    }
  });

  it('HAActionSchema', () => {
    const result = HAActionSchema.safeParse({
      service: 'light.turn_on',
      enabled: false,
      note: 'Kept for reference, currently unused',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.note).toBe('Kept for reference, currently unused');
    }
  });

  it('HADelaySchema', () => {
    const result = HADelaySchema.safeParse({
      delay: '00:00:30',
      enabled: true,
      note: 'Debounce window',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.note).toBe('Debounce window');
    }
  });

  it('HAWaitSchema', () => {
    const result = HAWaitSchema.safeParse({
      wait_template: '{{ is_state("light.x", "on") }}',
      enabled: true,
      note: 'Wait for the light to actually report on',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.note).toBe('Wait for the light to actually report on');
    }
  });

  it('HAVariablesSchema', () => {
    const result = HAVariablesSchema.safeParse({
      variables: { foo: 'bar' },
      enabled: true,
      note: 'Computed once at the top of the flow',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.note).toBe('Computed once at the top of the flow');
    }
  });
});
