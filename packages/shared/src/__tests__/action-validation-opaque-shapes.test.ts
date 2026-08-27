// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ActionNodeValidationSchema } from '../schemas/validation';

/**
 * Regression coverage for a real save-blocking bug found while implementing
 * for_each support: ActionNodeValidationSchema required `service` or `event`
 * on *every* action node, but stop actions (`data.stop`) and opaque repeat
 * blocks (`data.repeat`, including the new repeat.for_each node) are neither
 * — every stop action or repeat.for_each action showed a permanent false
 * "service or event required" validation error, and flow-store.ts refuses to
 * save while any node has validation errors. Fixed alongside for_each since
 * it's the same underlying gap in the same function.
 */
describe('ActionNodeValidationSchema: stop and opaque-repeat actions', () => {
  it('accepts a stop action with a message', () => {
    const result = ActionNodeValidationSchema.safeParse({ stop: 'Condition not met' });
    expect(result.success).toBe(true);
  });

  it('accepts a stop action with an empty message (HA allows `stop: ""`)', () => {
    const result = ActionNodeValidationSchema.safeParse({ stop: '', error: true });
    expect(result.success).toBe(true);
  });

  it('accepts an opaque repeat.count/while/until block', () => {
    const result = ActionNodeValidationSchema.safeParse({
      repeat: { count: 3, sequence: [{ service: 'light.turn_on' }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an opaque repeat.for_each block', () => {
    const result = ActionNodeValidationSchema.safeParse({
      repeat: {
        for_each: ['a', 'b', 'c'],
        sequence: [{ service: 'notify.mobile_app', data: { message: '{{ repeat.item }}' } }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('still requires a service or event when neither stop nor repeat is present', () => {
    const result = ActionNodeValidationSchema.safeParse({ alias: 'Do nothing in particular' });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues).toContainEqual(
      expect.objectContaining({
        message: 'Either a service (e.g. light.turn_on) or an event name is required',
        path: ['service'],
      })
    );
  });

  it('still rejects a service without a domain prefix', () => {
    const result = ActionNodeValidationSchema.safeParse({ service: 'turn_on' });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues).toContainEqual(
      expect.objectContaining({ path: ['service'] })
    );
  });

  it('still accepts a normal service call action', () => {
    const result = ActionNodeValidationSchema.safeParse({ service: 'light.turn_on' });
    expect(result.success).toBe(true);
  });

  it('still accepts a fire-event action', () => {
    const result = ActionNodeValidationSchema.safeParse({ event: 'my_custom_event' });
    expect(result.success).toBe(true);
  });
});
