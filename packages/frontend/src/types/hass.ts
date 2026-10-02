import type { HomeAssistant as CustomCardHomeAssistant } from 'custom-card-helpers';
import type { HassServices } from 'home-assistant-js-websocket';

export type { Connection, HassConfig, HassEntity, HassService } from 'home-assistant-js-websocket';

/**
 * Device registry entry from Home Assistant
 */
export interface HassDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
}

export interface HomeAssistant extends Omit<CustomCardHomeAssistant, 'services' | 'themes'> {
  themes: { darkMode: boolean };
  services: HassServices;
  devices: Record<string, HassDevice>;
}

/**
 * What an automation and a script both store in Home Assistant
 */
interface StoredFlowConfig {
  alias?: string;
  description?: string;
  mode?: 'single' | 'restart' | 'queued' | 'parallel';
  max?: number;
  max_exceeded?: 'silent' | 'warning' | 'critical';
  variables?: Record<string, unknown>;
  trace?: { stored_traces?: number };
  [key: string]: unknown;
}

/**
 * Home Assistant automation configuration object
 */
export interface AutomationConfig extends StoredFlowConfig {
  id?: string;
  trigger?: unknown[];
  triggers?: unknown[];
  condition?: unknown[];
  conditions?: unknown[];
  action?: unknown[];
  actions?: unknown[];
  initial_state?: boolean;
  hide_entity?: boolean;
}

/**
 * Home Assistant script configuration object. A script has no triggers; it is stored under its
 * key (the part after `script.`), not under an `id` field.
 */
export interface ScriptConfig extends StoredFlowConfig {
  icon?: string;
  fields?: Record<string, unknown>;
  sequence?: unknown[];
}

export type FlowConfig = AutomationConfig | ScriptConfig;
