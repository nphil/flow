"""Flow - Visual automation editor for Home Assistant."""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.typing import ConfigType

from .panel import async_register_panel, async_unregister_panel

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Flow component."""
    # This will be called when the integration is loaded
    # But actual setup happens in async_setup_entry
    return True


async def async_setup_entry(hass: HomeAssistant, entry) -> bool:
    """Set up Flow from a config entry."""

    # Register the panel (frontend)
    await async_register_panel(hass)

    entry.runtime_data = _register_flow_llm_api(hass)

    _LOGGER.info("Flow integration set up successfully")

    return True


def _register_flow_llm_api(hass: HomeAssistant):
    """Register the "Flow Automations" LLM API and return its unregister callable.

    Older Home Assistant releases do not ship homeassistant.helpers.llm or
    its async_register_api registration hook (it was added for the Assist
    API/MCP work). Skip registration gracefully in that case - the rest of
    the integration (panel, config flow) must still set up normally.
    """
    try:
        from homeassistant.helpers import llm
    except ImportError:
        _LOGGER.warning(
            "This Home Assistant release has no homeassistant.helpers.llm; "
            "skipping the Flow Automations LLM/MCP API (requires a newer "
            "Home Assistant release)"
        )
        return None

    if not hasattr(llm, "async_register_api"):
        _LOGGER.warning(
            "This Home Assistant release's helpers.llm has no "
            "async_register_api; skipping the Flow Automations LLM/MCP API "
            "(requires a newer Home Assistant release)"
        )
        return None

    from .llm_api import FlowLLMAPI

    try:
        return llm.async_register_api(hass, FlowLLMAPI(hass))
    except HomeAssistantError as err:
        _LOGGER.warning("Could not register the Flow Automations LLM API: %s", err)
        return None


async def async_unload_entry(hass: HomeAssistant, entry) -> bool:
    """Unload a config entry."""
    async_unregister_panel(hass)
    if (unregister := getattr(entry, "runtime_data", None)) is not None:
        unregister()
    return True
