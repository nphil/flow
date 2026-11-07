"""Config flow tests."""

from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.flow.const import DOMAIN


async def test_user_flow_creates_entry(hass: HomeAssistant) -> None:
    """The user step shows a form, then creates the single Flow entry."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Flow"


async def test_second_flow_is_aborted(hass: HomeAssistant) -> None:
    """Flow can only be configured once."""
    first = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    await hass.config_entries.flow.async_configure(first["flow_id"], {})

    second = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    second = await hass.config_entries.flow.async_configure(second["flow_id"], {})
    assert second["type"] is FlowResultType.ABORT
    assert second["reason"] == "already_configured"
