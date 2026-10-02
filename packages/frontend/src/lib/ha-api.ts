import type { FlowKind } from '@flow/shared';
import { type FlowCatalogItem, mapEntityToCatalogItem, uniqueScriptKey } from '@/lib/flow-catalog';
import type { FlowConfig, HassEntity, HomeAssistant } from '@/types/hass';

export interface FlowMetadata {
  version: number;
  strategy: 'native' | 'state-machine';
  nodes: Record<string, unknown>;
  graph_id: string;
  graph_version: number;
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  [key: string]: unknown;
}

export interface EntityRegistryEntry {
  entity_id: string;
  unique_id?: string | null;
  area_id?: string | null;
  [key: string]: unknown;
}

export interface LabelRegistryEntry {
  label_id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  [key: string]: unknown;
}

export interface ZoneCatalogItem {
  entity_id: string;
  zone_id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  passive?: boolean;
}

/**
 * Terminal values HA's `script_execution_set()` can record on a stopped run
 * (see `homeassistant/helpers/trace.py`). `null` while a run is in progress.
 */
export type ScriptExecutionState =
  | 'finished'
  | 'aborted'
  | 'cancelled'
  | 'error'
  | 'failed_conditions'
  | 'failed_single'
  | 'failed_max_runs'
  | 'not_triggered'
  | 'disallowed_recursion_detected';

export interface TraceStep {
  path: string;
  timestamp: string;
  changed_variables?: Record<string, unknown>;
  // Shape varies by step type: conditions carry {result: boolean}, choose
  // carries {choice: number | 'default'}, if carries {choice: 'then'|'else'},
  // delay carries {delay: number, done: boolean}, a not-triggered trigger
  // step carries {reason: string, data?: Record<string, unknown>}.
  result?: Record<string, unknown>;
  error?: string;
  template_errors?: string[];
  child_id?: {
    domain: string;
    item_id: string;
    run_id: string;
  };
}

export interface FlowTrace {
  last_step: string | null;
  run_id: string;
  state: 'running' | 'stopped';
  script_execution: ScriptExecutionState | null;
  timestamp: {
    start: string;
    finish: string | null;
  };
  domain: string;
  item_id: string;
  trigger: string;
  trace: Record<string, TraceStep[]>;
  config: FlowConfig;
  context: {
    id: string;
    parent_id?: string;
    user_id?: string;
  };
  error?: string;
}

export interface TraceListItem {
  run_id: string;
  last_step: string | null;
  state: 'running' | 'stopped';
  script_execution: ScriptExecutionState | null;
  timestamp: {
    start: string;
    finish: string | null;
  };
  trigger?: string | null;
  domain: string;
  item_id: string;
  not_triggered?: boolean;
  error?: string;
}

/**
 * The body Home Assistant's config endpoint stores for an item: the config as built, plus the keys
 * Home Assistant requires. An automation is stored under an `id` with the plural
 * trigger/condition/action forms; a script has no `id` (its key is in the URL) and no triggers.
 */
function toStoredConfig(
  kind: FlowKind,
  flowId: string,
  config: FlowConfig
): Record<string, unknown> {
  if (kind === 'script') {
    return {
      ...config,
      alias: config.alias || flowId,
      description: config.description || '',
      mode: config.mode || 'single',
    };
  }

  // Spread all fields from config so nothing is accidentally stripped
  const { trigger, condition, action, ...rest } = config;
  return {
    ...rest,
    id: flowId,
    alias: config.alias || `Flow Automation ${flowId}`,
    description: config.description || '',
    triggers: trigger || config.triggers || [],
    conditions: condition || config.conditions || [],
    actions: action || config.actions || [],
    mode: config.mode || 'single',
    variables: config.variables || {},
  };
}

/**
 * Home Assistant API abstraction layer
 * Works in both custom panel mode (with hass object) and standalone mode
 */
