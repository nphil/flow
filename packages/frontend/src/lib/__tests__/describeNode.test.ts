import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import { type DescribeT, describeNode, type NodeDescription } from '../describeNode';

let t: DescribeT;

beforeAll(async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en },
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  t = i18n.getFixedT('en', 'nodes');
});

function describe_(type: string, data: Record<string, unknown>): NodeDescription {
  return describeNode(type, data, t);
}

const title = (type: string, data: Record<string, unknown>) => describe_(type, data).title;

describe('alias handling', () => {
  it('lets a user alias win as the title and moves the machine summary to the subtitle', () => {
    expect(
      describe_('trigger', { trigger: 'state', entity_id: 'light.kitchen', alias: 'Kitchen on' })
    ).toEqual({
      title: 'Kitchen on',
      subtitle: 'State change of light.kitchen',
    });
    expect(
      describe_('action', {
        service: 'light.turn_on',
        target: { area_id: 'kitchen' },
        alias: 'Lights up',
      })
    ).toEqual({ title: 'Lights up', subtitle: 'Turn on area kitchen' });
  });

  it('ignores blank aliases', () => {
    expect(describe_('delay', { delay: '00:05:00', alias: '   ' })).toEqual({
      title: 'Wait 5 min',
    });
  });

  it('never shows the parser placeholder alias of an unsupported step', () => {
    expect(
      describe_('action', {
        service: 'unknown.unknown',
        alias: 'Unknown Node',
        data: { choose: [] },
      })
    ).toEqual({ title: 'Unsupported step (kept as is)', detail: ['Contains: choose'] });
  });

  it('flags a disabled node with a leading detail line', () => {
    expect(describe_('delay', { delay: '00:00:10', enabled: false })).toEqual({
      title: 'Wait 10 s',
      detail: ['Disabled — skipped when the automation runs'],
    });
  });

  it('falls back to the node type for an unknown node type', () => {
    expect(describeNode('mystery', {}, t)).toEqual({ title: 'mystery' });
    expect(describeNode('mystery', { alias: 'Mine' }, t)).toEqual({ title: 'Mine' });
  });
});

