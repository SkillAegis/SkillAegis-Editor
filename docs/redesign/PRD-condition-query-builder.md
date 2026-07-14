# PRD — Guided Query Builder for `data_filtering` conditions

**Product:** SkillAegis Editor
**Area:** Scenario authoring → Inject Designer → Evaluation builder (the condition `path`)
**Status:** Proposed — approved concept direction (①), ready for implementation planning
**Author:** Sami Mokaddem (with design exploration by Claude)
**Last updated:** 2026-07-13

---

## 1. Summary

Replace the single free-text **jq path** field inside a `data_filtering` condition with a **guided query builder**: three plain-language slots — **Look at… (FROM) → Keep only where… (WHERE) → Then check… (CHECK)** — that assemble the exact jq path underneath and preview it live. The author never types a bracket or a pipe for the common case, while the raw jq field stays one toggle away for the long tail.

This changes **only how the `path` string is authored**. The generated jq is byte-identical to what authors write by hand today; the CEXF data model, the comparison operators, and the Dashboard evaluation engine are untouched. It extends the visual condition builder shipped in the [Inject Designer redesign](./PRD-inject-designer-redesign.md) — the operator + values half already exists in `ConditionRow.vue`; this PRD adds the missing half: the path.

A working, clickable prototype backs this document — see [§13](#13-supporting-evidence--prototype).

---

## 2. Background & problem statement

`data_filtering` (and its comparison-strategy siblings `query_search`, `simulate_ips`, `misp_query_search`) evaluate a flat list of conditions. Each condition is `{ path, comparison, values, extract_type }` (`evaluationModel.js`). The `comparison` + `values` are already authored visually in `ConditionRow.vue`; the `path` is a **raw jq expression typed into a text input** (`ConditionRow.vue:66`).

For simple paths (`.Event.info`, `.Event.published`) this is fine. But the expressive rules that make `data_filtering` powerful require full jq pipelines. The canonical example flagged by users:

```
[.Event.Object[].Attribute[], .Event.Attribute[]] | .[] | select(.value == "194.78.89.250").to_ids
```

### Observed pain points

| # | Problem |
|---|---------|
| Q1 | **Authors hand-write jq pipelines with no assistance** — no schema, no autocomplete, no field vocabulary. A missing bracket or a `==` where `contains` was meant fails silently at runtime. |
| Q2 | **MISP's shape must be memorised.** Attributes live in **two** places — top-level (`.Event.Attribute[]`) *and* inside objects (`.Event.Object[].Attribute[]`). Authors must know to union both, which produces the intimidating `[ … , … ] \| .[]` prefix. This one idiom is the single biggest source of complexity. |
| Q3 | **The `.response[]` wrapper is invisible.** `query_search` / `misp_query_search` wrap the data in a response array, so the same rule needs a different prefix. Authors routinely forget it. |
| Q4 | **No feedback until a live test runs.** A malformed path is indistinguishable from a correct-but-non-matching one without leaving the field. |

### Evidence — every complex path is the same three moves

Extracting **every** jq path from the shipped scenario library (`../../scenarios/*.json`) and ranking by frequency shows the complex paths never vary in *structure* — only in which collection, which filter, and which field:

| Move | Author intent | Generated jq fragment |
|------|---------------|-----------------------|
| **FROM** — pick a collection | "every attribute in the event" | `[.Event.Object[].Attribute[], .Event.Attribute[]] \| .[]` |
| **WHERE** — filter it (optional) | "value is 194.78.89.250" | `select(.value == "194.78.89.250")` |
| **CHECK** — project a field | "its to_ids flag" | `.to_ids` |

The flagged example is exactly `FROM(all attributes) → WHERE(value == 194.78.89.250) → CHECK(to_ids)`. Real recurring shapes and their counts:

| Shape (FROM → optional WHERE → CHECK) | Occurrences |
|---|---|
| `.Event.<field>` (info ×41, published ×4, distribution, …) | ~50 |
| `.response[].Event.<field>` (event_creator_email ×24, info ×5) | ~30 |
| all-attributes union `[.Event.Object[].Attribute[], .Event.Attribute[]] \| .[]` → `.value` | 5 |
| response-attributes union `[.response[]…] \| .[]` → `.value` | 4 |
| object attributes `.Event.Object[].Attribute[]` → `select(.type == …)` → `.value` | ~8 |
| all-attributes union → `select(.type == …)` / `select(.value \| match(…))` → `.value` | ~8 |
| all-attributes union → `select(.value == …)` → `.to_ids` | 1 (the flagged example) |
| `.Event.Object[]` → `select(.name == …)` → `.distribution` / count | ~4 |
| `.Event.Tag[].name` / `.Event.Tag \| select(length>0) \| .[].name` | ~5 |
| **Irreducible** `map(…) \| map(…) \| group_by(…)` monsters | 2 |

**Conceptually, almost every authored path is a FROM/WHERE/CHECK query** — but they nest to different depths. The **measured** coverage of the P1 single-level grammar (from `tools/query-builder-property-test.mjs` over the live library) is:

| Outcome | Distinct paths | Occurrences |
|---|---|---|
| **Builder mode** (parsed & round-trips to a semantically-equal jq path) | 44 / 79 = **56%** | 126 / 174 = **72%** |
| — of which exact byte round-trip | 26 | — |
| — of which normalised (paren/pipe variants, jq-verified equal) | 18 | — |
| **Raw fallback** (out of P1 grammar scope) | 35 | 48 |

The fallbacks are *not* random — they cluster into a few structured shapes P1 deliberately excludes (each a candidate for a later slice):

| Fallback category | Distinct | Note |
|---|---|---|
| map / flatten / `group_by` pipelines (`._AttributeFlattened \| map(...)`, tag-counting) | 9 | Irreducible — raw jq or Python. |
| multi-level projection / select-after-projection (`… \| select(...) \| .Tag[].name`, `.Event.Tag[].name \| select(...)`) | 9 | Needs a richer CHECK grammar. |
| unmodelled collections (`.Event.Note[]`, `.Event.Attribute[].Sighting`) | 5 | Add source presets. |
| **two-level object→attribute select** (`.Event.Object[] \| select(.name=="url") \| .Attribute[] \| select(...)`) | 5 | Needs a nested source model — top P-next candidate. |
| root-array webhook/suricata (`.[].verdict.action`) | 4 | Non-MISP sources — OQ1 / P4. |
| projection-inside-union / `.Event.Tag \| select(length>0)` | 2 | Rare hand-authored variants. |
| `._secret` | 1 | 10 occurrences; a Python-strategy artefact, not a real comparison path. |

So **P1 gives builder authoring for ~72% of the paths authors actually write**, and every remaining path round-trips **verbatim** to the raw jq field — nothing is lost or rewritten. Lifting the two-level-select and multi-level-projection gaps (the two "needs richer grammar" rows, ~14 distinct paths) is the highest-value follow-up.

### Why now

`data_filtering` is the most-used strategy and its path field is the steepest part of the authoring cliff (pain point **P1** in the parent redesign PRD). Lowering it is the highest-leverage way to let non-jq domain trainers author expressive rules.

---

## 3. Goals & non-goals

### Goals
- **G1** Author the common `path` shapes with **zero jq typing** via three plain-language slots (FROM / WHERE / CHECK).
- **G2** **Round-trip:** parse an existing stored path back into the builder when it matches the recognised grammar; fall back to the raw field (today's behaviour) when it doesn't — never lose or corrupt a path.
- **G3** **Live preview + validation** of the generated path against the sample data, reusing the existing `/injects/jq-path-test` endpoint.
- **G4** Hide MISP's two-places-for-attributes and the `.response[]` wrapper (Q2, Q3) behind source presets, tool- and strategy-aware.
- **G5** Keep the **raw jq escape hatch** one toggle away (progressive disclosure), consistent with the existing per-evaluation raw toggle.
- **G6** Emit **byte-compatible** jq / CEXF; no engine or schema change.

### Non-goals
- **NG1** Changing the CEXF schema, the comparison operators, or the Dashboard evaluation engine.
- **NG2** A full visual jq editor for arbitrary pipelines. Irreducible paths stay in the raw field.
- **NG3** The "point at the data" click-to-build surface (concept ②) — separate, later PRD; this builder is designed so ② can pre-fill its slots.
- **NG4** Dark mode / mobile (per parent PRD NG2).
- **NG5** Authoring `values` / `comparison` — already handled by `ConditionRow.vue`; this PRD only adds the path.

---

## 4. Users

Per the parent PRD's progressive-disclosure principle:
- **Domain trainers** (non-jq) — the primary beneficiaries. The builder must let them express type/value/regex filters and field checks without seeing jq.
- **MISP/jq experts** — must never be slowed down. The generated jq is always visible and one toggle drops them into the raw field with the current path pre-filled.

---

## 5. The model — FROM / WHERE / CHECK

A condition's path is modelled as:

```
{
  source:   <preset key>,          // FROM  — the collection
  filters:  [ {field, op, value} ],// WHERE — 0..n, AND-ed inside one select()
  project:  <field | "*self*">     // CHECK — the projected field (feeds comparison + values)
}
```

`comparison` and `values` remain on the condition as today; `project` chooses *what* they compare against. This structure is **derived** from / serialised to the `path` string — it is not stored separately in CEXF (see §7).

### 5.1 FROM — source presets

Tool- and strategy-aware. Each preset carries a jq `base`, an item `kind` (drives the WHERE/CHECK vocabularies), and whether it is a *stream* (iterates elements) or a *scalar* (a single event field).

| Preset key | Label | `base` jq | kind | Shown when |
|---|---|---|---|---|
| `all-attr` | Every attribute in the event | `[.Event.Object[].Attribute[], .Event.Attribute[]] \| .[]` | attr | MISP / webhook, `data_filtering` |
| `obj-attr` | Attributes inside objects only | `.Event.Object[].Attribute[]` | attr | MISP / webhook |
| `top-attr` | Top-level attributes only | `.Event.Attribute[]` | attr | MISP / webhook |
| `objects` | The event's objects | `.Event.Object[]` | obj | MISP / webhook |
| `tags` | The event's tags | `.Event.Tag[]` | tag | MISP / webhook |
| `event-field` | A single field on the event | `.Event` | event | MISP / webhook |
| `resp-attr` | Every attribute in the search response | `[.response[].Event.Object[].Attribute[], .response[].Event.Attribute[]] \| .[]` | attr | `query_search` / `misp_query_search` |
| `resp-field` | A field on each response event | `.response[].Event` | event | `query_search` / `misp_query_search` |
| `raw` | *(custom jq — opens raw field)* | — | — | always (escape hatch) |

The `resp-*` presets exist **only** for the response-wrapped strategies, so Q3 (forgetting `.response[]`) disappears: the author picks the same conceptual source and the correct wrapper is chosen for them.

### 5.2 WHERE — filters (optional, 0..n, AND-ed)

Each filter is `{field, op, value}`. Fields are drawn from the source's `kind`:

| kind | field vocabulary (dropdown, free-text allowed) |
|---|---|
| attr | `value`, `type`, `category`, `to_ids`, `comment`, `object_relation` |
| obj | `name`, `meta-category`, `distribution` |
| tag | `name` |

Operators (map to jq inside `select(...)`):

| op | jq | notes |
|---|---|---|
| `is` | `.field == <lit>` | literal typed: bare for `true`/`false`/number, quoted otherwise |
| `is one of` | `(.field == a or .field == b …)` | comma-split values |
| `matches` | `.field \| match(<str>)` | regex; matches real `select(.value \| match(…))` usage |
| `contains` | `.field \| contains(<str>)` | substring |

Multiple filters join with ` and ` inside a single `select()`.

### 5.3 CHECK — projection

Projects the field the comparison runs on. Vocabulary by kind:

| kind | projection options |
|---|---|
| attr | `.value`, `.to_ids`, `.type`, `.category`, `.comment`, *(the item itself)* |
| obj | `.name`, `.distribution`, *(the item itself)* |
| tag | `.name` |
| event | the field chosen in the FROM `event-field` sub-selector (`.info`, `.published`, `.distribution`, `.threat_level_id`, free-text) |

*(the item itself)* → no projection suffix (e.g. `select(.name == "suricata")` with a `count` comparison — matches real `.Event.Object[] | select(.name == "suricata")` count ≥ 1 usage).

---

## 6. jq generation rules (authoritative)

Let `BASE` = source `base`, `PROJ` = `"." + project` (or `""` for *self*), `FILTERS` = filters with a non-empty value (or `op == matches`).

```
if source == event-field:      path = ".Event." + field
if source == resp-field:       path = ".response[].Event." + field

else if FILTERS is non-empty:
    SEL  = "select(" + FILTERS.map(toExpr).join(" and ") + ")"
    path = BASE + " | " + SEL + PROJ        # e.g.  … | .[] | select(.value == "x").to_ids

else:  # no filter
    if PROJ == "": path = BASE
    elif BASE ends with "| .[]":            # merge into idiomatic ".[].value"
        path = BASE without trailing "| .[]" + "| .[]" + PROJ
    else: path = BASE + PROJ
```

`toExpr(filter)` follows the operator table in §5.2. Literal rendering: `true`/`false`/integers/decimals emitted bare; everything else double-quoted with `"` escaped.

**Verification target:** with `source=all-attr, filters=[{value, is, "194.78.89.250"}], project=to_ids`, this produces exactly:

```
[.Event.Object[].Attribute[], .Event.Attribute[]] | .[] | select(.value == "194.78.89.250").to_ids
```

byte-for-byte the flagged example. The prototype asserts this equality live (green banner).

### 6.1 `extract_type` coupling

`extract_type` (`first` default / `all`) is set automatically, not exposed as jq:
- `all` when the comparison is `count`, or when the author enables **"match all like this"** (multiple expected matches).
- `first` otherwise.

This removes the standalone "match all results" checkbox from `ConditionRow.vue` in builder mode (it stays in raw mode).

### 6.2 Context placeholders

`{{user_email}}` / `{{.jq.path}}` placeholders (resolved by `apply_replacement_from_context` in the engine) are allowed verbatim in any filter `value` or the projected comparison value — they pass straight through as string literals. Common real usage: `.response[].Event.event_creator_email == "{{user_email}}"`.

---

## 7. Round-trip — parsing an existing path back into the builder

**This is the highest-risk piece and the gate on G2.** On load, each stored `path` is fed to a recogniser that attempts to reconstruct `{source, filters, project}`. Grammar (pseudo):

```
1. Match path against each preset BASE (longest first), incl. the ".[].PROJ" merged form
   and the "BASE | select(...)PROJ" form.
2. If matched, parse the optional select(...) body as a conjunction of simple terms:
       .field == <lit>            | .field | match(<str>) | .field | contains(<str>)
       (.f == a or .f == b …)  → is one of
   Any term outside this grammar  → REJECT.
3. Parse the trailing projection: ".<ident>" or "" or "(self)".
   Anything else (further pipes, functions) → REJECT.
4. event-field / resp-field: ".Event.<ident>" / ".response[].Event.<ident>".
```

- **Recognised** → open in builder mode with slots pre-filled.
- **Rejected** (the two `group_by`/`map` monsters, or any hand-tuned jq) → the condition's path opens in **raw mode**: a jq text input identical to today's `ConditionRow.vue:66`, with a subtle "custom jq" affordance and a note that the builder can't represent it. This is the exact same graceful-degradation mechanism `conditionsFromParameters` / `representable` already use at the *parameters* level (`EvaluationBuilder.vue:96`), applied one level down at the *path* level.

### 7.1 Canonical vs. syntactic variants (the normalisation invariant)

The generator (§6) emits **one canonical form** per query. But the library contains **semantically-equal syntactic variants** the recogniser must also accept, which do **not** round-trip byte-for-byte:

| Stored (real) | Canonical (generated) |
|---|---|
| `select((.type == "sha1")).value` (redundant parens) | `select(.type == "sha1").value` |
| `.Event.Object[].Attribute[] \| select(.type == "sha1") \| .value` (pipe before projection) | `… \| select(.type == "sha1").value` |

So the invariant is **not** byte-equality. It is, in priority order:

1. **Loss-preserving for rejects.** A rejected path is displayed and saved **verbatim** — never rewritten.
2. **Semantic equivalence for accepts.** For a recognised path, `build(parse(p))` must be **semantically identical** to `p` — verified by compiling both with jq and asserting equal extraction against the sample corpus (§12), not by string equality.
3. **No silent churn.** A recognised path that is *not* already in canonical form is left **byte-exact in storage until the author actually edits that condition**. Only an explicit edit re-serialises it to canonical form. This prevents "open + save an untouched scenario" from producing a diff of cosmetic jq rewrites.

Byte-equality still holds for the common case: a path authored *through* the builder is canonical by construction, so save produces exactly what §6 generated.

---

## 8. UX specification

Within each `ConditionRow`, the path portion becomes a compact three-slot control (see prototype tab ①). Layout, per row:

- **Look at…** — source `<select>` (presets from §5.1, filtered by tool+strategy). If `event-field`/`resp-field`, reveal a second field `<select>` (mono, free-text allowed).
- **Keep only where…** — a stack of filter rows (`field <select>` · `op <select>` · `value` input · remove) with an **＋ Add filter** ghost button; "AND" separators between rows; collapsed/empty by default (label: "optional").
- **Then check…** — projection `<select>`. (The comparison `<select>` + values chips already present in `ConditionRow` follow, unchanged.)
- **Generated jq** — a read-only, colour-coded preview line (FROM=blue, WHERE=amber, CHECK=green) with a validity indicator, plus **⌵ edit as raw jq** toggle for this condition.
- A **plain-language sentence** restating the rule ("Pass when, looking at *every attribute in the event* where *.value is 194.78.89.250*, *its to_ids flag* is set.") — the same live sentence the prototype shows.

Validation & preview (G3): on any change, POST `{path, data, extract_type}` to `/injects/jq-path-test`; render ✓ valid + the extracted value inline, or the compile error. This reuses `testJqPath` (`api.js:150`, `main.py:672`) — already wired for the live-test panel.

---

## 9. CEXF data-model mapping

**No schema change.** The builder is a pure view over the existing `path` string.

| Builder concept | CEXF field | Notes |
|---|---|---|
| source + filters + project | `inject_evaluation.parameters[i].<path>` (the key) | serialised via §6 |
| comparison | `parameters[i].<path>.comparison` | unchanged (`ConditionRow`) |
| values | `parameters[i].<path>.values` | unchanged |
| extract_type | `parameters[i].<path>.extract_type` | auto-set §6.1 |

`parametersFromConditions` / `conditionsFromParameters` (`evaluationModel.js`) are unchanged; the builder plugs in **below** them, transforming only the `path` field of each already-parsed condition.

---

## 10. Integration with existing code

| Touchpoint | Change |
|---|---|
| `evaluationModel.js` | Add: `SOURCE_PRESETS` (tool/strategy-scoped), `FILTER_FIELDS`/`PROJECTIONS` vocabularies, `buildPathFromQuery(query)` (§6), `parseQueryFromPath(path)` (§7, returns `{ok, query}`). Keep everything else. |
| `ConditionRow.vue` | Replace the single path `<input>` with the three-slot control + raw-per-condition toggle + generated-jq preview + sentence. Guarded by `parseQueryFromPath(...).ok`; otherwise render today's raw input. |
| `EvaluationBuilder.vue` | No structural change. The existing per-*evaluation* raw toggle still forces the whole parameters block to raw JSON. |
| `LiveTestPanel.vue` / `api.js` / `main.py` | No change — reuse `/injects/jq-path-test`. |
| New | Optional small `QueryBuilder.vue` extracted from `ConditionRow` if the row grows too large. |

Tool/strategy scoping comes from the existing `targetTool` prop threaded through `EvaluationBuilder → ConditionRow` and the `strategy` (to pick `resp-*` presets for response-wrapped strategies).

---

## 11. Edge cases

- **Empty filter value** — excluded from the generated `select` (so a half-typed filter doesn't break the path); flagged as incomplete in the preview.
- **Switching source across kinds** (attr→obj) — projection/filters reset to that kind's defaults; a confirmation is unnecessary (cheap to redo, live preview shows result).
- **`is one of` with one value** — degrades to a plain `==` (no wrapping parens) so re-parse is stable.
- **Free-text field names** — allowed in filter/projection selects (MISP has open-ended attribute types); still serialised/parsed as `.ident`.
- **Placeholders** (`{{…}}`) — pass through untouched (§6.2).
- **Unknown/legacy stored path** — raw fallback (§7); never rewritten.

---

## 12. Technical implementation notes

- **Pure, unit-testable core.** `buildPathFromQuery` and `parseQueryFromPath` are pure functions in `evaluationModel.js`. Property test over every condition path in `../../scenarios/*.json`: each path must be **either** (a) parsed and `build(parse(p))` **semantically equal** to `p` — asserted by running both through jq against the sample corpus and comparing extractions (§7.1) — **or** (b) `parse` returns `{ok:false}` (raw fallback). No third outcome allowed. This test is the safety net for G2. (A string-equality test is *not* sufficient because of the paren/pipe variants in §7.1.) **Implemented** as `tools/query-builder-property-test.mjs` — a dependency-free Node script (the repo has no JS test runner) that loads the module via a `data:` URL and shells out to the `jq` CLI (1.7, matching the engine's libjq) for the semantic check. Run: `node tools/query-builder-property-test.mjs`.
- **Recogniser over parser.** Do **not** attempt a general jq parser. Match against the finite preset/grammar set (§7); reject everything else. Small, auditable, and the fallback is already proven.
- **Reuse, don't rebuild.** Comparison/values UI, the raw escape hatch pattern, and `/injects/jq-path-test` all exist. Net new surface is the three-slot control + the two pure functions.
- **Keep generation and display in sync.** The colour-coded preview and the executable path derive from one `buildPathFromQuery` call (the prototype keeps a parallel HTML variant only because it has no shared renderer; the Vue impl should render once and colourise by segment offsets).

---

## 13. Supporting evidence & prototype

- **Clickable prototype** (concept ①, fully interactive; opens pre-loaded with the flagged example and proves byte-exact reproduction): <https://claude.ai/code/artifact/34e06f9a-e9e3-4158-857d-b351f201ff9f>
- **Path frequency analysis** — §2, derived from `../../scenarios/*.json`.
- **Parent redesign** — [PRD-inject-designer-redesign.md](./PRD-inject-designer-redesign.md); this builder realises its goal **G1** for the `path` sub-field.

---

## 14. Open questions & decisions

| # | Question | Proposed default |
|---|----------|------------------|
| OQ1 | Should the builder also cover `simulate_ips` (`.[].alert.signature`, `.[].verdict.action`) sources? | ✅ **Done** — delivered as the generic `list-items` preset (a bare `.[]` array) in the non-MISP fast-follow (§16 P1), covering Suricata alerts and bare-array search responses alike. |
| OQ2 | Per-condition raw toggle vs. the existing per-evaluation raw toggle — keep both? | Keep both. Per-condition raw for one gnarly path; per-evaluation raw for a whole custom parameters blob. |
| OQ3 | Expose `extract_type` at all in builder mode, or fully automatic (§6.1)? | Fully automatic; revisit if authors hit a case needing `all` without `count`/match-all. |
| OQ4 | Autocomplete filter/projection field names from a live sample event's keys? | ✅ **Done** — delivered as the P4 point-at-data slice (§16 P4). The sample's real field names now seed every field control in the builder. |

---

## 15. Success metrics

- **M1 (coverage)** ≥ 70% of library condition paths *by occurrence* open in builder mode. Measured progression, each slice keeping the §12 invariant (every path parses to a semantically-equal query **or** round-trips to raw **verbatim** — 0 rewrite errors): P1 single-level grammar **72%** occ / 56% distinct → **+ two-level object→attribute** **78%** occ / 68% distinct → **+ Tag/Note slice** (tag-name predicate, null-safe "has any tag", Note collection) **82.8%** occ (144/174) / **75.9%** distinct (60/79) → **+ non-MISP payload sources** (webhook root field `._secret`, bare-array `.[]` list — Suricata alerts, workflow-list responses) **90.8%** occ (158/174) / **82.3%** distinct (65/79). Remaining 14 fallbacks are map/group_by pipelines, sub-array projections (`… | .Tag[].name`), the union-with-inner-projection variant, the `.Sighting` null-guard and the irreducible `_AttributeFlattened` monsters.
- **M2 (no jq typed)** The flagged example — and every shape in the §2 table except the two monsters — is buildable with zero characters typed into a jq field. *(Verified: the generator reproduces the flagged example byte-for-byte — see the prototype's green banner.)*
- **M3 (parity)** For paths authored through the builder, byte-identical CEXF output vs. hand-authored canonical equivalents; for recognised legacy variants, **semantically identical** output (§7.1) with no churn on untouched conditions. Dashboard runs all affected scenarios unchanged.

---

## 16. Phased delivery

1. **P1 — Core + fallback. ✅ COMPLETE.**
   - `SOURCE_PRESETS` / `FILTER_FIELDS_BY_KIND` / `PROJECTIONS_BY_KIND` + pure `buildPathFromQuery` / `parseQueryFromPath` / `emptyQuery` / `sourceOptionsForStrategy` / `defaultQueryForSource` in `evaluationModel.js`, plus the `tools/query-builder-property-test.mjs` safety net (72% occurrence coverage, invariant verified over the whole library). Single-level grammar only (§7.1 scope note).
   - New `QueryBuilder.vue` (the FROM/WHERE/CHECK control — path only) wired into `ConditionRow.vue` behind `parseQueryFromPath`, with a per-condition raw-jq toggle and automatic raw fallback + "advanced jq" affordance for unrecognised paths. The comparison operator + values + `extract_type` stay in `ConditionRow`'s existing controls. Strategy scoping threaded via `EvaluationBuilder → ConditionRow → QueryBuilder`.
   - **Verified in-browser** (Playwright on a sandbox copy, read-only): builder renders the guard (`.Event.info`) as an event-field and reproduces the flagged example live from three controls; editing a filter updates the generated jq; raw toggle round-trips; two-level selects fall back verbatim with "advanced jq" alongside representable conditions in the same inject; **0 console/page errors**. Plus eslint clean + `vite build` green.
   - ✅ **Fast-follow — two-level object→attribute selects** (the top fallback cluster). `named-obj-attr` / `resp-named-obj-attr` presets + `objectFilters` in the query shape; recognises `.Event.Object[] | select(<obj>) [|] .Attribute[] [| select(<attr>)][.proj]`. Lifted coverage 72% → 78% occ.
   - ✅ **Fast-follow — Tag / Note slice** (the MISP-side fallbacks). Three shapes now open in the builder: (a) **tag-name predicate** `.Event.Tag[].name | select(contains(X))` (+ `.response[]` variant via a new `resp-tags` preset) — recognised through a new *project-then-self-select* parser branch and normalised to the canonical `.Event.Tag[] | select(.name | contains(X)).name` (jq-verified semantic-equal); (b) **null-safe "has any tag"** `.Event.Tag | select(length > 0) | .[].name` — a tag source with no WHERE filter serialises to this guard form (matches the library convention; avoids the error a bare `.Event.Tag[]` raises on a tagless event); (c) **Note collection** via new `notes` / `resp-notes` presets (`note` kind added to the WHERE/CHECK vocabularies). Lifted coverage 78% → **82.8% occ / 75.9% distinct**. `QueryBuilder.vue` unchanged (it derives vocab by `kind`). Verified: property test PASS (unit + recognise + sentence cases added), eslint clean, `vite build` green, Playwright 4/4 on the read-only sandbox (has-any-tag, tag-name predicate coexisting with a `._secret` raw fallback, Note under `misp_query_search`, and a `query_search` OR-pair rendering both local + response tag builders; 0 console/page errors). **Deferred** (documented as fallback in the property test): attribute→`.Tag[].name` sub-array projection and attribute→`.Sighting` null-guard — distinct multi-level-projection shapes.
2. **P2 — Live preview + validation. ✅ COMPLETE.**
   - **Plain-language sentence** — pure `describeCondition(query, comparison, values)` in `evaluationModel.js` (source `subject`/`item` phrasing added to `SOURCE_PRESETS`), rendered in `ConditionRow.vue` in builder mode ("In plain English: Pass when, looking at *every attribute in the event* where *its value is …*, its *to_ids* contains …"). Covered by `tools/query-builder-property-test.mjs` (unit cases + a no-throw check over every builder-mode library path).
   - **Inline `/injects/jq-path-test` per condition** — `ConditionRow.vue` debounces (350 ms) a `testJqPath({ path, data, extract_type })` call against the sample data on any path / sample / extract_type change, showing a **validity indicator** (✓ valid · ✗ jq error) + an **extracted-value preview** ("extracts `…`"). Works in both builder and raw modes. Scoped to `data_filtering` — the one strategy whose "Sample data" box holds the real data the rule runs on (response-wrapped strategies hit a live target, so a local sample would mislead). The sample data was lifted from `LiveTestPanel.vue` to `EvaluationBuilder.vue` (a shared `v-model:test-data`) so the preview reuses the very same sample the live test uses.
   - **Backend fix (non-obvious):** the engine's `jq_extract` (`tools/SkillAegis-Dashboard/backend/utils.py`) *swallows* `ValueError` and returns `None`, so a malformed path was indistinguishable from a valid-but-empty extraction. Added an Editor-local `jq.compile(path)` guard in `main.py testJqPath` (engine untouched) so a syntax error surfaces as `success:false` + a cleaned jq message, while valid-but-empty paths still return `null`. *Requires a backend restart to take effect.*
   - **Verified in-browser** (Playwright on the read-only sandbox, 8/8): both sentences render with exact expected copy; the preview strip shows on both conditions; editing the sample updates the extracted value live ("scam call today"); a malformed raw path shows a jq syntax error and a subsequent valid path clears it; **0 console/page errors**. Plus eslint clean, `vite build` green, property test PASS.
3. **P3 — Response & polish.** `resp-*` presets for `query_search`/`misp_query_search` (Q3), `is one of` / `matches`, "match all like this" ↔ `extract_type`, placeholder pass-through.
   - ✅ **Fast-follow — non-MISP payload sources** (the tool-agnostic frontier; addresses OQ1). Two new presets: **`webhook-field`** (a scalar `.<field>` on a raw webhook/HTTP payload, e.g. `._secret` — base `''`, single-level by design) and **`list-items`** (a bare `.[]` array — Suricata IPS alerts under `simulate_ips`, and search responses that are a plain array rather than `.response[].Event`, e.g. the MISP workflow-list API). `list-items` uses a **free-text CHECK** field (payload items have no fixed schema) and supports **dotted projections/filters** (`.verdict.action`, `.Workflow.name`) — the filter-field and projection regexes were generalised to `[A-Za-z_][\w.]*`, guarded by the corpus property test. **`sourceOptionsForStrategy(strategy, tool)`** is now tool-aware (webhook → payload sources; suricata → the alert list; wrapped MISP search → `.response[]` presets + `list-items`); `targetTool` is threaded `EvaluationBuilder → ConditionRow → QueryBuilder`. Lifted coverage 82.8% → **90.8% occ (158/174) / 82.3% distinct (65/79)**. Verified: property test PASS (unit build/recognise/sentence cases for both presets + dotted forms; `.data.value`, the union-inner-projection variant and the workflow map-monster added to `mustFallback`), eslint clean, `vite build` green, **Playwright 28/28** on the read-only sandbox (webhook `._secret` → payload-field builder; suricata C2-server → two `.[]` alert conditions with free-text CHECK; MISP `query_search` workflow-list → `.[].Workflow.*` builder coexisting with the `.response[]` presets in the FROM dropdown; 0 console/page errors; sandbox byte-identical after).
4. **P4 — point-at-data field suggestions. ✅ COMPLETE.** (Realises OQ4 / concept ②.) The sample event the author already types into the **Sample data** box now seeds every field control in the builder, so the vocabulary reflects the *actual* data the rule runs on rather than a fixed list:
   - Pure `fieldSuggestionsFromSample(query, sample)` in `evaluationModel.js` walks the source preset's `base`/`objBase` against the sample with a small **restricted jq-path walker** (`walkJqPath` — handles the `[a, b] | .[]` union wrapper and dotted `.Key` / `.Key[]` / `.[]` chains, matching the opening bracket to its own close), then unions the object keys at each level. Returns `{ eventFields, itemFields, objectFields }` and is **fail-soft** — any malformed sample/path yields empty lists (suggestions must never break the builder). Bare-array `list-items` samples contribute nothing (the sample box, like `/injects/jq-path-test`, expects an object), so those sources keep their tool-scoped static hints.
   - `QueryBuilder.vue` consumes it (via a new `sampleData` prop threaded `EvaluationBuilder → ConditionRow → QueryBuilder`): the FROM event/payload **field** input gains a `<datalist>` of the event's real keys; the open-ended `list-items` combobox merges sample keys ahead of the static hints; and the curated MISP WHERE / CHECK / object-filter `<select>`s gain an **"in your sample"** `<optgroup>` listing the sample-discovered fields the curated vocabulary doesn't already contain (so the curated names stay primary and nothing is lost).
   - Verified: property test **PASS** (new *Part A3* — 15 unit cases asserting the exact vocabulary derived per source kind: attr/obj/tag/note stream, event & payload-root field, two-level object→attribute, `.response[]` variants, plus null/unknown-source/empty/array-sample fail-soft cases; the walker's union-bracket matching is covered by the `all-attr`/`resp-attr` cases). eslint clean, `vite build` green, and a **Playwright drive** on the live build (Campaign inject with a `.Event.info` + all-attr condition, read-only — all mutating endpoints blocked at the route layer): typing a rich sample populated the event-field datalist with the eight real Event keys, surfaced the non-curated attribute fields (`first_seen`, `timestamp`, `uuid`) under an "in your sample" optgroup in the CHECK select, and a second optgroup appeared on an added WHERE filter — **10/10 checks, 0 console errors, 0 scenario writes**.
