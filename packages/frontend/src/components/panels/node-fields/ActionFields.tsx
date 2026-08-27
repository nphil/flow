import type { FlowNode } from '@flow/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { ServicePicker } from '@/components/forms/ServicePicker';
import { TargetEditor, type TargetIds } from '@/components/forms/TargetEditor';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useHass } from '@/contexts/HassContext';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { HassEntity } from '@/types/hass';
import { getNodeDataObject, getNodeDataString } from '@/utils/nodeData';
import { ForEachEditor } from './ForEachEditor';
import { ResponseVariableField } from './ResponseVariableField';
import { ServiceDataFields } from './ServiceDataFields';

interface ActionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

export function ActionFields({ node, onChange }: ActionFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const { getServiceDefinition } = useHass();
  const { getFieldError } = useNodeErrors(node.id);
  const serviceName = getNodeDataString(node, 'service');
  const eventName = getNodeDataString(node, 'event');
  const nodeData = node.data as Record<string, unknown>;
  const stopMessage = typeof nodeData.stop === 'string' ? nodeData.stop : undefined;
  const isStopError = nodeData.error === true;
  const serviceDefinition = getServiceDefinition(serviceName);
  const serviceFields = serviceDefinition?.fields || {};
  const currentData = getNodeDataObject(node, 'data', {});
  const responseVariable = getNodeDataString(node, 'response_variable');
  const [showResponseVariable, setShowResponseVariable] = useState(!!responseVariable);
  const target = getNodeDataObject<TargetIds>(node, 'target', {});
  const repeatData = getNodeDataObject<{ for_each?: unknown[]; sequence?: unknown[] }>(
    node,
    'repeat',
    {}
  );
  const forEachItems = Array.isArray(repeatData.for_each) ? repeatData.for_each : [];

  // Determine action type: stop > event > repeat (for_each) > service
  const actionType =
    stopMessage !== undefined
      ? 'stop'
      : eventName
        ? 'event'
        : nodeData.repeat !== undefined
          ? 'repeat'
          : 'service';

  // Keep toggle in sync if node changes externally
  useEffect(() => {
    setShowResponseVariable(!!responseVariable);
  }, [responseVariable]);

  const handleActionTypeChange = (type: string) => {
    if (type === 'stop') {
      // Switch to stop: clear service, event, and repeat fields
      onChange('service', undefined);
      onChange('target', undefined);
      onChange('data', undefined);
      onChange('event', undefined);
      onChange('event_data', undefined);
      onChange('repeat', undefined);
      onChange('stop', '');
      onChange('error', undefined);
    } else if (type === 'event') {
      // Switch to fire event: clear service, stop, and repeat fields
      onChange('service', undefined);
      onChange('target', undefined);
      onChange('data', undefined);
      onChange('stop', undefined);
      onChange('error', undefined);
      onChange('repeat', undefined);
    } else if (type === 'repeat') {
      // Switch to a for_each loop: clear service, event, and stop fields
      onChange('service', undefined);
      onChange('target', undefined);
      onChange('data', undefined);
      onChange('event', undefined);
      onChange('event_data', undefined);
      onChange('stop', undefined);
      onChange('error', undefined);
      onChange('repeat', { for_each: [], sequence: [] });
    } else {
      // Switch to service call: clear event, stop, and repeat fields
      onChange('event', undefined);
      onChange('event_data', undefined);
      onChange('stop', undefined);
      onChange('error', undefined);
      onChange('repeat', undefined);
    }
  };

  const handleServiceChange = (value: string) => {
    onChange('service', value);
    // Clear data when service changes
    onChange('data', undefined);
  };

  const handleTargetChange = (newTarget: Record<string, unknown> | undefined) => {
    onChange('target', newTarget);
  };

  const handleForEachItemsChange = (items: unknown[]) => {
    onChange('repeat', { ...repeatData, for_each: items });
  };

  const handleDataFieldChange = (fieldName: string, value: unknown) => {
    const newData = { ...currentData, [fieldName]: value === '' ? undefined : value };
    // Clean up undefined values
    const cleanedData = Object.fromEntries(
      Object.entries(newData).filter(([, v]) => v !== undefined && v !== '')
    );
    onChange('data', Object.keys(cleanedData).length > 0 ? cleanedData : undefined);
  };

  const handleResponseVariableChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('response_variable', e.target.value === '' ? undefined : e.target.value);
  };

  return (
    <>
      {/* Action type selector */}
      <FormField label={t('nodes:actions.actionTypeLabel')} required>
        <Select value={actionType} onValueChange={handleActionTypeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="service">{t('nodes:actions.actionTypes.service')}</SelectItem>
            <SelectItem value="event">{t('nodes:actions.actionTypes.event')}</SelectItem>
            <SelectItem value="repeat">{t('nodes:actions.actionTypes.repeat')}</SelectItem>
            <SelectItem value="stop">{t('nodes:actions.actionTypes.stop')}</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      {actionType === 'stop' ? (
        <>
          {/* Stop action fields */}
          <FormField label={t('nodes:actions.stopMessageLabel')}>
            <Input
              type="text"
              value={stopMessage ?? ''}
              onChange={(e) => onChange('stop', e.target.value)}
              placeholder={t('nodes:actions.stopMessagePlaceholder')}
            />
          </FormField>
          <FormField label={t('nodes:actions.markAsError')}>
            <Switch
              checked={isStopError}
              onCheckedChange={(checked) => onChange('error', checked || undefined)}
            />
          </FormField>
        </>
      ) : actionType === 'event' ? (
        <>
          {/* Fire event fields */}
          <FormField label={t('nodes:actions.eventNameLabel')} required>
            <Input
              type="text"
              value={eventName}
              onChange={(e) => onChange('event', e.target.value || undefined)}
              placeholder={t('nodes:actions.eventNamePlaceholder')}
            />
            <FieldError message={getFieldError('event')} />
          </FormField>
        </>
      ) : actionType === 'repeat' ? (
        <ForEachEditor nodeId={node.id} items={forEachItems} onChange={handleForEachItemsChange} />
      ) : (
        <>
          {/* Call service fields */}
          <FormField label={t('nodes:actions.actionLabel')} required>
            <ServicePicker
              value={serviceName}
              onChange={handleServiceChange}
              placeholder={t('nodes:actions.selectAction')}
            />
            <FieldError message={getFieldError('service')} />
          </FormField>

          {/* Target: entities/devices/areas/labels, each a pill row with its own picker */}
          <FormField label={t('nodes:actions.targetLabel')}>
            <TargetEditor target={target} onChange={handleTargetChange} />
          </FormField>

          {/* Dynamic service fields */}
          <ServiceDataFields
            serviceFields={serviceFields}
            currentData={currentData}
            onChange={handleDataFieldChange}
          />

          {/* Response Variable (show if response exists, toggle if optional, always input if not) */}
          {serviceDefinition?.response && (
            <ResponseVariableField
              response={serviceDefinition.response}
              responseVariable={responseVariable}
              showResponseVariable={showResponseVariable}
              setShowResponseVariable={setShowResponseVariable}
              onChange={onChange}
              handleResponseVariableChange={handleResponseVariableChange}
            />
          )}
        </>
      )}
    </>
  );
}
