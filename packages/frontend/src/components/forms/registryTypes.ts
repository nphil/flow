/**
 * Registry entry shapes served by `useHass()` (packages/frontend/src/contexts/HassContext.tsx).
 * Named here (rather than derived via `ReturnType<typeof useHass>`) so picker components import
 * a concrete, owned type instead of coupling to the context module's inferred return shape.
 * Keep in sync with the identically-named interfaces in HassContext.tsx.
 */

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  labels?: string[];
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  name: string | null;
  original_name: string | null;
  labels?: string[];
}

export interface LabelRegistryEntry {
  label_id: string;
  name: string;
  icon: string | null;
  color: string | null;
}