describe('triggers', () => {
  it('describes a state trigger with from, to, for and trigger id', () => {
    expect(
      describe_('trigger', {
        trigger: 'state',
        entity_id: 'light.kitchen',
        from: 'off',
        to: 'on',
        for: '00:02:00',
        id: 'kitchen_on',
      })
    ).toEqual({
      title: 'State change of light.kitchen from off to on for 2 min',
      detail: ['Trigger ID: kitchen_on'],
    });
  });

  it('describes attributes, several target states and long entity lists', () => {
    expect(
      title('trigger', {
        trigger: 'state',
        entity_id: ['light.a', 'light.b', 'light.c'],
        attribute: 'brightness',
        to: ['10', '20'],
      })
    ).toBe('Change of brightness on 3 entities to 10 or 20');
  });

  it('accepts the legacy `platform` key and a for: duration object', () => {
    expect(
      title('trigger', { platform: 'state', entity_id: 'a.b', for: { minutes: 1, seconds: 30 } })
    ).toBe('State change of a.b for 1 min 30 s');
  });

  it('describes numeric_state triggers', () => {
    expect(
      title('trigger', { trigger: 'numeric_state', entity_id: 'sensor.temp', above: 20 })
    ).toBe('Value of sensor.temp rising above 20');
    expect(title('trigger', { trigger: 'numeric_state', entity_id: 'sensor.temp', below: 5 })).toBe(
      'Value of sensor.temp dropping below 5'
    );
    expect(
      title('trigger', {
        trigger: 'numeric_state',
        entity_id: 'sensor.temp',
        above: 20,
        below: 30,
        for: { minutes: 5 },
      })
    ).toBe('Value of sensor.temp between 20 and 30 for 5 min');
  });

  it('describes time triggers', () => {
    expect(title('trigger', { trigger: 'time', at: '07:00:00' })).toBe('Every day at 07:00');
    expect(title('trigger', { trigger: 'time', at: ['07:00:00', '19:30:00'] })).toBe(
      'Every day at 07:00, or every day at 19:30'
    );
    expect(
      title('trigger', { trigger: 'time', at: 'input_datetime.wake', offset: '-00:15:00' })
    ).toBe('15 min before the time set in input_datetime.wake');
  });

  it('describes time_pattern triggers', () => {
    expect(title('trigger', { trigger: 'time_pattern', minutes: '/5' })).toBe('Every 5 minutes');
    expect(title('trigger', { trigger: 'time_pattern', hours: '/1' })).toBe('Every hour');
    expect(title('trigger', { trigger: 'time_pattern', hours: '8', minutes: '30' })).toBe(
      'Time pattern (hours 8, minutes 30)'
    );
  });

  it('describes sun triggers with offsets', () => {
    expect(title('trigger', { trigger: 'sun', event: 'sunrise' })).toBe('Sunrise');
    expect(title('trigger', { trigger: 'sun', event: 'sunset', offset: '-00:30:00' })).toBe(
      '30 min before sunset'
    );
    expect(title('trigger', { trigger: 'sun', event: 'sunset', offset: '01:00:00' })).toBe(
      '1 h after sunset'
    );
  });

  it('describes zone, event, mqtt, webhook and home assistant triggers', () => {
    expect(
      title('trigger', {
        trigger: 'zone',
        entity_id: 'person.a',
        zone: 'zone.home',
        event: 'enter',
      })
    ).toBe('Arrival of person.a in zone.home');
    expect(
      title('trigger', {
        trigger: 'zone',
        entity_id: 'person.a',
        zone: 'zone.home',
        event: 'leave',
      })
    ).toBe('Departure of person.a from zone.home');
    expect(title('trigger', { trigger: 'event', event_type: 'my_event' })).toBe('Event my_event');
    expect(title('trigger', { trigger: 'mqtt', topic: 'home/door' })).toBe(
      'MQTT message on home/door'
    );
    expect(title('trigger', { trigger: 'mqtt', topic: 'home/door', payload: 'open' })).toBe(
      'MQTT message "open" on home/door'
    );
    expect(title('trigger', { trigger: 'webhook', webhook_id: 'abc' })).toBe(
      'Webhook abc being called'
    );
    expect(title('trigger', { trigger: 'homeassistant', event: 'start' })).toBe(
      'Home Assistant starting'
    );
    expect(title('trigger', { trigger: 'homeassistant', event: 'shutdown' })).toBe(
      'Home Assistant shutting down'
    );
  });

  it('summarizes template triggers in words when the template is a known idiom', () => {
    expect(
      title('trigger', {
        trigger: 'template',
        value_template: "{{ is_state('light.x', 'on') }}",
        for: '00:01:00',
      })
    ).toBe('Template turning true: light.x is on for 1 min');
  });

  it('describes device, calendar, conversation, geo_location, notification and tag triggers', () => {
    expect(
      title('trigger', { trigger: 'device', domain: 'light', type: 'turned_on', device_id: 'x' })
    ).toBe('Device event: light turned on');
    expect(
      title('trigger', {
        trigger: 'calendar',
        entity_id: 'calendar.work',
        event: 'start',
        offset: '-00:10:00',
      })
    ).toBe('10 min before start of a calendar event in calendar.work');
    expect(
      title('trigger', { trigger: 'calendar', entity_id: 'calendar.work', event: 'end' })
    ).toBe('End of a calendar event in calendar.work');
    expect(
      title('trigger', { trigger: 'conversation', command: ['turn on the light', 'lights on'] })
    ).toBe('Voice command "turn on the light / lights on"');
    expect(
      title('trigger', {
        trigger: 'geo_location',
        source: 'nsw_rfs',
        zone: 'zone.home',
        event: 'enter',
      })
    ).toBe('Geo-location from nsw_rfs arriving in zone.home');
    expect(
      title('trigger', {
        trigger: 'persistent_notification',
        update_type: ['added'],
        notification_id: 'n1',
      })
    ).toBe('Persistent notification added (n1)');
    expect(title('trigger', { trigger: 'tag', tag_id: 'abc' })).toBe('Tag abc being scanned');
    expect(title('trigger', { trigger: 'tag' })).toBe('A tag being scanned');
  });

  it('describes purpose-specific triggers by their target', () => {
    expect(
      describe_('trigger', {
        trigger: 'motion.detected',
        target: { area_id: 'kitchen' },
        options: { behavior: 'any', for: { seconds: 30 } },
      })
    ).toEqual({
      title: 'Motion detected in area kitchen for 30 s',
      detail: ['Options: behavior any'],
    });
    expect(
      title('trigger', {
        trigger: 'door.opened',
        target: { entity_id: 'binary_sensor.front_door' },
      })
    ).toBe('Door opened in binary_sensor.front_door');
  });

  it('says so when nothing is chosen yet and for unknown platforms', () => {
    expect(title('trigger', { trigger: 'state', entity_id: '' })).toBe(
      'State change of (no entity yet)'
    );
    expect(title('trigger', { trigger: 'sentence_x' })).toBe('Sentence_x trigger');
  });
});