export class HomeAssistantAPI {
  public hass: HomeAssistant | null = null;
  private baseUrl?: string;
  private token?: string;

  constructor(hass?: HomeAssistant, config?: { url?: string; token?: string }) {
    this.hass = hass || null;

    // Store base URL and token for REST API calls
    if (config?.url && config?.token) {
      this.baseUrl = config.url;
      this.token = config.token;
    } else if (typeof window !== 'undefined') {
      // In embedded mode, use current window location
      this.baseUrl = window.location.origin;
    }
  }

  /**
   * Update the hass reference (for when it changes)
   */
  updateHass(hass: HomeAssistant | null, config?: { url?: string; token?: string }) {
    this.hass = hass;

    // Update base URL and token if provided
    if (config?.url && config?.token) {
      this.baseUrl = config.url;
      this.token = config.token;
    } else if (typeof window !== 'undefined' && !this.baseUrl) {
      // In embedded mode, use current window location if not already set
      this.baseUrl = window.location.origin;
    }
  }

  /**
   * Check if we have a valid connection
   */
  isConnected(): boolean {
    if (!this.hass) return false;

    // Check for different possible API structures
    return !!(
      this.hass.connection ||
      this.hass.callApi ||
      this.hass.callService ||
      (this.hass.states && Object.keys(this.hass.states).length > 0)
    );
  }

  /**
   * Get all entity states
   */
  getStates(): Record<string, HassEntity> | null {
    if (!this.hass) return null;

    return this.hass.states;
  }

  /**
   * Get a specific entity state
   */
  getState(entityId: string): HassEntity | null {
    const states = this.getStates();
    return states?.[entityId] || null;
  }

  /**
   * Get all automation or script entities
   */
  getFlowEntities(kind: FlowKind): HassEntity[] {
    const states = this.getStates();
    if (!states) return [];

    return Object.values(states).filter((entity) => entity.entity_id.startsWith(`${kind}.`));
  }

  /**
   * Send a websocket message
   */
  async sendMessage(message: Record<string, unknown> & { type: string }): Promise<unknown> {
    if (!this.hass?.connection) {
      throw new Error('No Home Assistant connection available');
    }

    return await this.hass.connection.sendMessagePromise(message);
  }

