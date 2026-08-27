import type { HomeAssistant } from './hass';

declare global {
  interface Window {
    hass?: HomeAssistant;
    setHass?: (hass: HomeAssistant | undefined) => void;
    flowNarrow?: boolean;
    flowRoute?: unknown;
    flowPanel?: unknown;
  }
}