describe('conditions', () => {
  it('describes state conditions', () => {
    expect(
      title('condition', { condition: 'state', entity_id: 'light.kitchen', state: 'on' })
    ).toBe('light.kitchen is on');
    expect(
      title('condition', {
        condition: 'state',
        entity_id: 'light.kitchen',
        state: ['on', 'off'],
        for: { minutes: 5 },
      })
    ).toBe('light.kitchen has been on or off for 5 min');
    expect(
      title('condition', {
        condition: 'state',
        entity_id: 'light.a',
        attribute: 'brightness',
        state: '100',
      })
    ).toBe('brightness of light.a is 100');
  });

  it('describes numeric_state conditions', () => {
    expect(
      title('condition', { condition: 'numeric_state', entity_id: 'sensor.t', above: 5 })
    ).toBe('sensor.t is above 5');
    expect(
      title('condition', { condition: 'numeric_state', entity_id: 'sensor.t', below: 5 })
    ).toBe('sensor.t is below 5');
    expect(
      title('condition', { condition: 'numeric_state', entity_id: 'sensor.t', above: 5, below: 10 })
    ).toBe('sensor.t is between 5 and 10');
  });

  it('turns common template idioms into sentences and shows other templates plainly', () => {
    expect(
      title('condition', {
        condition: 'template',
        value_template: "{{ is_state('light.x','off') }}",
      })
    ).toBe('light.x is off');
    expect(
      title('condition', {
        condition: 'template',
        value_template: "{{ not is_state('light.x','off') }}",
      })
    ).toBe('light.x is not off');
    expect(
      title('condition', {
        condition: 'template',
        value_template: "{{ states('sensor.t') | float(0) > 5 }}",
      })
    ).toBe('sensor.t > 5');
    expect(
      title('condition', {
        condition: 'template',
        value_template: "{{ now().hour > 7 and is_state('a.b', 'c') }}",
      })
    ).toBe("Template is true: now().hour > 7 and is_state('a.b', 'c')");
  });

  it('handles the shorthand template condition', () => {
    expect(title('condition', { condition: "{{ is_state('light.x', 'on') }}" })).toBe(
      'light.x is on'
    );
  });

  it('describes time conditions', () => {
    expect(
      title('condition', {
        condition: 'time',
        after: '07:00:00',
        before: '22:00:00',
        weekday: ['mon', 'tue'],
      })
    ).toBe('It is between 07:00 and 22:00 on Mon, Tue');
    expect(title('condition', { condition: 'time', after: '07:00:00' })).toBe('It is after 07:00');
    expect(title('condition', { condition: 'time', before: '22:00:00' })).toBe(
      'It is before 22:00'
    );
    expect(title('condition', { condition: 'time', weekday: ['sat', 'sun'] })).toBe(
      'Today is Sat, Sun'
    );
  });

  it('describes sun and zone conditions', () => {
    expect(
      title('condition', {
        condition: 'sun',
        after: 'sunset',
        after_offset: '-01:00:00',
        before: 'sunrise',
      })
    ).toBe('It is between 1 h before sunset and sunrise');
    expect(title('condition', { condition: 'sun', before: 'sunrise' })).toBe(
      'It is before sunrise'
    );
    expect(
      title('condition', { condition: 'zone', entity_id: 'person.a', zone: 'zone.home' })
    ).toBe('person.a is in zone.home');
  });

  it('describes trigger conditions', () => {
    expect(title('condition', { condition: 'trigger', id: ['a', 'b'] })).toBe(
      'Started by trigger a or b'
    );
  });

  it('describes and/or/not groups by their sub-condition count and lists the first ones', () => {
    const sub = [
      { condition: 'state', entity_id: 'a.b', state: 'on' },
      { condition: 'trigger', id: 'x' },
      { condition: 'sun', after: 'sunset' },
      { condition: 'zone', entity_id: 'p.a', zone: 'zone.home' },
    ];
    expect(describe_('condition', { condition: 'and', conditions: sub })).toEqual({
      title: 'All 4 conditions are true',
      detail: ['a.b is on', 'Started by trigger x', 'It is after sunset', '+1 more'],
    });
    expect(describe_('condition', { condition: 'or', conditions: sub.slice(0, 2) })).toEqual({
      title: 'Any of 2 conditions is true',
      detail: ['a.b is on', 'Started by trigger x'],
    });
    expect(describe_('condition', { condition: 'not', conditions: sub.slice(0, 2) })).toEqual({
      title: 'None of 2 conditions is true',
      detail: ['a.b is on', 'Started by trigger x'],
    });
    expect(title('condition', { condition: 'and', conditions: sub.slice(0, 1) })).toBe(
      'The condition is true'
    );
  });

  it('describes device and purpose-specific conditions', () => {
    expect(
      title('condition', { condition: 'device', domain: 'light', type: 'is_on', device_id: 'x' })
    ).toBe('Device check: light is on');
    expect(
      describe_('condition', {
        condition: 'battery.is_level',
        target: { entity_id: 'sensor.phone_battery' },
        options: { above: 20 },
      })
    ).toEqual({
      title: 'Battery is level in sensor.phone_battery',
      detail: ['Options: above 20'],
    });
  });
});