  /**
   * Call a Home Assistant service
   */
  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callService) {
      // Use built-in service calling (custom panel mode)
      // Combine serviceData and target into data object for the interface
      const data = { ...serviceData, ...(target && { target }) };
      return await this.hass.callService(domain, service, data);
    }

    if (this.hass?.connection) {
      // Use websocket message
      return await this.sendMessage({
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
        target,
      });
    }

    throw new Error('No service calling method available');
  }

  /**
   * Execute a Home Assistant action
   * An action can be either a service call or other HA action types
   */
  async executeAction(action: {
    service?: string;
    data?: Record<string, unknown>;
    target?: Record<string, unknown>;
    [key: string]: unknown;
  }): Promise<unknown> {
    if (!action.service) {
      throw new Error('Action must have a service property');
    }

    const [domain, service] = action.service.split('.');
    if (!domain || !service) {
      throw new Error(`Invalid service format: ${action.service}`);
    }

    return await this.callService(domain, service, action.data, action.target);
  }

  /**
   * Call Home Assistant REST API
   */
  async callAPI(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callApi) {
      // Use built-in API calling (custom panel mode)
      return await this.hass.callApi(method, path, data);
    } else {
      // In standalone mode, we'd need to implement HTTP requests
      // For now, throw an error as this requires auth tokens
      throw new Error('REST API calls not supported in standalone mode');
    }
  }

  /**
   * Fetch data from Home Assistant REST API
   * Uses built-in callApi in embedded mode, or direct fetch in remote mode
   */
  private async fetchRestAPI(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callApi) {
      // Embedded mode - use built-in callApi

      return await this.hass.callApi(method, path, body);
    }

    // Remote/standalone mode - use fetch
    if (!this.baseUrl || !this.token) {
      console.error('Flow: No authentication configured', {
        baseUrl: this.baseUrl,
        hasToken: !!this.token,
      });
      throw new Error('No authentication configured for REST API');
    }

    const url = `${this.baseUrl}/api/${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Flow: REST API error response:', errorText);
      throw new Error(`REST API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get automation or script configurations
   */
  async getFlowConfigs(kind: FlowKind): Promise<FlowConfig[]> {
    try {
      // First try websocket approach
      if (this.hass?.connection) {
        try {
          const result = await this.sendMessage({
            type: `config/${kind}/list`,
          });
          if (Array.isArray(result)) {
            return result as FlowConfig[];
          }
        } catch (wsError) {
          console.warn('WebSocket %s list failed, trying alternative:', kind, wsError);
        }
      }

      // Alternative: Use entity states to get basic info
      return this.getFlowEntities(kind).map((entity) => ({
        id: entity.entity_id.replace(`${kind}.`, ''),
        alias:
          typeof entity.attributes.friendly_name === 'string'
            ? entity.attributes.friendly_name
            : entity.entity_id,
        description:
          typeof entity.attributes.description === 'string' ? entity.attributes.description : '',
      }));
    } catch (error) {
      console.error('Failed to get %s configs:', kind, error);
      return [];
    }
  }

  /**
   * Get a specific automation or script configuration. A script's id is its key.
   */
  async getFlowConfig(kind: FlowKind, flowId: string): Promise<FlowConfig | null> {
    try {
      // Try websocket approach first (only automations have a websocket getter)
      if (kind === 'automation' && this.hass?.connection) {
        try {
          const config = await this.sendMessage({
            type: 'config/automation/get',
            automation_id: flowId,
          });
          if (config) {
            return config as FlowConfig;
          }
        } catch (wsError) {
          console.warn('WebSocket automation get failed:', wsError);
        }
      }

      // REST API works for any automation with an `id:` field — both numeric
      // (UI-created) and string IDs (YAML-defined automations in automations.yaml) —
      // and for any script key.
      if (!flowId.startsWith(`${kind}.`)) {
        try {
          const config = await this.fetchRestAPI(`config/${kind}/config/${flowId}`);
          if (config) {
            return config as FlowConfig;
          }
        } catch (directError) {
          console.warn('REST API failed for %s %s:', kind, flowId, directError);
        }
      }

      // A script has no stand-in: a config rebuilt from entity states holds no steps, and saving
      // the empty script it opens as would overwrite the real one.
      if (kind === 'script') {
        return null;
      }

      // Fallback: get all configs and find the matching one
      const configs = await this.getFlowConfigs(kind);
      return (
        configs.find(
          (config) =>
            config.id === flowId || config.alias === flowId || `${kind}.${config.alias}` === flowId
        ) || null
      );
    } catch (error) {
      console.error('Flow: Failed to get %s config:', kind, error);
      return null;
    }
  }

  /**
   * Get automation or script config from trace (fallback method for getting config)
   */
  async getFlowConfigFromTrace(kind: FlowKind, flowId: string): Promise<FlowConfig | null> {
    try {
      // First get the list of traces
      const traces = await this.getFlowTraces(kind, flowId);
      if (!traces || traces.length === 0) {
        return null;
      }

      // Get the most recent trace details which includes config
      const traceDetails = await this.getFlowTraceDetails(kind, flowId, traces[0].run_id);
      return traceDetails?.config || null;
    } catch (error) {
      console.error('Flow: Failed to get %s config from trace:', kind, error);
      return null;
    }
  }

  /**
   * Get automation or script configuration with multiple fallback methods.
   * Falls back to extracting the config from the most recent trace when
   * the primary lookup returns null (e.g. when neither WebSocket nor REST
   * can serve the config).
   */
  async getFlowConfigWithFallback(kind: FlowKind, flowId: string): Promise<FlowConfig | null> {
    try {
      const primary = await this.getFlowConfig(kind, flowId);
      if (primary) {
        return primary;
      }
      return await this.getFlowConfigFromTrace(kind, flowId);
    } catch (error) {
      console.error('Flow: Failed to get %s config with fallback:', kind, error);
      return null;
    }
  }

  /**
   * The id a new item is stored under. An automation gets a numeric id like Home Assistant uses; a
   * script gets the slug of its alias, made unique against every script that exists (a POST to an
   * existing key overwrites that script).
   */
  private async newFlowId(kind: FlowKind, config: FlowConfig): Promise<string> {
    if (kind === 'automation') {
      return typeof config.id === 'string' && config.id ? config.id : Date.now().toString();
    }
    const existing = await this.getFlowCatalog('script');
    return uniqueScriptKey(
      config.alias ?? '',
      existing.map((item) => item.flow_id)
    );
  }

  /**
   * Store a config under its id. Home Assistant's config endpoint creates the item or overwrites
   * the one with that id; it has no PUT for updates.
   */
  private async writeFlowConfig(kind: FlowKind, flowId: string, config: FlowConfig): Promise<void> {
    await this.fetchRestAPI(
      `config/${kind}/config/${flowId}`,
      'POST',
      toStoredConfig(kind, flowId, config)
    );
  }

  /**
   * Reload automations so a newly stored one is active
   */
  private async reloadAutomations(): Promise<void> {
    if (this.hass?.callService) {
      await this.hass.callService('automation', 'reload', {});
      return;
    }

    if (this.hass?.connection) {
      await this.sendMessage({
        type: 'call_service',
        domain: 'automation',
        service: 'reload',
      });
      return;
    }

    throw new Error('No working Home Assistant connection method found');
  }

  /**
   * Create a new automation or script in Home Assistant; returns its id
   */
  async createFlow(kind: FlowKind, config: FlowConfig): Promise<string> {
    try {
      const flowId = await this.newFlowId(kind, config);

      // Step 1: Create/save the configuration using REST API
      try {
        await this.writeFlowConfig(kind, flowId, config);
      } catch (saveError) {
        console.error('Flow: Failed to save %s config:', kind, saveError);
        throw new Error(
          `Failed to save ${kind} config: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`
        );
      }

      // Step 2: Home Assistant reloads scripts by itself after a write; automations are
      // reloaded here to make the new one active
      if (kind === 'automation') {
        await this.reloadAutomations();
      }
      return flowId;
    } catch (error) {
      console.error('Flow: Failed to create %s:', kind, error);
      throw new Error(
        `Failed to create ${kind}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update an existing automation or script in Home Assistant
   */
  async updateFlow(kind: FlowKind, flowId: string, config: FlowConfig): Promise<void> {
    try {
      await this.writeFlowConfig(kind, flowId, config);
    } catch (error) {
      console.error('Flow: Failed to update %s:', kind, error);
      throw new Error(
        `Failed to update ${kind}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete an automation or script from Home Assistant
   */
  async deleteFlow(kind: FlowKind, flowId: string): Promise<void> {
    try {
      await this.fetchRestAPI(`config/${kind}/config/${flowId}`, 'DELETE');
    } catch (error) {
      console.error('Flow: Failed to delete %s:', kind, error);
      throw new Error(
        `Failed to delete ${kind}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if an automation or script with the given alias already exists
   */
  async flowExistsByAlias(kind: FlowKind, alias: string): Promise<boolean> {
    try {
      const configs = await this.getFlowConfigs(kind);
      return configs.some((config) => config.alias === alias);
    } catch (error) {
      console.error('Flow: Failed to check %s existence:', kind, error);
      return false;
    }
  }

  /**
   * Get unique alias by appending number if needed
   */
  async getUniqueFlowAlias(kind: FlowKind, baseAlias: string): Promise<string> {
    try {
      let alias = baseAlias;
      let counter = 1;

      while (await this.flowExistsByAlias(kind, alias)) {
        alias = `${baseAlias} (${counter})`;
        counter++;
      }

      return alias;
    } catch (error) {
      console.error('Flow: Failed to get unique %s alias:', kind, error);
      return baseAlias;
    }
  }

  /**
   * Run an automation (skipping its conditions, as a test run) or a script
   */
  async runFlow(kind: FlowKind, entityId: string): Promise<void> {
    if (kind === 'script') {
      await this.callService('script', 'turn_on', { entity_id: entityId });
      return;
    }
    await this.callService('automation', 'trigger', {
      entity_id: entityId,
      skip_condition: true,
    });
  }

  /**
   * Turn automation on/off
   */
  async setAutomationState(entityId: string, enabled: boolean): Promise<void> {
    const service = enabled ? 'turn_on' : 'turn_off';
    await this.callService('automation', service, {
      entity_id: entityId,
    });
  }

  /**
   * Get areas
   */
  async getAreas(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/area_registry/list' });
    } catch (error) {
      console.error('Failed to get areas:', error);
      return [];
    }
  }

  /**
   * Get devices
   */
  async getDevices(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/device_registry/list' });
    } catch (error) {
      console.error('Failed to get devices:', error);
      return [];
    }
  }

  /**
   * Get entities registry
   */
  async getEntities(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/entity_registry/list' });
    } catch (error) {
      console.error('Failed to get entities:', error);
      return [];
    }
  }

  /**
   * Get labels registry
   */
  async getLabels(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/label_registry/list' });
    } catch (error) {
      console.error('Failed to get labels:', error);
      return [];
    }
  }

  /**
   * Get zones from current states
   */
  async getZones(): Promise<ZoneCatalogItem[]> {
    try {
      const states = this.getStates();
      if (!states) return [];

      return Object.values(states)
        .filter((entity) => entity.entity_id.startsWith('zone.'))
        .map((entity) => {
          const zoneId = entity.entity_id.replace('zone.', '');
          return {
            entity_id: entity.entity_id,
            zone_id: zoneId,
            name:
              typeof entity.attributes.friendly_name === 'string'
                ? entity.attributes.friendly_name
                : zoneId,
            latitude:
              typeof entity.attributes.latitude === 'number'
                ? entity.attributes.latitude
                : undefined,
            longitude:
              typeof entity.attributes.longitude === 'number'
                ? entity.attributes.longitude
                : undefined,
            radius:
              typeof entity.attributes.radius === 'number' ? entity.attributes.radius : undefined,
            passive:
              typeof entity.attributes.passive === 'boolean'
                ? entity.attributes.passive
                : undefined,
          };
        });
    } catch (error) {
      console.error('Failed to get zones:', error);
      return [];
    }
  }

  /**
   * Build a normalized automation or script catalog for import/explorer views
   */
  async getFlowCatalog(kind: FlowKind): Promise<FlowCatalogItem[]> {
    try {
      const entityRegistryResult = await this.getEntities();
      const entityRegistry = Array.isArray(entityRegistryResult)
        ? (entityRegistryResult as EntityRegistryEntry[])
        : [];

      const registryByEntityId = new Map<string, EntityRegistryEntry>();
      for (const entry of entityRegistry) {
        if (entry.entity_id) {
          registryByEntityId.set(entry.entity_id, entry);
        }
      }

      return this.getFlowEntities(kind).flatMap((entity) => {
        const entry = registryByEntityId.get(entity.entity_id);
        const item = mapEntityToCatalogItem(kind, entity, {
          areaId: entry?.area_id ?? undefined,
          uniqueId: entry?.unique_id,
        });
        return item ? [item] : [];
      });
    } catch (error) {
      console.error('Failed to build %s catalog:', kind, error);
      return [];
    }
  }

  /**
   * Get multiple automation or script configurations with bounded concurrency
   */
  async getFlowConfigsBatch(
    kind: FlowKind,
    ids: string[],
    maxConcurrency = 4
  ): Promise<Record<string, FlowConfig | null>> {
    const flowIds = Array.from(new Set(ids.filter(Boolean)));
    const results: Record<string, FlowConfig | null> = {};
    if (flowIds.length === 0) {
      return results;
    }

    const queue = [...flowIds];
    const workerCount = Math.max(1, Math.min(maxConcurrency, queue.length));

    const workers = Array.from({ length: workerCount }).map(async () => {
      while (queue.length > 0) {
        const nextId = queue.shift();
        if (!nextId) {
          continue;
        }

        try {
          results[nextId] = await this.getFlowConfigWithFallback(kind, nextId);
        } catch (error) {
          console.warn('Failed to fetch %s config for %s:', kind, nextId, error);
          results[nextId] = null;
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Get services
   */
  async getServices(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'get_services' });
    } catch (error) {
      console.error('Failed to get services:', error);
      return {};
    }
  }

  /**
   * Validate automation config
   */
  async validateAutomationConfig(config: {
    trigger?: Record<string, unknown>[];
    condition?: Record<string, unknown>[];
    action?: Record<string, unknown>[];
  }): Promise<unknown> {
    try {
      return await this.sendMessage({
        type: 'validate_config',
        ...config,
      });
    } catch (error) {
      console.error('Failed to validate config:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  /**
   * Get the trace list of an automation or script
   */
  async getFlowTraces(kind: FlowKind, flowId: string): Promise<TraceListItem[]> {
    try {
      const result = await this.sendMessage({
        type: 'trace/list',
        domain: kind,
        item_id: flowId,
      });
      return (Array.isArray(result) ? result : []) as TraceListItem[];
    } catch (error) {
      console.error('Failed to get %s traces:', kind, error);
      return [];
    }
  }

  /**
   * Get specific trace details of an automation or script run
   */
  async getFlowTraceDetails(
    kind: FlowKind,
    flowId: string,
    runId: string
  ): Promise<FlowTrace | null> {
    try {
      const result = await this.sendMessage({
        type: 'trace/get',
        domain: kind,
        item_id: flowId,
        run_id: runId,
      });
      return (result as FlowTrace) || null;
    } catch (error) {
      console.error('Failed to get %s trace details:', kind, error);
      return null;
    }
  }

  /**
   * Get a map of context id -> run for every stored trace. Used to correlate
   * an `automation_triggered` event (whose payload has no run_id) with the
   * trace it produced via the event's `context.id`.
   */
  async getTraceContexts(): Promise<
    Record<string, { run_id: string; domain: string; item_id: string }>
  > {
    try {
      const result = await this.sendMessage({ type: 'trace/contexts' });
      return (result as Record<string, { run_id: string; domain: string; item_id: string }>) || {};
    } catch (error) {
      console.error('Failed to get trace contexts:', error);
      return {};
    }
  }
}

// Global API instance
let haAPI: HomeAssistantAPI | null = null;

/**
 * Get the global Home Assistant API instance
 */
export function getHomeAssistantAPI(
  hass?: HomeAssistant,
  config?: { url?: string; token?: string }
): HomeAssistantAPI {
  if (!haAPI) {
    haAPI = new HomeAssistantAPI(hass, config);
  } else {
    // Only update if we have a valid hass object or if the current one is null/empty
    const shouldUpdate =
      hass &&
      (!haAPI.hass || !haAPI.isConnected() || (hass.states && Object.keys(hass.states).length > 0));

    if (shouldUpdate) {
      haAPI.updateHass(hass ?? null, config);
    }
  }
  return haAPI;
}

/**
 * Initialize API for standalone mode
 */
export function initializeStandaloneAPI(): HomeAssistantAPI {
  haAPI = new HomeAssistantAPI();
  return haAPI;
}

/**
 * Reset the API instance (useful for testing)
 */
export function resetAPI(): void {
  haAPI = null;
}
