"""Shared fixtures for the Flow integration tests."""

import pytest
from pytest_homeassistant.common import MockConfigEntry

from custom_components.flow.const import DOMAIN


@pytest.fixture
def config_entry() -> MockConfigEntry:
    """A Flow config entry, as the config flow creates it."""
    return MockConfigEntry(domain=DOMAIN, title="Flow", data={}, unique_id=DOMAIN)