describe('actions', () => {
  it('describes turn on / off / toggle with their target', () => {
    expect(
      title('action', { service: 'light.turn_off', target: { entity_id: 'light.kitchen' } })
    ).toBe('Turn off light.kitchen');
    expect(title('action', { action: 'light.turn_on', target: { area_id: 'kitchen' } })).toBe(
      'Turn on area kitchen'
    );
    expect(
      title('action', { service: 'switch.toggle', target: { entity_id: ['switch.a', 'switch.b'] } })
    ).toBe('Toggle switch.a, switch.b');
    expect(title('action', { service: 'light.turn_on', target: { device_id: 'abc' } })).toBe(
      'Turn on 1 device'
    );
  });

  it('describes other services by their verb and target, falling back to the service name', () => {
    expect(
      describe_('action', {
        service: 'climate.set_temperature',
        target: { entity_id: 'climate.x' },
        response_variable: 'result',
        continue_on_error: true,
      })
    ).toEqual({
      title: 'Set temperature: climate.x',
      detail: ['Saves the answer as result', 'Keeps going if this fails'],
    });
    expect(title('action', { service: 'automation.reload' })).toBe('Call automation.reload');
  });

  it('describes notifications and scripts', () => {
    expect(
      describe_('action', { service: 'notify.mobile_app_phone', data: { message: 'Door open' } })
    ).toEqual({ title: 'Send notification via mobile_app_phone', detail: ['Message: Door open'] });
    expect(title('action', { service: 'script.night_mode' })).toBe('Run script night_mode');
  });

  it('describes device actions', () => {
    expect(
      title('action', {
        service: 'light.turn_on',
        target: { device_id: 'd' },
        data: { type: 'turn_on', device_id: 'd', domain: 'light', entity_id: 'light.x' },
      })
    ).toBe('Device action: light turn on (light.x)');
  });

  it('describes fire event', () => {
    expect(title('action', { event: 'my_event' })).toBe('Fire event my_event');
  });

  it('describes stop, and marks stop-with-error as danger', () => {
    expect(describe_('action', { stop: 'Door still open' })).toEqual({
      title: 'Stop here: Door still open',
    });
    expect(describe_('action', { stop: '' })).toEqual({ title: 'Stop here' });
    expect(describe_('action', { stop: 'Sensor lost', error: true })).toEqual({
      title: 'Stop with error: Sensor lost',
      tone: 'danger',
    });
    expect(describe_('action', { stop: '', error: true })).toEqual({
      title: 'Stop with error',
      tone: 'danger',
    });
  });

  it('describes set_conversation_response', () => {
    expect(title('action', { set_conversation_response: 'Done' })).toBe(
      'Reply to the voice command: Done'
    );
    expect(title('action', { set_conversation_response: undefined })).toBe(
      'Reply to the voice command'
    );
  });

  it('describes repeat for_each over a list, with the number of steps inside', () => {
    expect(
      describe_('action', { repeat: { for_each: ['a', 'b', 'c'], sequence: [{}, {}] } })
    ).toEqual({ title: 'Repeat for each of 3 items', detail: ['2 steps inside'] });
    expect(describe_('action', { repeat: { for_each: ['a'], sequence: [{}] } })).toEqual({
      title: 'Repeat for 1 item',
      detail: ['1 step inside'],
    });
  });

  it('describes repeat for_each over a template', () => {
    expect(
      describe_('action', {
        repeat: { for_each: "{{ state_attr('group.x', 'entity_id') }}", sequence: [{}, {}, {}] },
      })
    ).toEqual({
      title: "Repeat for each item in state_attr('group.x', 'entity_id')",
      detail: ['3 steps inside'],
    });
  });

  it('describes other repeat shapes and parallel blocks', () => {
    expect(title('action', { repeat: { count: 3, sequence: [] } })).toBe('Repeat 3 times');
    expect(title('action', { repeat: { while: [], sequence: [] } })).toBe(
      'Repeat while a condition is true'
    );
    expect(title('action', { parallel: [{}, {}] })).toBe('Run 2 branches at the same time');
  });

  it('describes opaque and empty actions', () => {
    expect(describe_('action', { service: 'unknown.unknown', data: { foo: 1, bar: 2 } })).toEqual({
      title: 'Unsupported step (kept as is)',
      detail: ['Contains: foo, bar'],
    });
    expect(title('action', { foo_bar: 1 })).toBe('Step: foo bar');
    expect(title('action', {})).toBe('Empty step');
  });
});

