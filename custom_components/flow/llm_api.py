"""LLM API for Flow: exposes automation management tools to MCP/LLM clients.

Registers a custom homeassistant.helpers.llm.API ("Flow Automations", id
DOMAIN) via llm.async_register_api. Home Assistant's core mcp_server
integration discovers any such registered API automatically (it lists
llm.async_get_apis(hass) in its own config flow and looks tools up through
llm.async_get_api at call time) and exposes it over MCP - this module adds
no server process and no new auth surface of its own.

Persistence mirrors homeassistant/components/config/automation.py
(EditAutomationConfigView/EditIdBasedConfigView) exactly: automations.yaml is
read/written with the same homeassistant.util.yaml helpers, entries keep the
same key ordering, and mutations validate with the same
homeassistant.components.automation.config.async_validate_config_item before
anything is written, then reload through the same automation.reload service
call. See the Flow LLM API report for file+line citations against Home
Assistant 2026.6.0 core.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Final

import voluptuous as vol
from voluptuous.humanize import humanize_error

from homeassistant.components.automation import (
    ATTR_LAST_TRIGGERED,
    CONF_SKIP_CONDITION,
    DOMAIN as AUTOMATION_DOMAIN,
    SERVICE_TRIGGER,
)
from homeassistant.components.automation.config import async_validate_config_item
from homeassistant.components.trace.util import async_get_trace, async_list_traces
from homeassistant.config import AUTOMATION_CONFIG_PATH
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_MODE,
    CONF_ID,
    SERVICE_RELOAD,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_ON,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er, llm
from homeassistant.helpers.json import ExtendedJSONEncoder
from homeassistant.util.file import write_utf8_file_atomic
from homeassistant.util.json import JsonObjectType
from homeassistant.util.yaml import dump as yaml_dump, load_yaml, parse_yaml

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# Same key-ordering EditAutomationConfigView._write_value uses so entries we
# write read the same way entries written by the native/Flow UI editors do.
_ORDERED_KEYS: Final = (
    "alias",
    "description",
    "triggers",
    "trigger",
    "conditions",
    "condition",
    "actions",
    "action",
)

# Serializes flow_create_automation/flow_update_automation/flow_delete_automation
# read-modify-write cycles against automations.yaml across concurrent tool
# calls. This does not coordinate with the core config API's own
# EditAutomationConfigView (a separate HomeAssistantView instance with its own
# mutation_lock) or with Flow's frontend, both of which write the same file
# over plain HTTP requests; an edit from those surfaces landing in the exact
# same instant as a tool call is no less safe than two concurrent HTTP
# requests to the config API would be today.
_WRITE_LOCK: Final = asyncio.Lock()


def _find_automation(
    automations: list[dict[str, Any]], automation_id: str
) -> dict[str, Any] | None:
    """Find an automation's raw config dict by its 'id' field."""
    for entry in automations:
        existing_id = entry.get(CONF_ID)
        if existing_id is not None and str(existing_id) == automation_id:
            return entry
    return None


def _ordered_automation_value(
    automation_id: str, new_value: dict[str, Any]
) -> dict[str, Any]:
    """Build the stored dict the same way EditAutomationConfigView._write_value does."""
    updated_value: dict[str, Any] = {CONF_ID: automation_id}
    for key in _ORDERED_KEYS:
        if key in new_value:
            updated_value[key] = new_value[key]
    updated_value.update(new_value)
    return updated_value


def _parse_automation_yaml(yaml_text: str) -> dict[str, Any]:
    """Parse a tool-supplied automation YAML string into a plain dict."""
    try:
        parsed = parse_yaml(yaml_text)
    except HomeAssistantError as err:
        raise HomeAssistantError(f"Automation YAML could not be parsed: {err}") from err
    if not isinstance(parsed, dict):
        raise HomeAssistantError(
            "Automation YAML must be a single mapping with keys like "
            "alias/triggers/actions, not a list or scalar."
        )
    return dict(parsed)


