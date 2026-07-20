# Comparison operators reference

How each comparison operator (`contains`, `equals`, `equals_any`, `regex`,
`contains-regex`, `equals-regex`, `count`) actually behaves in an evaluation
condition.

This is derived from the **shared evaluation engine**
(`SkillAegis-Dashboard/backend/utils.py`), which both apps run: the Dashboard
directly, and the Editor via the `tools/SkillAegis-Dashboard` submodule. The
operator functions are **identical in both apps** — every behaviour below was
verified by exercising the engine directly. (One unrelated divergence exists in
value templating — see *Cross-app note* at the end.)

> A condition is `{ comparison, values }`. The engine first extracts data with
> your `jq` path, then applies the operator. **The operator that runs depends on
> the Python *type* of the extracted data**, not on the tool or strategy.

## Dispatch by extracted type

`condition_satisfied` (`utils.py:96`) routes on the extracted value's type:

| Extracted type | Handler | Notes |
|---|---|---|
| `str` | `eval_condition_str` (`utils.py:109`) | |
| `list` | `eval_condition_list` (`utils.py:134`) | |
| `dict` | `eval_condition_dict` (`utils.py:192`) | only `count` is implemented |
| `bool` | — | coerced to the string `"1"` (true) / `"0"` (false), then string rules |
| anything else | — | condition fails (`False`) |

An **empty `values` list always fails** (every handler guards `len(values)==0`).
Each value has `{{context}}` placeholders substituted **before** comparison.

## String operators (extracted data is a string)

| Operator | Meaning | Case | Values used | Passes when |
|---|---|---|---|---|
| `contains` | Whole-**word** membership | insensitive | **all** (AND) | data is split on whitespace into tokens; passes iff **every** value is one of those tokens |
| `equals` | Exact full-string equality | sensitive | `values[0]` only | `data == values[0]` |
| `equals_any` | Exact equality against any value | sensitive | all (OR) | `data` **exactly equals** one of the values |
| `regex` | **Full** regex match | per-pattern | `values[0]` only | `re.fullmatch(values[0], data)` — the *entire* string matches |
| `count` | String **length** | — | `values[0]` only | `len(data)` satisfies the count expression (see below) |

⚠️ **`contains` is token-based, not substring-based.** Data is
`data.lower().split()`. So:
- `"Phishing campaign"` **contains** `phishing` ✅ (whole token, case-insensitive)
- `"phishingcampaign"` **contains** `phishing` ❌ (no whitespace → single token `phishingcampaign`)
- `"phishing"` **contains** `phish` ❌ (token equality, not prefix/substring)
- multiple values are **AND**-ed: `"a b"` contains `["a","c"]` ❌

⚠️ **`equals_any` is exact equality, not containment.** `"malware campaign"`
with `equals_any=["malware"]` ❌ (whole string must equal a value).

⚠️ **`regex` is `fullmatch`.** `"abc123"` with `regex=[a-z]+` ❌ — the pattern
must match end-to-end. Use `.*` or `contains-regex`-style patterns if you want a
partial match.

## List operators (extracted data is a list)

| Operator | Meaning | Values used | Passes when |
|---|---|---|---|
| `contains` | Set superset | all | every value is present in the list (`set(data) ⊇ set(values)`) |
| `equals` | Set equality | all | the list and the values are the **same set** — **order and duplicates ignored** (`{'b','a','a'} == {'a','b'}` ✅) |
| `contains-regex` | Any element matches | `values[0]` | **at least one** element matches — via `re.match` (**anchored at the start**, not full) |
| `equals-regex` | *(see warning)* | `values[0]` | ⚠️ only the **first element** of the list is tested (`re.match`, start-anchored) — the loop returns on iteration one |
| `count` | Number of **items** | `values[0]` | `len(data)` satisfies the count expression |

Note: list `contains`/`equals` are **case-sensitive** (no lowercasing, unlike
string `contains`).

⚠️ **`equals-regex` only checks `data[0]`.** Despite the name/help ("the regex
must match the data"), the implementation (`utils.py:150-157`) returns on the
first list element. `['XXbad','good']` with `equals-regex=[good]` ❌ (first
element fails); `['goodstuff']` ✅ (start-anchored match on the one element). If
you need "all elements match", this operator does **not** do that today.

⚠️ **regex on lists uses `re.match` (start-anchored), not `fullmatch`.**
`['xgood']` with `contains-regex=[good]` ❌ (doesn't start with "good");
`['goodstuff']` ✅.

## Object operators (extracted data is a dict)

| Operator | Behaviour |
|---|---|
| `count` | Number of **keys** — `len(dict)` satisfies the count expression |
| `contains` | **Not implemented** — always fails (`utils.py:208-209`, a bare `pass`) |
| `equals` | **Not implemented** — always fails (`utils.py:210-211`, a bare `pass`) |

Only `count` is meaningful for a dict. The redesigned builder correctly offers
just `count` for the *object* type.

## `count` expression format

`count` compares the **size** of the extracted data — string length, list item
count, or dict key count — against `values[0]` (`count_comparison`,
`utils.py:168`). Accepted forms:

| Form | Example | Meaning |
|---|---|---|
| `N` (bare digits) | `3` | size **equals** N |
| `<N` `>N` `=N` | `>2`, `<10`, `=4` | size `<` / `>` / `=` N |
| `<=N` `>=N` | `<=2`, `>=5` | size `≤` / `≥` N |

Anything else (e.g. `abc`) returns `None` → the condition **fails**. Only
`values[0]` is used.

## Where the builder help text is misleading

The in-app operator help (`evaluationModel.js:161` / legacy
`InjectTester.vue`) is a good summary but glosses over the sharp edges above.
Concretely:

| Operator | Help says | Engine actually does |
|---|---|---|
| string `equals_any` | "at least one of the values must be **present in** the data" | exact equality (`data in values`) — not substring |
| string `regex` | "perform a regex match" | **full** match (`re.fullmatch`) |
| string `contains` | "values … present in the data (whitespace-split, lower-cased)" | whole-**token** match — not substring/prefix |
| list `equals-regex` | "the regex must exactly match the data" | only tests **`data[0]`**, `re.match` (start-anchored) |
| list `contains-regex` | "must exactly match at least once" | `re.match` (start-anchored, **not** full) on any element |

Also note two builder/engine surface mismatches:
- `equals-regex` is implemented in the engine and documented in the help, but is
  **not** in the redesigned builder's `OPERATORS` list (`evaluationModel.js:151`),
  so it can't be selected in the new UI (only editable via raw JSON).
- `equals_any` is offered for strings; on a **list** it is unhandled and simply
  fails.

## Cross-app note (value templating, not operators)

The operator functions match across both apps, but `apply_replacement_from_context`
— which resolves `{{...}}` placeholders inside `values` before comparison —
differs. The Editor's submodule is pinned to `79f83c2`, behind Dashboard
`develop`:

- **Dashboard (`develop`)**: resolves **multiple** independent `{{placeholder}}`
  occurrences per value, non-greedily.
- **Editor (submodule)**: effectively resolves a **single** placeholder per value.

So a templated value like `"{{.Event.info}}-{{.Event.uuid}}"` can compare
differently in the Editor's live test than on the live Dashboard. Plain
(non-templated) values are unaffected. Bumping the submodule closes the gap.

## Source of truth

`SkillAegis-Dashboard/backend/utils.py`: `condition_satisfied` (:96),
`eval_condition_str` (:109), `eval_condition_list` (:134), `count_comparison`
(:168), `eval_condition_dict` (:192).