describe('delay', () => {
  it('humanizes durations', () => {
    expect(title('delay', { delay: '00:05:00' })).toBe('Wait 5 min');
    expect(title('delay', { delay: { hours: 1, minutes: 30 } })).toBe('Wait 1 h 30 min');
    expect(title('delay', { delay: '00:00:45' })).toBe('Wait 45 s');
  });

  it('shows a templated delay as written', () => {
    expect(title('delay', { delay: "{{ states('input_number.x') | int }}" })).toBe(
      "Wait {{ states('input_number.x') | int }}"
    );
  });

  it('says so when no time is set', () => {
    expect(title('delay', { delay: '' })).toBe('Wait (no time set yet)');
  });
});

describe('wait', () => {
  it('describes wait_template with a timeout and warns when a timeout stops the run', () => {
    expect(
      describe_('wait', {
        wait_template: "{{ is_state('light.x', 'on') }}",
        timeout: '00:30:00',
        continue_on_timeout: false,
      })
    ).toEqual({
      title: 'Wait up to 30 min until light.x is on',
      detail: ['Stops the run if it times out'],
    });
  });

  it('describes wait_template without a timeout', () => {
    expect(title('wait', { wait_template: "{{ is_state('light.x', 'on') }}" })).toBe(
      'Wait until light.x is on'
    );
  });

  it('describes wait_for_trigger with one trigger, many triggers, and a timeout object', () => {
    expect(
      title('wait', {
        wait_for_trigger: [{ trigger: 'state', entity_id: 'light.x', to: 'on' }],
        timeout: { minutes: 5 },
      })
    ).toBe('Wait up to 5 min for state change of light.x to on');
    expect(
      title('wait', {
        wait_for_trigger: [{ trigger: 'event', event_type: 'e' }],
        timeout: '00:05:00',
      })
    ).toBe('Wait up to 5 min for event e');
    expect(
      title('wait', {
        wait_for_trigger: [
          { trigger: 'event', event_type: 'e' },
          { trigger: 'state', entity_id: 'a.b' },
        ],
      })
    ).toBe('Wait for any of 2 triggers');
  });

  it('describes a wait with only a timeout, or nothing set yet', () => {
    expect(title('wait', { wait_template: '', timeout: '00:01:00' })).toBe('Wait up to 1 min');
    expect(title('wait', {})).toBe('Wait (not set up yet)');
  });
});

describe('set_variables', () => {
  it('names up to three variables', () => {
    expect(title('set_variables', { variables: { a: 1, b: 2, c: 3 } })).toBe(
      'Set 3 variables: a, b, c'
    );
    expect(title('set_variables', { variables: { a: 1 } })).toBe('Set 1 variable: a');
  });

  it('abbreviates longer lists and keeps the alias in front', () => {
    expect(
      describe_('set_variables', {
        alias: 'Remember stuff',
        variables: { a: 1, b: 2, c: 3, d: 4, e: 5 },
      })
    ).toEqual({ title: 'Remember stuff', subtitle: 'Set 5 variables: a, b, c +2 more' });
    expect(title('set_variables', { variables: {} })).toBe('Set variables (none yet)');
  });
});
