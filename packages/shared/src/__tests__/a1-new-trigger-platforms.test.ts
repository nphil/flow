// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HAPlatformEnum } from '../schemas/ha-schemas';
import { TriggerPlatformSchema } from '../schemas/ha-entities';
import { HATriggerSchema } from '../schemas/ha-schemas';
import { TriggerNodeValidationSchema } from '../schemas/validation';

describe('A1: new trigger platforms (geo_location, conversation, persistent_notification, tag)', () => {
  it('HAPlatformEnum accepts all four new platforms', () => {
    for (const platform of ['geo_location', 'conversation', 'persistent_notification', 'tag']) {
      expect(HAPlatformEnum.safeParse(platform).success).toBe(true);
    }
  });

  it('TriggerPlatformSchema (frontend field-config union) accepts all four new platforms', () => {
    for (const platform of ['geo_location', 'conversation', 'persistent_notification', 'tag']) {
      expect(TriggerPlatformSchema.safeParse(platform).success).toBe(true);
    }
  });

  describe('geo_location', () => {
    it('parses source + zone + event through HATriggerSchema', () => {
      const result = HATriggerSchema.safeParse({
        trigger: 'geo_location',
        source: 'nsw_rural_fire_service_feed',
        zone: 'zone.bush_fire_alert_zone',
        event: 'enter',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('nsw_rural_fire_service_feed');
        expect(result.data.zone).toBe('zone.bush_fire_alert_zone');
        expect(result.data.event).toBe('enter');
      }
    });

    it('requires source, zone, and event', () => {
      const result = TriggerNodeValidationSchema.safeParse({ trigger: 'geo_location' });
      expect(result.success).toBe(false);
      const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('source');
      expect(paths).toContain('zone');
      expect(paths).toContain('event');
    });

    it('passes validation once source/zone/event are present', () => {
      const result = TriggerNodeValidationSchema.safeParse({
        trigger: 'geo_location',
        source: 'nsw_rural_fire_service_feed',
        zone: 'zone.bush_fire_alert_zone',
        event: 'enter',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('conversation', () => {
    it('parses a single sentence or a list of sentences through HATriggerSchema', () => {
      const single = HATriggerSchema.safeParse({ trigger: 'conversation', command: 'party time' });
      expect(single.success).toBe(true);

      const list = HATriggerSchema.safeParse({
        trigger: 'conversation',
        command: ["[it's ]party time", 'happy (new year|birthday)'],
      });
      expect(list.success).toBe(true);
    });

    it('requires at least one sentence', () => {
      const result = TriggerNodeValidationSchema.safeParse({ trigger: 'conversation' });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['command'] })
      );
    });

    it('passes validation with a sentence list', () => {
      const result = TriggerNodeValidationSchema.safeParse({
        trigger: 'conversation',
        command: ['play {album} by {artist}'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('persistent_notification', () => {
    it('parses update_type + notification_id through HATriggerSchema', () => {
      const result = HATriggerSchema.safeParse({
        trigger: 'persistent_notification',
        update_type: ['added', 'removed'],
        notification_id: 'my_notification',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.update_type).toEqual(['added', 'removed']);
        expect(result.data.notification_id).toBe('my_notification');
      }
    });

    it('rejects an update_type value outside added/removed/updated/current', () => {
      const result = HATriggerSchema.safeParse({
        trigger: 'persistent_notification',
        update_type: ['bogus'],
      });
      expect(result.success).toBe(false);
    });

    it('has no required fields — an empty persistent_notification trigger passes validation', () => {
      const result = TriggerNodeValidationSchema.safeParse({ trigger: 'persistent_notification' });
      expect(result.success).toBe(true);
    });
  });

  describe('tag', () => {
    it('parses a single tag_id or a list, with optional device_id, through HATriggerSchema', () => {
      const single = HATriggerSchema.safeParse({ trigger: 'tag', tag_id: 'A7-6B-90-5F' });
      expect(single.success).toBe(true);

      const multi = HATriggerSchema.safeParse({
        trigger: 'tag',
        tag_id: ['A7-6B-90-5F', '04-B1-C6-62-2F-64-80'],
        device_id: ['0e19cd3cf2b311ea88f469a7512c307d', '1234567890abcdef1234567890abcdef'],
      });
      expect(multi.success).toBe(true);
    });

    it('requires tag_id', () => {
      const result = TriggerNodeValidationSchema.safeParse({ trigger: 'tag' });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['tag_id'] })
      );
    });

    it('passes validation with tag_id present (device_id omitted, per HA docs, means "any scanner")', () => {
      const result = TriggerNodeValidationSchema.safeParse({ trigger: 'tag', tag_id: 'A7-6B-90-5F' });
      expect(result.success).toBe(true);
    });
  });
});
