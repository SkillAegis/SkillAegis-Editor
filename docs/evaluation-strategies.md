# Evaluation strategies

An **inject evaluation** is how SkillAegis decides whether a trainee completed an
inject. Every evaluation is two things bolted together:

1. **A strategy** — *where the data to check comes from, and how it is fetched.*
   This is the `evaluation_strategy` field. It is the part authors find most
   confusing, because the raw key (`data_filtering`, `query_search`, …) describes
   the mechanism, not the intent.
2. **The check itself** — *the pass/fail rule applied to that data.* For most
   strategies this is a list of **conditions** (`jq path → operator → values`)
   built in the Designer's condition builder. Two strategies are special:
   `query_mirror` (an equality check) and `python` (arbitrary code).

The Designer shows a plain-language explainer next to the strategy selector; this
document is the deeper reference. The behaviour below matches the runtime engine
in **SkillAegis-Dashboard** (`backend/target_tools/<tool>/exercise.py` and
`backend/utils.py`) — keep this file in sync if that engine changes.

---

## Strategies by target tool

### MISP

| Strategy | What it checks | You configure |
|---|---|---|
| **`data_filtering`** — *Inspect the resulting data* | The MISP event the trainee created or edited. SkillAegis reads the event id from the MISP audit log and fetches the whole event back from MISP. | Conditions against the event JSON. No query context needed. |
| **`query_search`** — *Run a search, then check the result* | The response of a MISP REST search **you** define, run by SkillAegis. Independent of exactly which action the trainee took. | A **query context** (URL, method, payload) + conditions against the response. Can run on a timer (`periodic` / `triggered_at`). |
| **`query_mirror`** — *Match the trainee's query* | Two MISP query results compared for **strict equality**: the trainee's exact query, replayed, vs. your reference query. | The reference query — its body in the raw *Query payload* box, its URL/method in the query context. **No conditions.** |
| **`python`** — *Custom Python check* | The MISP query result, handed to your function. | A Python function returning `True`/`False`. |

### Webhook (tool-agnostic — any tool that can POST JSON)

| Strategy | What it checks | You configure |
|---|---|---|
| **`data_filtering`** — *Inspect the resulting data* | The raw JSON payload the trainee's tool sent to the webhook endpoint. | Conditions against the payload. |
| **`misp_query_search`** — *Search MISP using the webhook data* | The response of a MISP REST search built from the webhook payload, using `{{placeholders}}` interpolated from the incoming data. | A query context with placeholders + conditions against the result. |
| **`python`** — *Custom Python check* | The webhook payload, handed to your function. | A Python function returning `True`/`False`. |

### Suricata

| Strategy | What it checks | You configure |
|---|---|---|
| **`simulate_ips`** — *Simulate IPS — did an alert fire?* | The list of Suricata alerts that fired (`verdict = drop`) when the trainee's rules — pulled from MISP — ran against sample traffic in `--simulate-ips` mode. | Conditions against the fired-alert list (e.g. count `>= 1`, signature `contains`). |

> `data_filtering`, `query_search`, `misp_query_search` and `simulate_ips` all
> share the **same condition engine** — they differ only in where the data to
> check comes from.

---

## Conditions (`jq path → operator → values`)

Each condition:

1. **Extracts** a value from the data with a [jq](https://jqlang.github.io/jq/)
   path (`.Event.info`, `.response[].Event.event_creator_email`, …).
   - `extract_type: "first"` (default) takes the first match; `"all"` collects
     every match into a list, which changes how the operator behaves (see below).
2. **Compares** the extracted value against your `values` using an operator.

All conditions in an evaluation are **AND-ed** together and short-circuit on the
first failure — every condition must hold for the inject to pass.

### Operators

| Operator | On a string | On a list (`extract_type: all`) |
|---|---|---|
| `contains` | all values must appear (whitespace-split, lower-cased) | all values must appear at least once |
| `equals` | equal to the (first) value | the list equals exactly the value set |
| `equals_any` | equal to any one of the values | — |
| `regex` | full-match the value as a regex | — |
| `contains-regex` | — | regex matches at least one item |
| `count` | length of the string vs. the value | number of items vs. the value |

`count` accepts a bare number or a comparator prefix: `12`, `>3`, `<=2`, `>=1`.

### Placeholders

Any path or value may contain `{{...}}`, replaced at runtime from the exercise
**context** (e.g. `{{user_email}}`) or by a jq path evaluated against the
context. This is how per-trainee values are matched.

---

## Query context

`query_search`, `misp_query_search`, `query_mirror` and `simulate_ips` reach out
to a live MISP/endpoint. The `evaluation_context.query_context` object tells
SkillAegis what request to make:

```json
{
  "query_context": {
    "url": "/events/restSearch",
    "request_method": "POST",
    "payload": { "timestamp": "2h" }
  }
}
```

The payload/URL may use `{{placeholders}}` too. For target-backed strategies the
Designer's live-test panel offers an explicit **Run test** rather than firing on
every keystroke.

---

## Worked examples (from the shipped scenario library)

```jsonc
// data_filtering — the created event is about a phishing scam and is published
[
  { ".Event.info":      { "comparison": "contains", "values": ["scam", "call"] } },
  { ".Event.published": { "comparison": "equals",   "values": ["1"] } }
]

// query_search — an event created by *this* trainee whose info matches a pattern
// evaluation_context.query_context = { url: "/events/restSearch", request_method: "POST", payload: { timestamp: "6h" } }
[
  { ".response[].Event.event_creator_email": { "comparison": "equals", "values": ["{{user_email}}"] } },
  { ".response[].Event.info":                { "comparison": "regex",  "values": [".*team-[0-9]{2}.*"] } }
]

// simulate_ips — an alert dropped traffic to a known-bad IP
[
  {
    ".[].verdict.action": { "comparison": "equals", "values": ["drop"] },
    ".[].dest_ip":        { "comparison": "equals", "values": ["195.208.152.43"] }
  }
]
```
