# PRD — Inject Designer Redesign

**Product:** SkillAegis Editor
**Area:** Scenario authoring (Inject Designer, Inject Tester, Scenario Overview)
**Status:** Proposed — approved concept direction, ready for implementation planning
**Author:** Sami Mokaddem (with design exploration by Claude)
**Last updated:** 2026-07-09

---

## 1. Summary

Rebuild the way scenario authors create and configure **injects** into two linked surfaces that share one visual and data model:

1. **Scenario Map** — a visual, drag-driven board of the whole scenario, living on the Scenario page. It replaces the read-only dependency table and lets authors wire up flow (prerequisites, triggers) by direct manipulation instead of per-inject dropdowns.
2. **Guided Stepper** — a focused, 3-step per-inject editor (**Task → Flow → Completion**) reached by clicking an inject on the Map. The **Completion** step merges the formerly-separate Inject Tester inline, so authors build a completion rule and watch it pass/fail against sample data on the same screen.

The redesign keeps the current visual language (slate/Tailwind, light theme), produces the **same CEXF output**, and remains **tool-agnostic** (MISP, Suricata, webhook, Python are peers).

Working, clickable prototypes back this document — see [§13 Supporting evidence](#13-supporting-evidence--prototypes).

---

## 2. Background & problem statement

SkillAegis Editor authors training scenarios in the [Common Exercise Format (CEXF)](https://misp.github.io/cexf/); **SkillAegis Dashboard** runs them and tracks participants live. A scenario is a set of **injects** (tasks a trainee performs in a target tool) plus a parallel **inject_flow** (when each fires, what it depends on, how it is scored).

The current Inject Designer (`src/Views/ScenarioDesigner.vue`, ~1000 lines) is a two-column page: a sortable list of inject cards on the left, and on the right a single flat form that mixes three very different concerns into one wall of fields:

- **What the task is** — name, description, target tool.
- **When/how it runs** — triggers, prerequisite, timing.
- **How it's scored** — one or more `inject_evaluation` entries, each requiring hand-written jq paths, comparison operators, an `evaluation_context` JSON blob, a score range, and (for multiple) an AND/OR join.

### Observed pain points

| # | Problem | Evidence in current code |
|---|---------|--------------------------|
| P1 | **Evaluations are the hardest, most error-prone surface.** Authors hand-write jq, JSON and Python with no assistance. | `ScenarioDesigner.vue` embeds raw `JsonEditorVue` for `parameters` and `evaluation_context`. |
| P2 | **Testing is disconnected.** Validating an evaluation means navigating away to a separate Inject Tester page, losing context. | `testInject()` does `router.push({ name: 'Inject Tester', … })`. |
| P3 | **Flow is edited one inject at a time via dropdowns.** Setting a prerequisite means opening each inject and picking from a `<select>`. The scenario's shape is invisible while editing. | `requirements.inject_uuid` bound to a `Dropdown`; the dependency graph is a **read-only** table (`RequirementTree.vue`) on a different page. |
| P4 | **Part of the flow model can only be edited as raw JSON.** `sequence.completion_trigger` (44 uses across shipped scenarios) and `sequence.followed_by` (14 uses) are **not** exposed in the Designer UI at all. | No `v-model` for those fields anywhere in `ScenarioDesigner.vue`. |
| P5 | **Confusing save/edit lifecycle.** Separate "Save Inject Order" vs "Save Inject Changes"; switching the selected inject silently reverts unsaved edits; leaving the route drops unsaved new injects. | `revertInjectChanges()`, `onBeforeRouteLeave`, two independent save buttons. |
| P6 | **Three concerns share one undifferentiated form**, so authors can't tell "what the task is" from "when it runs" from "how it's scored." | Single `<form>` block in the right column. |

### Why now

This is the critical authoring interface. Every scenario in the library (2–11 injects, typically 5–9) is built here, and its difficulty is the main barrier to more people authoring exercises for tools beyond MISP.

---

## 3. Goals & non-goals

### Goals

- **G1** Make authoring an **inject_evaluation** intuitive: a visual builder for the common `field → operator → values` shape, with a raw jq/JSON/Python escape hatch always one toggle away (progressive disclosure).
- **G2** Bring **testing inline** so authoring and validating a rule happen in one place.
- **G3** Make **flow** (triggers, prerequisites, chaining) visible and directly editable, including the fields that are JSON-only today (P4).
- **G4** Stay **tool-agnostic** — adding a new target tool + strategy must be a data change, not a redesign.
- **G5** Keep the existing **visual identity** (slate/Tailwind, light) that users already like.
- **G6** Emit **byte-compatible CEXF** and remain runnable unchanged by the Dashboard.

### Non-goals

- **NG1** Changing the CEXF schema or the backend evaluation engine semantics. (Field surfacing only.)
- **NG2** Dark mode / mobile layouts. The Editor is a desktop, light-themed authoring tool.
- **NG3** `inject_payloads` authoring (still "not supported yet").
- **NG4** Reworking the Scenario Index / New Scenario / metadata screens beyond embedding the Map.

---

## 4. Users & personas

Two overlapping audiences; design for **progressive disclosure** so both are served:

- **Technical MISP experts** — fluent in jq, REST, JSON, Python. Value speed and the raw escape hatch. Must never feel slowed down.
- **Domain trainers** — understand the exercise but not jq/Python. Need the visual builder, presets, guardrails, and inline testing to succeed without touching code.

---

## 5. Scope — the two surfaces

### 5.1 Scenario Map (Scenario/Overview page)

Prototype: [`mockups/scenario-map.html`](./mockups/scenario-map.html)

Injects are nodes on an auto-laid-out board. Nodes with no prerequisite hang off an **"Exercise start"** rail (dashed connectors); nodes triggered on a timer sit in a dedicated **"⏱ Timed & periodic"** lane. Prerequisite relationships are drawn as connectors.

**Interactions**

- **Set a prerequisite** two equivalent ways: drag a node's **▸ handle** onto another inject, **or** drag the **whole card** on top of another inject. The target highlights green (valid) or red (would create a loop).
- **Change when an inject fires** by dragging the **whole card** into the **timed lane** (→ `periodic`) or onto the **start rail** (→ `startex`); dragging a timed card back into the flow area returns it to `manual`.
- **Remove a prerequisite** by clicking its connection (or the × that appears on hover).
- **Select** a node to reveal a selection bar with its trigger toggles, current prerequisite, **Open in Designer**, and delete.
- **Auto-arrange** re-flows the board by dependency depth. **Add inject** creates a node.

**Constraints / rules**

- `requirements.inject_uuid` holds **exactly one** prerequisite, so the dependency structure is a **forest** (each inject ≤ 1 parent, many children). Dropping a new edge onto a node **replaces** its prerequisite.
- **Cycle prevention:** setting `child.requires = parent` is rejected if `parent` transitively requires `child`. Self-links rejected.
- **No stored coordinates.** Layout is computed from dependency depth on every change; CEXF gains no position fields. ("Auto-arrange" is therefore idempotent.)
- List order (execution/sequence order, edited by drag-reorder today) is a **separate** concept from prerequisites and must not be conflated.

### 5.2 Guided Stepper (Designer page, one inject)

Prototype: [`mockups/guided-stepper.html`](./mockups/guided-stepper.html)

A left rail lists the scenario's injects; the main area is a 3-step wizard for the selected inject. A slim inject rail + step tracker keep the author oriented.

**Step 1 — Task** (`what the trainee does`)
Inject name, short description, result label, **target tool** (segmented control, extensible via "add tool…"). Switching tools re-scopes the strategies available in Completion.

**Step 2 — Flow** (`when it runs`)
- **Trigger** toggle chips: `manual`, `startex`, `periodic`, `triggered_at`.
- **Timing** rate (seconds/minutes/hours) shown when `periodic`/`triggered_at` is active, with the "only `query_search` & `python` support periodic" guardrail.
- **Prerequisite** dropdown (mirrors the Map; either surface can set it).
- **Advanced chaining** (collapsed by default): `followed_by` and `completion_trigger` — resolves P4.

**Step 3 — Completion** (`how it's scored, with live test`) — the heart of the redesign
A split pane:
- **Left — condition builder.** One card per `inject_evaluation`. Each card: strategy selector (scoped to the tool), result label, max score, and a list of **conditions** rendered as `[jq path] [operator] [values]` rows (values as removable chips). Multiple evaluations show an **AND/OR** join control. A **raw jq/JSON** toggle swaps any evaluation to the underlying editor; `python` strategy shows the Python editor.
- **Right — live test.** Always visible. Sample-data editor with quick presets, a big pass/fail verdict, combined score, and a per-condition breakdown (matched / no-match + the value each condition extracted). It **re-evaluates as the author types** on either side.

---

## 6. CEXF data-model mapping

Every control maps to existing CEXF fields. The scenario is two parallel arrays keyed by inject UUID: `injects[]` and `inject_flow[]`.

| UI element | CEXF field |
|---|---|
| Task: name / description / target tool | `injects[].name`, `injects[].description`, `injects[].target_tool` |
| Result label | `injects[].inject_evaluation[].result` |
| Flow: trigger chips | `inject_flow[].sequence.trigger[]` |
| Flow: prerequisite (Map edges + dropdown) | `inject_flow[].requirements.inject_uuid` |
| Flow: timing rates | `inject_flow[].timing.periodic_run_every`, `.triggered_at` |
| Flow: advanced chaining | `inject_flow[].sequence.followed_by[]`, `.completion_trigger[]` |
| Completion: strategy | `injects[].inject_evaluation[].evaluation_strategy` |
| Completion: conditions (`field → op → values`) | `injects[].inject_evaluation[].parameters[]` (`{ "<jq path>": { comparison, values, extract_type? } }`) |
| Completion: raw context / query | `injects[].inject_evaluation[].evaluation_context` |
| Completion: max score | `injects[].inject_evaluation[].score_range` (`[0, max]`) |
| Completion: AND/OR join | `injects[].inject_evaluation_join_type` |

No new fields. `inject_payloads[]` untouched (NG3).

---

## 7. Functional requirements

### Scenario Map
- **FR-M1** Render every inject as a node; auto-layout by dependency depth; roots off the start rail; timed injects in the timed lane.
- **FR-M2** Create a prerequisite via ▸-handle drag **or** whole-card drag onto a target; write `requirements.inject_uuid` on the dragged/near inject.
- **FR-M3** Reject and clearly signal cycles and self-links; a new edge replaces any existing prerequisite.
- **FR-M4** Drop a card into the timed lane → set `periodic` (+ default rate); onto the start rail → set `startex` + clear prerequisite; into flow → `manual`.
- **FR-M5** Click a connection to remove the prerequisite.
- **FR-M6** Select a node → selection bar with trigger toggles, prerequisite (with clear), **Open in Designer** (navigate to the Stepper for that inject), delete.
- **FR-M7** Add inject; auto-arrange.
- **FR-M8** Deleting an inject clears any prerequisites that referenced it (parity with current `removeInjectFromSelectedScenario`).

### Guided Stepper
- **FR-S1** Three steps (Task, Flow, Completion) with a tracker showing per-step completeness; free navigation between steps.
- **FR-S2** Target-tool control lists all tools and scopes strategies to the selected tool; adding a tool/strategy is data-driven.
- **FR-S3** Flow step edits trigger, timing, prerequisite, and (in Advanced) `followed_by` + `completion_trigger`.
- **FR-S4** Completion step renders one card per evaluation with strategy, result, score, and a visual condition builder (`field/op/values`), plus AND/OR when >1 evaluation.
- **FR-S5** A per-evaluation **raw** toggle swaps to the jq/JSON editor; `python` shows the Python editor. Round-trips losslessly with the visual builder.
- **FR-S6** The live-test panel evaluates on every edit and shows verdict, combined score, and per-condition results. For strategies that require a live target (`query_search`, `query_mirror`, `python`, `misp_query_search`, `simulate_ips`) it uses the existing test endpoint and clearly labels canned vs live results.

### Cross-cutting
- **FR-X1** The Map's **Open in Designer** and the Stepper's inject rail are two entries into the same edit state; both reflect the same underlying scenario.
- **FR-X2** All reads/writes go through the existing store + API (§9); output validates against `schema_cexf.json`.
- **FR-X3** Existing scenarios load and round-trip unchanged, including `completion_trigger`/`followed_by` that were previously JSON-only.

---

## 8. Navigation model

```
Scenario Index ──▶ Scenario page ───────────────▶ Designer (Guided Stepper)
                   ├─ metadata (name, level…)      ├─ ‹ back to map
                   └─ Scenario Map  ── click node ─┘   Task · Flow · Completion(+live test)
```

The Map is the scenario "home"/overview; the Stepper is the per-inject editor. Routes already exist: `Scenario Overview` (`/scenarios/overview/:uuid`) and `Scenario Designer` (`/scenarios/designer/:uuid`). The standalone `Inject Tester` route is absorbed into the Completion step (kept as an optional deep-link if useful).

---

## 9. Integration with existing backend/API

No backend changes required. Reuse `src/api.js` verbatim:

| Action | Function → endpoint |
|---|---|
| Load scenarios | `fetchScenarios()` → `GET /scenarios/index` |
| Save an inject (+flow) | `saveInject(uuid, inject, injectFlow)` → `POST /scenarios/save-inject/{uuid}` |
| Delete an inject | `removeInject(uuid, inject_uuid)` → `POST /scenarios/delete-inject/{…}` |
| Reorder injects | `saveInjectOrder(uuid, order)` → `POST /scenarios/order-inject/{uuid}` |
| Live test an evaluation | `testInject(payload)` → `POST /injects/test` |
| Test a jq path | `testJqPath(payload)` → `POST /injects/jq-path-test` |
| Edit scenario meta | `editScenario(payload)` → `POST /scenarios/edit` |

The live-test panel debounces edits before calling `testInject` / `testJqPath`. For `data_filtering` the round-trip is cheap (local jq); for target-backed strategies it hits the configured MISP/endpoint — the panel must show a "run against live target" affordance rather than blocking keystrokes.

---

## 10. Save & edit lifecycle (addresses P5)

Decision required (see [§14](#14-open-questions--decisions)), but the recommended model:

- **Per-inject dirty state** with an explicit **Save inject** (Stepper) instead of two separate save buttons; no silent revert when switching injects — prompt or auto-persist a draft.
- **Map edits** (prerequisite/trigger) persist immediately via `saveInject` for the affected inject; the current `saveInjectOrder` continues to own list order.
- New injects are persisted on first save; abandoned drafts are surfaced, not silently discarded.

---

## 11. Visual design

Reuse the current system — no new identity:

- Slate neutrals + blue accent; semantic green/amber/red; monospace + red-700 for jq/UUID/code tokens; tool hues used sparingly (MISP indigo, webhook violet, Suricata amber, Python cyan).
- System sans + `ui-monospace`; existing `.btn` variants, card/chip styles, dark slate header.
- Light theme only (NG2). The prototypes are authored in this exact language.

---

## 12. Technical implementation notes

**Framework:** Vue 3 `<script setup>` + Tailwind, matching the codebase.

**Components (proposed)**
- `ScenarioMap.vue` — board, nodes, SVG edges, drag gestures, selection bar. Pure SVG for connectors (no new dependency); a small cycle-detection util.
- `InjectStepper.vue` — step tracker + step routing; hosts the three steps.
- `TaskStep.vue`, `FlowStep.vue`, `CompletionStep.vue`.
- `EvaluationBuilder.vue` — one evaluation; strategy/score/result + `ConditionRow.vue` list + raw toggle.
- `ConditionRow.vue` — `field / operator / values` row with chip values.
- `LiveTestPanel.vue` — sample data + presets + verdict + breakdown; wraps the logic currently in `InjectTester.vue`.
- `FlowEditor.vue` — trigger/timing/prerequisite/advanced (shared by the Flow step; the Map uses a compact variant).

**Reuse as-is:** `store.js`, `api.js`, `Dropdown.vue`, `PeriodicRate.vue`, `InjectEvaluationPythonEditorWrapper.vue`, `JsonEditorVue`, `sortablejs-vue3` (list reorder), `Alert`/`Modal`/`Toast`.

**Replace:** `RequirementTree.vue` (read-only) → `ScenarioMap.vue` (interactive) on the Overview page. Fold `InjectTester.vue` into `LiveTestPanel.vue`.

**Data:** keep the two-array model; a `injectByUUID` / `injectFlowByUUID` index (already used) backs both surfaces.

---

## 13. Supporting evidence & prototypes

Two self-contained, clickable HTML prototypes (same slate style, shared sample scenario **"Spearphishing Incident Response"** — 6 injects across MISP + webhook + Python, exercising `data_filtering`, `query_search`, and `python`, plus a multi-condition `AND`). They are the reference implementation for behavior and layout.

- **Guided Stepper** — [`mockups/guided-stepper.html`](./mockups/guided-stepper.html) · live: <https://claude.ai/code/artifact/87b87cd1-0758-4700-8f23-7063d3e9d83d>
- **Scenario Map** — [`mockups/scenario-map.html`](./mockups/scenario-map.html) · live: <https://claude.ai/code/artifact/197a146a-f08b-4740-a015-fa968179f6ce>

Open the `.html` files directly in a browser to interact (no build step).

**Concept exploration (for the record).** Three conceptually different directions were prototyped — ① Guided Stepper, ② Flow Board, ③ Rule Studio. ① was chosen as the per-inject editor; ②'s whole-scenario board became the **Scenario Map**; ③'s always-on live testing was **merged into ①'s Completion step**. ② and ③ were retired.

---

## 14. Open questions & decisions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Map on the Overview page **in place of** `RequirementTree`, or as a new tab alongside metadata? | Replace `RequirementTree`; keep metadata above/beside it. |
| Q2 | Save model: autosave per inject vs explicit **Save inject** with dirty state? | Explicit save + visible dirty state; no silent reverts. |
| Q3 | Node positions: auto-layout vs draggable+stored? | **Decided:** auto-layout, no stored coordinates. |
| Q4 | Live-test debounce/latency for server-side jq strategies? | Debounce ~300 ms; local preview for `data_filtering`, explicit "run" for target-backed strategies. |
| Q5 | Does the Map also edit list/execution order, or only dependencies? | Dependencies only in v1; keep list reorder where it is. |

---

## 15. Success metrics

- **M1** Time to author a complete inject (name → tested passing evaluation) drops materially vs today.
- **M2** Scenarios requiring **manual JSON edits** for flow fields (`completion_trigger`/`followed_by`) → ~0.
- **M3** Fewer invalid `parameters`/jq paths reaching save (caught by inline live test).
- **M4** Qualitative: a non-MISP author (webhook or Python scenario) can build and test an inject without reading CEXF docs.

---

## 16. Phased delivery

1. **Phase 1 — Evaluation + live test.** Build `EvaluationBuilder` + `LiveTestPanel` (fold in `InjectTester`) inside the *existing* Designer. Highest-value, lowest-risk; ships the #1 pain fix first.
2. **Phase 2 — Guided Stepper.** Restructure `ScenarioDesigner.vue` into the 3-step flow hosting the Phase-1 components.
3. **Phase 3 — Scenario Map.** Replace `RequirementTree` on the Overview page; implement drag gestures, cycle prevention, Open-in-Designer.
4. **Phase 4 — Polish.** Advanced chaining UI, validation/empty states, keyboard & focus states, save-lifecycle cleanup.
