import type { FlowNode } from '@flow/shared';
import { DevicePicker } from '@/components/forms/DevicePicker';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import { getNodeDataString } from '@/utils/nodeData';

interface DeviceConditionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Device condition field component.
 * Handles device-based condition configuration.
 */
export function DeviceConditionFields({ node, onChange }: DeviceConditionFieldsProps) {
  const deviceId = getNodeDataString(node, 'device_id');
  const domain = getNodeDataString(node, 'domain');
  const type = getNodeDataString(node, 'type');

  return (
    <>
      <FormField label="Device" required>
        <DevicePicker
          value={deviceId}
          onChange={(val) => onChange('device_id', val)}
          placeholder="Select device..."
        />
      </FormField>

      <FormField label="Domain" required description="Device integration domain">
        <Input
          type="text"
          value={domain}
          onChange={(e) => onChange('domain', e.target.value)}
          placeholder="e.g., binary_sensor, sensor"
        />
      </FormField>

      <FormField label="Type" required description="Device condition type">
        <Input
          type="text"
          value={type}
          onChange={(e) => onChange('type', e.target.value)}
          placeholder="e.g., button_short_press"
        />
      </FormField>
    </>
  );
}