def _json_safe(data: Any) -> Any:
    """Round-trip data through Home Assistant's extended JSON encoder.

    homeassistant.components.mcp_server.server.call_tool serializes tool
    results with plain json.dumps(tool_response, ensure_ascii=False) - no
    custom encoder - so it cannot handle the datetime/Context objects that
    trace and state data commonly contain. Flatten them here the same way
    homeassistant.components.trace.websocket_api does for the same data
    (json.dumps(..., cls=ExtendedJSONEncoder)) before they ever reach it.
    """
    return json.loads(json.dumps(data, cls=ExtendedJSONEncoder, allow_nan=False))


def _ok(result: dict[str, Any]) -> JsonObjectType:
    """Wrap a successful result in the {success, result} shape HA's llm tools use.

    Matches ActionTool/CalendarGetEventsTool/TodoGetItemsTool/GetDateTimeTool
    in homeassistant/helpers/llm.py, which all return either
    {"success": True, "result": ...} or {"success": False, "error": ...}.
    """
    return {"success": True, "result": _json_safe(result)}


def _entity_id_for(hass: HomeAssistant, automation_id: str) -> str | None:
    """Resolve an automation's entity_id from its config id via the entity registry."""
    return er.async_get(hass).async_get_entity_id(
        AUTOMATION_DOMAIN, AUTOMATION_DOMAIN, automation_id
    )


def _entity_id_for_or_raise(hass: HomeAssistant, automation_id: str) -> str:
    """Resolve an entity_id or raise an actionable error if there is none."""
    entity_id = _entity_id_for(hass, automation_id)
    if entity_id is None:
        raise HomeAssistantError(
            f"Automation '{automation_id}' has no registered entity. Use "
            "flow_get_automation to confirm the id exists and the "
            "configuration is valid."
        )
    return entity_id


