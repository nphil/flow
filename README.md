> [!WARNING]
> The project is still in beta. While it is designed to be non-destructive, please make sure to backup your automations before editing them with Flow!

> [!TIP]
> Looking for a Role Based Access Control system for HA? [ha-rbac](https://github.com/fezvrasta/ha-rbac) is now available!

<p>
  <img src="assets/logo.svg" alt="Flow logo" width="64" height="64" />
</p>

# Flow

**A visual, Node-RED-style flow editor for Home Assistant, with 0% runtime overhead.**

[![HACS Badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stars](https://img.shields.io/github/stars/nphil/haflow?style=flat&color=gold)](https://github.com/nphil/haflow)

Flow is a visual flow editor that brings Node-RED-style clarity to Home Assistant automations **without a second execution engine**: you build on a canvas, and Flow transpiles the diagram into 100% standard Home Assistant YAML stored directly in HA's own automation config, so the logic that runs is native HA logic, not something Flow has to keep alive itself.

---

<!-- Screenshot placeholder: canvas view of an automation open in Flow, light + dark theme side by side. -->
<!-- Screenshot placeholder: live trace view mid-run, next to the equivalent native Home Assistant trace. -->

---

## 🧐 Why Flow?

For years, Home Assistant users had to choose: the **stability** of native YAML or the **clarity** of Node-RED flows. **Flow eliminates the trade-off.**

- **Native YAML:** No side files, no external databases, and no proprietary formats. Everything is stored in HASS.
- **Zero Overhead:** No secondary engine or extra Docker containers. Once saved, the logic runs in the HA Core with zero extra resource consumption.
- **Optimized YAML Generation:** Flow produces standard, linear sequences for simple flows and automatically utilizes a robust **State-Machine** pattern for complex logic like loops.
- **Live Flow Debugging:** Watch automations execute **on the canvas, as they run**. Nodes light up with per-node status, conditions show why a branch was skipped, and loops show their visit count — plus full integration with the official Home Assistant **Trace View**.

---

## 🔒 No Vendor Lock-In: Your Automations, Your Way

- **Stop Using Flow Anytime:** If you uninstall Flow, your automations keep working exactly as before. The logic is standard YAML; you only lose the visual layout metadata.
- **Built-in Editor Compatible:** You can switch between Flow and the native HASS automation editor seamlessly. They edit the same source of truth.
- **Zero Side-Files:** There is no `flow_data.json`. Visual metadata (node positions, etc.) is stored as a harmless object inside the automation's `variables` block.

---

## 🛠 Engineering Quality & Architecture

Flow is architected with strict engineering principles to ensure your home remains reliable:

- **Intelligent Transpiler:** The engine analyzes your flow and chooses the optimal target structure. It generates clean, human-readable YAML for standard sequences, and utilizes a **Native State Machine** (repeat/choose dispatcher) only when needed to unlock complex non-linear "jumps" and loops.
- **Zod Validation:** Every node, edge, and schema is validated via **Zod**. This ensures that malformed UI data never reaches your Home Assistant API.
- **Heuristic Auto-Layout:** Our engine can "read" existing, manual YAML and instantly reconstruct a visual map, making it the perfect tool for auditing and cleaning up "spaghetti" automations.

---

## ✨ Power Features

- **Script Responses:** Full support for `call_service` responses. Call a script, capture its output, and use it in subsequent nodes via native Jinja templates.
- **Set Variables Node:** Create and update flow-scoped variables dynamically within your automation logic.
- **Entity Intelligence:** Full autocomplete and state-awareness via the native HASS WebSocket API.
- **Visual Import:** Load any native automation and see it mapped instantly to nodes.
- **Live Trace View:** A Node-RED-style live debugger built into the editor. Toggle **Live** in the Debug panel and every run paints itself onto your flow: executed nodes badge green, false conditions badge orange with the reason, errors badge red, unvisited nodes dim out, and delay/wait nodes count down while they hold. A run picker lets you replay any recent execution.
- **Theming:** Six built-in palettes (Catppuccin, Nord, Tokyo Night, Gruvbox, Rosé Pine, Everforest), each with a light and dark variant, plus an optional "Home Assistant" mode that blends the editor into your existing HA theme.

---

## 🚀 Getting Started

### Installation via HACS (Recommended)

1. **Install HACS**: Ensure [HACS](https://hacs.xyz/) is installed.
2. **Add Custom Repository**:
   - Go to **HACS** → **Integrations**
   - Click the **⋮** menu → **Custom repositories**
   - Add: `https://github.com/nphil/haflow` as an **Integration**.
3. **Install & Restart**: Find **Flow** in HACS, download it, and restart Home Assistant.
4. **Enable**: Go to **Settings** → **Devices & Services** → **Add Integration** → Search for **Flow**.

---

## 🤖 AI / MCP

Flow's Home Assistant integration also registers a **"Flow Automations"** LLM API (`homeassistant.helpers.llm`) that gives any MCP-connected AI assistant full, structured access to your automations — list them, read and write their YAML, enable/disable them, trigger a test run, and inspect execution traces. No extra server, port, or credential: it rides on Home Assistant's own built-in **MCP Server** integration and your existing HA authentication.

### Enabling it

1. Install and set up **Flow** as above — its Home Assistant integration registers the API automatically at startup; there is nothing to configure on Flow's side.
2. In Home Assistant, go to **Settings → Devices & Services → Add Integration** and add the built-in **Model Context Protocol Server** integration (if you haven't already).
3. During its setup (or its **Configure** screen if it's already installed), select **Flow Automations** from the list of LLM APIs to expose, alongside or instead of the default **Assist** API.
4. Point any MCP client (Claude, an MCP-compatible IDE, etc.) at your Home Assistant's MCP endpoint using a long-lived access token, the same way you would for the Assist API.

This requires a Home Assistant release that ships `homeassistant.helpers.llm.async_register_api` (the same mechanism behind Assist's tool-calling and the MCP Server integration itself). On older releases, Flow logs a warning and skips registering it — the panel and everything else still sets up normally.

### Tools

| Tool | What it does |
| --- | --- |
| `flow_list_automations` | List every automation: id, alias, description, enabled state, last trigger time, mode. |
| `flow_get_automation` | Get one automation's full YAML config, entity_id, and enabled state. |
| `flow_create_automation` | Create a new automation from YAML (validated first; nothing is saved if it's invalid). |
| `flow_update_automation` | Replace an existing automation's YAML (validated first; nothing is saved if it's invalid). |
| `flow_delete_automation` | Permanently delete an automation. |
| `flow_set_automation_enabled` | Turn an automation on or off without changing its configuration. |
| `flow_trigger_automation` | Manually run an automation now, optionally skipping its conditions. |
| `flow_list_traces` | List an automation's recent execution runs and their outcomes. |
| `flow_get_trace` | Get one run's full step-by-step trace: path, timestamps, variables, errors. |
| `flow_validate_automation` | Check whether a piece of YAML is a valid automation, without saving it. |

Every tool speaks plain Home Assistant automation YAML — the same schema used in `automations.yaml` and the built-in editor — so anything an MCP client writes round-trips cleanly through Flow's canvas and the native editor too.

### ⚠️ Security note

The Flow Automations API gives a connected MCP client **full control over your automations**: it can read, create, edit, delete, enable/disable, and manually trigger any of them, including ones that unlock doors, disarm alarms, or control anything else your automations touch. Treat the MCP endpoint, and any token you issue for it, with the same care as admin access to Home Assistant itself — only connect clients and models you trust, and consider using a dedicated long-lived token you can revoke independently of your own.

---

## 💬 Frequently Asked Questions

### How do I use script responses and variables?

When you call a script and set a `response_variable` (e.g., `weather_data`), those values become available to all subsequent nodes in the flow. You can access them using standard Home Assistant Jinja syntax in any text field:
`The temperature is {{ weather_data.temp }} degrees.`

### How do I watch an automation run live?

Open the automation in Flow, switch the right-hand panel to the **Debug** tab, and click the **Live** (radio tower) button in the *Automation Trace* section. Flow subscribes to Home Assistant's trigger events and polls the run's trace, so the canvas updates while the automation is still executing — including long `delay` and `wait_for_trigger` steps, which show a live countdown.

Each node badges its outcome: green (executed), orange (condition was false — hover for the reason), red (error), and a spinner while the step is in flight. Nodes the run never reached are dimmed, so a glance tells you which branch was taken. Loop bodies show `×N` for the number of visits. The **Select Trace Run** picker replays any of the recent runs Home Assistant retains.

### Does Flow slow down my Home Assistant instance?

**No.** Unlike Node-RED, Flow is not an execution engine; it is a specialized compiler. Once you hit "Save," the resulting logic is pure, native Home Assistant code. It consumes zero CPU or RAM in the background because the logic runs directly within the HA Core automation engine.

### Can I still use the built-in Home Assistant automation editor?

**Yes.** Flow and the native editor are two different "lenses" for the same data. You can open a Flow automation in the native editor to make a quick change, and Flow will pick up those changes (and attempt to preserve your layout) the next time you open it.

### What happens if I uninstall Flow?

Your house keeps running. Because Flow stores everything as native YAML, your automations are independent of the editor. You will lose the visual layout (the positions of the boxes), but the logic itself remains 100% intact and editable via YAML.

### Why does my YAML look different sometimes?

Flow uses an **Optimized Compilation** strategy.

- For **Linear flows**, it generates standard YAML sequences.
- For **Complex flows** (with loops or jumps), it generates a **Native State Machine**.
  Both are 100% compliant with Home Assistant; Flow simply chooses the best structure for the job.

### Is this safe to use for "mission-critical" automations?

While Flow is in Beta, we recommend keeping backups. However, because it targets the native HA engine, it is inherently more stable than external engines. If the editor has a bug, it might mess up your YAML, but it can't "crash" your automation engine or cause a background memory leak.

### What's the Flow alternative to Node-RED's "Function" node?

You can use Jinja2 templates directly in any text field within Flow. For more complex logic, the "Set Variables" node allows you to create and manipulate flow-scoped variables dynamically. This combination provides similar flexibility to Node-RED's "Function" node while staying within the native Home Assistant framework.

---

## 🌱 Fork Lineage

Flow is a rebrand and UI/UX rebuild of [**C.A.F.E.**](https://github.com/FezVrasta/cafe-hass) by [Federico Zivolo](https://github.com/FezVrasta), released under the MIT License. The transpiler, schema layer, and core Home Assistant integration this project builds on originate there — huge thanks to Federico for the original engine and the "compile to native YAML, run with zero overhead" design that Flow keeps intact. See [LICENSE](./LICENSE) for the original copyright notice, which Flow retains as required by the MIT License.

## ⚖️ License

MIT License. Original work Copyright (c) 2026 [Federico Zivolo](https://github.com/FezVrasta). See [LICENSE](./LICENSE).
