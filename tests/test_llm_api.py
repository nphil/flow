"""The "Flow Automations" LLM API: registration, tool metadata, tool results."""

import pytest
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import llm
from homeassistant.setup import async_setup_component
from pytest_homeassistant.common import MockConfigEntry

from custom_components.flow.const import DOMAIN
from custom_components.flow.llm_api import _TOOLS


@pytest.fixture
async def flow_api(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    monkeypatch: pytest.MonkeyPatch,
) -> llm.APIInstance:
    """Set Flow up (without the real panel) and return its LLM API instance."""

    async def _no_panel(hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr("custom_components.flow.async_register_panel", _no_panel)
    monkeypatch.setattr(
        "custom_components.flow.async_unregister_panel", lambda hass: None
    )
    assert await async_setup_component(hass, "automation", {})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return await llm.async_get_api(
        hass, DOMAIN, llm.LLMContext(
            platform="test",
            context=Context(),
            language="en",
            assistant="conversation",
            device_id=None,
        )
    )


async def test_api_is_registered_and_unregistered(
    hass: HomeAssistant, config_entry: MockConfigEntry, flow_api: llm.APIInstance
) -> None:
    """Setting Flow up registers the API; unloading removes it."""
    assert DOMAIN in {api.id for api in llm.async_get_apis(hass)}
    assert {tool.name for tool in flow_api.tools} == {tool.name for tool in _TOOLS}

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert DOMAIN not in {api.id for api in llm.async_get_apis(hass)}


async def test_every_tool_declares_its_integration_and_behaviour() -> None:
    """Tools name Flow as their integration and describe how they behave."""
    for tool in _TOOLS:
        assert tool.integration == DOMAIN, tool.name
        assert tool.title, tool.name
        assert tool.annotations != llm.ToolAnnotations(), tool.name
        assert tool.annotations.open_world is False, tool.name

    read_only = {t.name for t in _TOOLS if t.annotations.read_only}
    assert read_only == {
        "flow_list_automations",
        "flow_get_automation",
        "flow_list_traces",
        "flow_get_trace",
        "flow_validate_automation",
    }


async def test_tools_return_tool_result(
    hass: HomeAssistant, flow_api: llm.APIInstance
) -> None:
    """Tools return an llm.ToolResult (a bare dict is deprecated since 2026.10)."""
    tools = {tool.name: tool for tool in flow_api.tools}

    listed = await tools["flow_list_automations"].async_call(
        hass, llm.ToolInput("flow_list_automations", {}), flow_api.llm_context
    )
    assert isinstance(listed, llm.ToolResult)
    assert listed.error is False
    assert listed.data["success"] is True

    validated = await tools["flow_validate_automation"].async_call(
        hass,
        llm.ToolInput(
            "flow_validate_automation",
            {
                "yaml": (
                    "alias: t\n"
                    "triggers:\n"
                    "  - trigger: homeassistant\n"
                    "    event: start\n"
                    "actions: []\n"
                )
            },
        ),
        flow_api.llm_context,
    )
    assert isinstance(validated, llm.ToolResult)
    assert validated.data["result"] == {"ok": True, "errors": []}
