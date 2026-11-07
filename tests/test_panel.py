"""The Flow sidebar panel."""

from pathlib import Path

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant.common import MockConfigEntry

from custom_components.flow import panel
from custom_components.flow.const import DOMAIN


async def test_panel_registered_and_removed(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Setting the entry up adds the admin-only panel; unloading removes it.

    The built frontend (www/) is not in git, so a stand-in panel-wrapper.js is
    placed in a temporary www folder.
    """
    assets = tmp_path / "www" / "assets"
    assets.mkdir(parents=True)
    (assets / "panel-wrapper.js").write_text("// stand-in\n")
    monkeypatch.setattr(panel, "__file__", str(tmp_path / "panel.py"))

    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    panels = hass.data["frontend_panels"]
    assert DOMAIN in panels
    assert panels[DOMAIN].require_admin is True

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert DOMAIN not in hass.data["frontend_panels"]