async def _async_read_automations(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Read automations.yaml the same way components/config/automation.py does."""
    path = hass.config.path(AUTOMATION_CONFIG_PATH)

    def _read() -> list[dict[str, Any]]:
        if not os.path.isfile(path):
            return []
        loaded = load_yaml(path)
        if loaded is None:
            return []
        if not isinstance(loaded, list):
            raise HomeAssistantError(
                f"{AUTOMATION_CONFIG_PATH} does not contain a YAML list of "
                "automations; refusing to read or modify it automatically."
            )
        return loaded

    return await hass.async_add_executor_job(_read)


async def _async_write_automations(
    hass: HomeAssistant, automations: list[dict[str, Any]]
) -> None:
    """Write automations.yaml the same way components/config/automation.py does."""
    path = hass.config.path(AUTOMATION_CONFIG_PATH)

    def _write() -> None:
        write_utf8_file_atomic(path, yaml_dump(automations))

    await hass.async_add_executor_job(_write)


async def _async_validation_errors(
    hass: HomeAssistant, automation_id: str, config: dict[str, Any]
) -> list[str]:
    """Validate an automation config dict, returning human-readable errors."""
    try:
        await async_validate_config_item(hass, automation_id, config)
    except vol.Invalid as err:
        return [humanize_error(config, err)]
    except HomeAssistantError as err:
        return [str(err)]
    return []


async def _async_reload_automation(
    hass: HomeAssistant, llm_context: llm.LLMContext, automation_id: str
) -> None:
    """Reload one automation the same way the config API's post_write_hook does."""
    await hass.services.async_call(
        AUTOMATION_DOMAIN,
        SERVICE_RELOAD,
        {CONF_ID: automation_id},
        context=llm_context.context,
        blocking=True,
    )


async def _async_list_automations(hass: HomeAssistant) -> dict[str, Any]:
    automations = await _async_read_automations(hass)
    ent_reg = er.async_get(hass)
    summaries: list[dict[str, Any]] = []
    for raw in automations:
        raw_id = raw.get(CONF_ID)
        if raw_id is None:
            continue
        automation_id = str(raw_id)
        entity_id = ent_reg.async_get_entity_id(
            AUTOMATION_DOMAIN, AUTOMATION_DOMAIN, automation_id
        )
        state = hass.states.get(entity_id) if entity_id else None
        summaries.append(
            {
                "automation_id": automation_id,
                "alias": raw.get("alias"),
                "description": raw.get("description"),
                "enabled": state.state == STATE_ON if state else None,
                "last_triggered": (
                    state.attributes.get(ATTR_LAST_TRIGGERED) if state else None
                ),
                "mode": state.attributes.get(ATTR_MODE) if state else None,
            }
        )
    return {"count": len(summaries), "automations": summaries}


async def _async_get_automation(
    hass: HomeAssistant, automation_id: str
) -> dict[str, Any]:
    automations = await _async_read_automations(hass)
    raw = _find_automation(automations, automation_id)
    if raw is None:
        raise HomeAssistantError(f"Automation '{automation_id}' not found")
    entity_id = _entity_id_for(hass, automation_id)
    state = hass.states.get(entity_id) if entity_id else None
    return {
        "automation_id": automation_id,
        "entity_id": entity_id,
        "enabled": state.state == STATE_ON if state else None,
        "yaml": yaml_dump(raw),
    }


async def _async_create_automation(
    hass: HomeAssistant, llm_context: llm.LLMContext, yaml_text: str
) -> dict[str, Any]:
    parsed = _parse_automation_yaml(yaml_text)
    warnings: list[str] = []
    requested_id = parsed.get(CONF_ID)

    async with _WRITE_LOCK:
        automations = await _async_read_automations(hass)

        if requested_id is not None:
            automation_id = str(requested_id)
            if _find_automation(automations, automation_id) is not None:
                raise HomeAssistantError(
                    f"Automation id '{automation_id}' already exists; use "
                    "flow_update_automation to modify it."
                )
        else:
            automation_id = str(int(time.time() * 1000))
            warnings.append(
                f"No 'id' present in the supplied YAML; assigned id '{automation_id}'."
            )
        parsed[CONF_ID] = automation_id

        errors = await _async_validation_errors(hass, automation_id, parsed)
        if errors:
            raise HomeAssistantError("Automation config is invalid: " + "; ".join(errors))

        automations.append(_ordered_automation_value(automation_id, parsed))
        await _async_write_automations(hass, automations)

    await _async_reload_automation(hass, llm_context, automation_id)
    _LOGGER.info("Created automation '%s' via the Flow Automations LLM API", automation_id)
    return {
        "automation_id": automation_id,
        "entity_id": _entity_id_for(hass, automation_id),
        "warnings": warnings,
    }


async def _async_update_automation(
    hass: HomeAssistant,
    llm_context: llm.LLMContext,
    automation_id: str,
    yaml_text: str,
) -> dict[str, Any]:
    parsed = _parse_automation_yaml(yaml_text)
    warnings: list[str] = []

    embedded_id = parsed.get(CONF_ID)
    if embedded_id is not None and str(embedded_id) != automation_id:
        warnings.append(
            f"YAML contained id '{embedded_id}', which differs from automation_id "
            f"'{automation_id}'; the automation_id argument takes precedence."
        )
    parsed[CONF_ID] = automation_id

    async with _WRITE_LOCK:
        automations = await _async_read_automations(hass)
        if _find_automation(automations, automation_id) is None:
            raise HomeAssistantError(
                f"Automation '{automation_id}' not found; use "
                "flow_create_automation to create it."
            )

        errors = await _async_validation_errors(hass, automation_id, parsed)
        if errors:
            raise HomeAssistantError("Automation config is invalid: " + "; ".join(errors))

        updated_value = _ordered_automation_value(automation_id, parsed)
        automations = [
            updated_value if str(entry.get(CONF_ID)) == automation_id else entry
            for entry in automations
        ]
        await _async_write_automations(hass, automations)

    await _async_reload_automation(hass, llm_context, automation_id)
    _LOGGER.info("Updated automation '%s' via the Flow Automations LLM API", automation_id)
    return {
        "automation_id": automation_id,
        "entity_id": _entity_id_for(hass, automation_id),
        "warnings": warnings,
    }


async def _async_delete_automation(
    hass: HomeAssistant, automation_id: str
) -> dict[str, Any]:
    async with _WRITE_LOCK:
        automations = await _async_read_automations(hass)
        if _find_automation(automations, automation_id) is None:
            raise HomeAssistantError(f"Automation '{automation_id}' not found")
        automations = [
            entry for entry in automations if str(entry.get(CONF_ID)) != automation_id
        ]
        await _async_write_automations(hass, automations)

    # Mirror components/config/automation.py's post_write_hook for deletes:
    # it only removes the entity registry entry, no automation.reload call.
    # That is enough - Entity's registry-updated listener (see
    # homeassistant/helpers/entity.py Entity._async_registry_updated) calls
    # self.async_remove() for every entity, including automations, whenever
    # its registry entry is removed, which detaches the automation's
    # triggers via AutomationEntity.async_will_remove_from_hass.
    entity_id = _entity_id_for(hass, automation_id)
    if entity_id is not None:
        er.async_get(hass).async_remove(entity_id)

    _LOGGER.info("Deleted automation '%s' via the Flow Automations LLM API", automation_id)
    return {"automation_id": automation_id, "entity_id": entity_id}


async def _async_set_enabled(
    hass: HomeAssistant,
    llm_context: llm.LLMContext,
    automation_id: str,
    enabled: bool,
) -> dict[str, Any]:
    entity_id = _entity_id_for_or_raise(hass, automation_id)
    await hass.services.async_call(
        AUTOMATION_DOMAIN,
        SERVICE_TURN_ON if enabled else SERVICE_TURN_OFF,
        {ATTR_ENTITY_ID: entity_id},
        context=llm_context.context,
        blocking=True,
    )
    return {"automation_id": automation_id, "entity_id": entity_id, "enabled": enabled}


async def _async_trigger_automation(
    hass: HomeAssistant,
    llm_context: llm.LLMContext,
    automation_id: str,
    skip_conditions: bool,
) -> dict[str, Any]:
    entity_id = _entity_id_for_or_raise(hass, automation_id)
    await hass.services.async_call(
        AUTOMATION_DOMAIN,
        SERVICE_TRIGGER,
        {ATTR_ENTITY_ID: entity_id, CONF_SKIP_CONDITION: skip_conditions},
        context=llm_context.context,
        blocking=True,
    )
    return {
        "automation_id": automation_id,
        "entity_id": entity_id,
        "skip_conditions": skip_conditions,
    }


async def _async_list_traces(hass: HomeAssistant, automation_id: str) -> dict[str, Any]:
    key = f"{AUTOMATION_DOMAIN}.{automation_id}"
    try:
        traces = await async_list_traces(hass, AUTOMATION_DOMAIN, key)
    except KeyError:
        traces = []
    return {"automation_id": automation_id, "traces": traces}


async def _async_get_trace(
    hass: HomeAssistant, automation_id: str, run_id: str
) -> dict[str, Any]:
    key = f"{AUTOMATION_DOMAIN}.{automation_id}"
    try:
        return await async_get_trace(hass, key, run_id)
    except KeyError as err:
        raise HomeAssistantError(
            f"No trace found for automation '{automation_id}' run '{run_id}'. "
            "Use flow_list_traces to see available run ids."
        ) from err


async def _async_validate_automation(
    hass: HomeAssistant, yaml_text: str
) -> dict[str, Any]:
    try:
        parsed = _parse_automation_yaml(yaml_text)
    except HomeAssistantError as err:
        return {"ok": False, "errors": [str(err)]}

    automation_id = str(parsed.get(CONF_ID) or "validate-only")
    parsed[CONF_ID] = automation_id
    errors = await _async_validation_errors(hass, automation_id, parsed)
    return {"ok": not errors, "errors": errors}


class FlowListAutomationsTool(llm.Tool):
    """List every automation with its id, alias, description and live state."""

    name = "flow_list_automations"
    description = (
        "List every Home Assistant automation with its id, alias, description, "
        "enabled state, last trigger time, and execution mode. Call this first "
        "to discover which automations exist before inspecting or editing one."
    )
    parameters = vol.Schema({})

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        self.parameters(tool_input.tool_args)
        return _ok(await _async_list_automations(hass))


class FlowGetAutomationTool(llm.Tool):
    """Get one automation's full YAML config, entity_id and enabled state."""

    name = "flow_get_automation"
    description = (
        "Get one automation's full configuration as Home Assistant automation "
        "YAML, plus its entity_id and whether it is currently enabled."
    )
    parameters = vol.Schema(
        {
            vol.Required(
                "automation_id",
                description=(
                    "The automation's stable id (see flow_list_automations), "
                    "not its entity_id."
                ),
            ): cv.string,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_get_automation(hass, args["automation_id"]))


class FlowCreateAutomationTool(llm.Tool):
    """Create a new automation from YAML, validated before saving."""

    name = "flow_create_automation"
    description = (
        "Create a new Home Assistant automation from YAML. The YAML is "
        "validated with Home Assistant's own automation schema before "
        "anything is saved; on success it is written to automations.yaml and "
        "reloaded. If the YAML's 'id' already exists this fails - use "
        "flow_update_automation instead."
    )
    parameters = vol.Schema(
        {
            vol.Required(
                "yaml",
                description=(
                    "A single Home Assistant automation as YAML text (alias, "
                    "description, triggers, conditions, actions, mode, etc.) "
                    "- the same schema used in automations.yaml. Omit 'id' to "
                    "have one assigned automatically."
                ),
            ): cv.string,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_create_automation(hass, llm_context, args["yaml"]))


class FlowUpdateAutomationTool(llm.Tool):
    """Replace an existing automation's YAML config, validated before saving."""

    name = "flow_update_automation"
    description = (
        "Replace an existing automation's configuration with new YAML. The "
        "automation must already exist (see flow_list_automations) - use "
        "flow_create_automation to make a new one. The YAML is validated "
        "before saving; nothing is written if it is invalid."
    )
    parameters = vol.Schema(
        {
            vol.Required(
                "automation_id", description="The id of the automation to replace."
            ): cv.string,
            vol.Required(
                "yaml",
                description=(
                    "The automation's new full YAML config, the same schema "
                    "used in automations.yaml."
                ),
            ): cv.string,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(
            await _async_update_automation(
                hass, llm_context, args["automation_id"], args["yaml"]
            )
        )


class FlowDeleteAutomationTool(llm.Tool):
    """Permanently delete an automation."""

    name = "flow_delete_automation"
    description = (
        "Permanently delete an automation from automations.yaml and stop it "
        "from running. This cannot be undone."
    )
    parameters = vol.Schema({vol.Required("automation_id"): cv.string})

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_delete_automation(hass, args["automation_id"]))


class FlowSetAutomationEnabledTool(llm.Tool):
    """Turn an automation on or off without changing its configuration."""

    name = "flow_set_automation_enabled"
    description = (
        "Turn an automation on or off without changing its configuration "
        "(the same as the enable/disable toggle in the UI). Disabled "
        "automations stay in automations.yaml but will not trigger."
    )
    parameters = vol.Schema(
        {
            vol.Required("automation_id"): cv.string,
            vol.Required(
                "enabled",
                description="true to enable/turn on, false to disable/turn off.",
            ): cv.boolean,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(
            await _async_set_enabled(
                hass, llm_context, args["automation_id"], args["enabled"]
            )
        )


class FlowTriggerAutomationTool(llm.Tool):
    """Manually run an automation right now."""

    name = "flow_trigger_automation"
    description = (
        "Manually run an automation right now, as if it had triggered "
        "normally. By default its conditions are skipped (matching the "
        "'Run' button in the UI); set skip_conditions to false to require "
        "its conditions to pass first."
    )
    parameters = vol.Schema(
        {
            vol.Required("automation_id"): cv.string,
            vol.Optional(
                "skip_conditions",
                default=True,
                description=(
                    "If true (default), run the actions immediately without "
                    "checking conditions. If false, conditions are evaluated "
                    "first and the actions only run if they pass."
                ),
            ): cv.boolean,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(
            await _async_trigger_automation(
                hass, llm_context, args["automation_id"], args["skip_conditions"]
            )
        )


class FlowListTracesTool(llm.Tool):
    """List recent execution runs recorded for an automation."""

    name = "flow_list_traces"
    description = (
        "List recent execution runs (traces) recorded for an automation: run "
        "id, when each started/finished, its outcome, and the last step "
        "reached. Use flow_get_trace with a run_id from this list for full "
        "step-by-step detail."
    )
    parameters = vol.Schema({vol.Required("automation_id"): cv.string})

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_list_traces(hass, args["automation_id"]))


class FlowGetTraceTool(llm.Tool):
    """Get the full step-by-step trace for one automation run."""

    name = "flow_get_trace"
    description = (
        "Get the full step-by-step execution trace for one automation run: "
        "the path taken through triggers/conditions/actions, timestamps, "
        "variables, and any error - exactly as shown in the Home Assistant "
        "trace viewer. Get run_id values from flow_list_traces."
    )
    parameters = vol.Schema(
        {
            vol.Required("automation_id"): cv.string,
            vol.Required(
                "run_id", description="A run id returned by flow_list_traces."
            ): cv.string,
        }
    )

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_get_trace(hass, args["automation_id"], args["run_id"]))


class FlowValidateAutomationTool(llm.Tool):
    """Check whether automation YAML is valid, without saving anything."""

    name = "flow_validate_automation"
    description = (
        "Check whether a piece of automation YAML is valid Home Assistant "
        "automation config, without saving anything. Returns ok=true if it "
        "would be accepted by flow_create_automation/flow_update_automation, "
        "or ok=false with a list of human-readable errors."
    )
    parameters = vol.Schema({vol.Required("yaml"): cv.string})

    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        args = self.parameters(tool_input.tool_args)
        return _ok(await _async_validate_automation(hass, args["yaml"]))


_TOOLS: Final[tuple[llm.Tool, ...]] = (
    FlowListAutomationsTool(),
    FlowGetAutomationTool(),
    FlowCreateAutomationTool(),
    FlowUpdateAutomationTool(),
    FlowDeleteAutomationTool(),
    FlowSetAutomationEnabledTool(),
    FlowTriggerAutomationTool(),
    FlowListTracesTool(),
    FlowGetTraceTool(),
    FlowValidateAutomationTool(),
)


def _api_prompt(automation_count: int) -> str:
    """Build the Flow Automations API prompt text."""
    plural = "" if automation_count == 1 else "s"
    tool_names = ", ".join(tool.name for tool in _TOOLS)
    return (
        "You can inspect and manage this Home Assistant instance's automations "
        "with the tools below. Automation configs are standard Home Assistant "
        "automation YAML - the same schema used by automations.yaml and the "
        "built-in automation editor - so read and write them as plain YAML "
        "text, not a proprietary format. automation_id always means the "
        "automation's stable 'id' field, not its entity_id. "
        "flow_create_automation and flow_update_automation validate the YAML "
        "with Home Assistant's own automation schema before saving and raise "
        "a descriptive error without saving anything if it is invalid; call "
        "flow_validate_automation first to check YAML without saving it. "
        f"This instance currently has {automation_count} automation{plural} "
        f"defined. Tools: {tool_names}."
    )


class FlowLLMAPI(llm.API):
    """LLM API exposing Flow's automation management tools ("Flow Automations")."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the API."""
        super().__init__(hass=hass, id=DOMAIN, name="Flow Automations")

    async def async_get_api_instance(
        self, llm_context: llm.LLMContext
    ) -> llm.APIInstance:
        """Return the instance of the API."""
        automations = await _async_read_automations(self.hass)
        return llm.APIInstance(
            api=self,
            api_prompt=_api_prompt(len(automations)),
            llm_context=llm_context,
            tools=list(_TOOLS),
        )
