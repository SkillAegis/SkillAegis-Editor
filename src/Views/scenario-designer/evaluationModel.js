// Shared data model + helpers for the Inject evaluation authoring surfaces
// (EvaluationBuilder, ConditionRow, LiveTestPanel) and the Designer.
//
// CEXF reminder — an `inject_evaluation.parameters` is strategy dependent:
//  - comparison strategies (data_filtering, query_search, simulate_ips,
//    misp_query_search): an array of condition objects, each shaped like
//    { "<jq path>": { comparison, values, extract_type? }, ... }.
//    The backend ANDs every condition together (both across array entries and
//    across keys within an entry) so a flat list of conditions is lossless.
//  - query_mirror: an array of raw MISP query payload objects (no comparison).
//  - python: a single-element array holding the Python source string.

export const ALLOWED_TARGET_TOOLS = {
  MISP: 'MISP',
  suricata: 'Suricata',
  webhook: 'Webhook',
}

export const ALLOWED_STRATEGIES_FOR_TOOLS = {
  MISP: {
    data_filtering: 'Filter Event data',
    query_mirror: 'Perform the same query against MISP',
    query_search: 'Perform a search query on MISP and compare the returned result',
    python: 'Run a python function',
  },
  suricata: {
    simulate_ips: 'Simulate IPS strategy - Validate if an alert was raised',
  },
  webhook: {
    data_filtering: 'Filter data sent to the webhook endpoint',
    misp_query_search: 'Perform a web query on the provided MISP URL and compare the returned result',
    python: 'Run a python function',
  },
}

// Plain-language explanation of every evaluation strategy, shown next to the
// strategy selector so authors understand *what data gets checked* and *what
// they have to configure* — the two things the raw strategy key never conveys.
//
// This mirrors the runtime behaviour in SkillAegis-Dashboard
// (backend/target_tools/<tool>/exercise.py + backend/utils.py). Keep it in sync
// if the engine changes. `byTool` overrides the `source` line per target tool;
// `youConfigure` describes what the author fills in below.
export const STRATEGY_INFO = {
  data_filtering: {
    title: 'Inspect the resulting data',
    summary:
      'Checks your conditions straight against the data the trainee produced — no extra query is run.',
    youConfigure: 'a list of conditions (jq path → operator → values)',
    defaultSource: 'The data the trainee produced.',
    byTool: {
      MISP: {
        source:
          'The MISP event the trainee created or edited. SkillAegis reads the event id from the MISP audit log and fetches the whole event back from MISP.',
      },
      webhook: {
        source: "The raw JSON payload the trainee's tool sent to the webhook endpoint.",
      },
    },
    example: '.Event.info  contains  "phishing"',
  },
  query_search: {
    title: 'Run a search, then check the result',
    summary:
      'SkillAegis runs a search you define against MISP and checks your conditions against the response — no matter which action the trainee took to get there.',
    youConfigure: 'a Query context (URL, method, payload) + conditions on its result',
    defaultSource: 'The response of the MISP REST search you define in "Query context" below.',
    needsContext: true,
    note: 'This is the only MISP strategy besides Python that can run on a timer (periodic / triggered at).',
    example: '.response[].Event.info  regex  ".*phishing.*"',
  },
  misp_query_search: {
    title: 'Search MISP using the webhook data',
    summary:
      'Fills a MISP search with values pulled from the incoming webhook payload ({{placeholders}}), runs it, then checks your conditions against the result.',
    youConfigure: 'a Query context with {{placeholders}} + conditions on its result',
    defaultSource: 'The response of a MISP REST search built from the incoming webhook data.',
    needsContext: true,
    example: '.response[].Event.info  contains  "{{.alert.name}}"',
  },
  query_mirror: {
    title: "Match the trainee's query",
    summary:
      "Replays the trainee's exact query against MISP, runs your reference query too, and passes only if both return identical results.",
    youConfigure: 'a reference query to compare against (no conditions)',
    defaultSource:
      "Two MISP query results compared for equality — the trainee's query vs. your reference query.",
    needsContext: true,
    note: 'This is a strict equality check, not conditions. Put the reference query body in the raw "Query payload" box and its URL/method under "Query context".',
  },
  simulate_ips: {
    title: 'Simulate IPS — did an alert fire?',
    summary:
      "Pulls the trainee's Suricata rules from MISP, replays sample traffic through Suricata in IPS mode, and checks your conditions against the alerts that fired.",
    youConfigure: 'conditions on the fired-alert list',
    defaultSource:
      "The list of Suricata alerts that fired (verdict = drop) when the trainee's rules ran against the sample traffic.",
    example: '.[].alert.signature  contains  "malware"',
  },
  python: {
    title: 'Custom Python check',
    summary:
      "Runs your Python function in a sandbox with the data and context. Return True to pass. Reach for this when the condition builder can't express the check.",
    youConfigure: 'a Python function that returns True / False',
    defaultSource:
      'Whatever the tool provides (the MISP query result, or the webhook payload), handed to your function.',
  },
}

// Merge the base strategy info with any tool-specific override. Returns null for
// an unknown strategy so the caller can fall back gracefully.
export function getStrategyInfo(strategy, tool) {
  const base = STRATEGY_INFO[strategy]
  if (!base) {
    return null
  }
  const override = (base.byTool && base.byTool[tool]) || {}
  return {
    key: strategy,
    ...base,
    ...override,
    source: override.source || base.defaultSource,
  }
}

export const ALLOWED_TRIGGERS = {
  manual: 'Manually trigger by external tools',
  startex: 'Start of the exercise',
  periodic: 'Periodically runs based on the timing function',
  triggered_at: 'Runs once based on the timing function',
}

// Known keywords for inject_flow.sequence.completion_trigger — the only values
// used across the shipped scenario library. It is an open-ended string array in
// the schema, so unknown/custom values are preserved rather than dropped.
export const COMPLETION_TRIGGER_KEYWORDS = {
  completion: 'Its evaluation passes',
  time_expiration: 'Its timing window expires',
}

export const ALLOWED_TRIGGER_FOR_STRATEGIES = {
  periodic: {
    MISP: ['query_search', 'python'],
  },
  triggered_at: {
    MISP: ['query_search', 'python'],
  },
}

// Comparison operators — authoritative set from schema_inject_evaluation_parameters.json
export const OPERATORS = [
  'contains',
  'equals',
  'equals_any',
  'regex',
  'contains-regex',
  'count',
]

// Per-extracted-type documentation of the comparison operators (shown as help).
export const COMPARISON_OPERATOR_PER_TYPE = {
  string: {
    contains:
      'All values defined must be present in the data. Data will be split based on whitespace and lower-cased.',
    equals: 'The data must be equals to the value.',
    equals_any: 'At least one of the values must be present in the data.',
    regex: 'Perform a regex match on the data.',
    count:
      'count the length of the string and compare against the provided value.\n Accepted values are `[number]` or `[operator][number]`. Examples: 12, >3, <=2.',
  },
  list: {
    contains: 'All values defined must be present at least once in the data.',
    equals: 'All values defined must exactly be present in the data.',
    'equals-regex': 'The regex defined must exactly match the data.',
    'contains-regex': 'The regex defined must exactly match at least once in the data.',
    count:
      'count the amount of item and compare against the provided value.\n Accepted values are `[number]` or `[operator][number]`. Examples: 12, >3, <=2.',
  },
  object: {
    count:
      'count the amount of keys and compare against the provided value.\n Accepted values are `[number]` or `[operator][number]`. Examples: 12, >3, <=2.',
  },
}

// Strategies whose `parameters` is a list of comparison conditions and can be
// authored with the visual condition builder.
const COMPARISON_STRATEGIES = new Set([
  'data_filtering',
  'query_search',
  'simulate_ips',
  'misp_query_search',
])

// Strategies that reach out to a live MISP/endpoint via evaluation_context.query_context.
const CONTEXT_STRATEGIES = new Set([
  'query_search',
  'query_mirror',
  'misp_query_search',
  'simulate_ips',
  'python',
])

// Strategies the Editor's own /injects/test endpoint can actually evaluate.
const LIVE_TESTABLE_STRATEGIES = new Set(['data_filtering', 'query_search', 'python'])

export function isComparisonStrategy(strategy) {
  return COMPARISON_STRATEGIES.has(strategy)
}

export function usesQueryContext(strategy) {
  return CONTEXT_STRATEGIES.has(strategy)
}

export function isLiveTestable(strategy) {
  return LIVE_TESTABLE_STRATEGIES.has(strategy)
}

export function isPythonStrategy(strategy) {
  return strategy === 'python'
}

export function parseMaybeJSON(value) {
  if (typeof value !== 'string') {
    return { ok: true, value }
  }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch (error) {
    return { ok: false, error: String(error.message || error) }
  }
}

function toParameterArray(parameters) {
  if (Array.isArray(parameters)) {
    return parameters
  }
  if (typeof parameters === 'string') {
    try {
      const parsed = JSON.parse(parameters)
      return Array.isArray(parsed) ? parsed : null
    } catch (error) {
      return null
    }
  }
  return null
}

// Turn an evaluation's `parameters` into a flat list of editable conditions.
// Returns { ok:false } when the shape cannot be represented by the visual
// builder (raw payloads, malformed JSON, python code, ...), signalling the
// caller to fall back to the raw editor.
export function conditionsFromParameters(parameters) {
  const arr = toParameterArray(parameters)
  if (arr === null) {
    return { ok: false, conditions: [] }
  }
  const conditions = []
  for (const entry of arr) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, conditions: [] }
    }
    for (const [path, config] of Object.entries(entry)) {
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return { ok: false, conditions: [] }
      }
      if (!('comparison' in config) || !Array.isArray(config.values)) {
        return { ok: false, conditions: [] }
      }
      conditions.push({
        path,
        comparison: config.comparison,
        values: config.values.slice(),
        // '' means "unset" — the backend defaults to 'first'. Preserved as-is
        // so an untouched condition keeps whatever it had.
        extract_type: config.extract_type || '',
      })
    }
  }
  return { ok: true, conditions }
}

// Serialise the flat condition list back into CEXF `parameters` (one array
// entry per condition). Semantically identical to any grouped form.
export function parametersFromConditions(conditions) {
  return conditions.map((condition) => {
    const config = {
      comparison: condition.comparison,
      values: condition.values,
    }
    if (condition.extract_type) {
      config.extract_type = condition.extract_type
    }
    return { [condition.path]: config }
  })
}

export function emptyCondition() {
  return {
    path: '.Event.info',
    comparison: 'contains',
    values: [],
    extract_type: '',
  }
}

/* ==========================================================================
 * Guided query builder — FROM / WHERE / CHECK
 * See docs/redesign/PRD-condition-query-builder.md.
 *
 * A condition's jq `path` is modelled as a small query:
 *   { source, eventField?, filters: [{ field, op, value }], project }
 * `buildPathFromQuery` serialises it to the canonical jq string the engine
 * runs; `parseQueryFromPath` recognises a stored path back into a query, or
 * returns { ok:false } so the caller falls back to the raw jq field.
 *
 * The two are SEMANTIC inverses, not always byte-inverses: a recognised path
 * re-serialises to a semantically-identical expression, but redundant parens
 * (`select((.type == "x"))`) and a `select(...) | .field` pipe both normalise
 * to the canonical `select(.type == "x").field`. The library property test
 * (tools/query-builder-property-test.mjs) enforces this with jq.
 *
 * Sources are the single-level shapes plus the two-level object→attribute
 * drill (`.Event.Object[] | select(.name=="url") | .Attribute[] | select(...)`):
 * pick the objects, then treat their `.Attribute[]` as an attribute stream.
 * Tags and Notes are single-level streams too; tags additionally recognise the
 * library's project-then-self-select idiom (`.Event.Tag[].name | select(contains
 * (X))`, normalised to `.Event.Tag[] | select(.name | contains(X)).name`) and
 * the null-safe "has any tag" guard (`.Event.Tag | select(length > 0) | .[].name`,
 * emitted whenever a tag source carries no filter).
 * Still intentionally NOT recognised — these round-trip verbatim to the raw
 * field: multi-level projections into a sub-array (`… | .Tag[].name`), a select
 * after a projection that changes the field, unions embedding a scoped select,
 * and map/group_by pipelines.
 * ======================================================================== */

// FROM — the source collection. `base` is the jq prefix; `kind` drives the
// WHERE/CHECK vocabularies. `stream` sources iterate elements (an optional
// select() + a projected field apply); `event` sources are one scalar field.
// `subject` (collection phrase) + `item` (singular noun) feed the plain-language
// sentence in `describeCondition`.
export const SOURCE_PRESETS = {
  'all-attr': {
    label: 'Every attribute in the event',
    base: '[.Event.Object[].Attribute[], .Event.Attribute[]] | .[]',
    kind: 'attr',
    stream: true,
    subject: 'every attribute in the event',
    item: 'attribute',
  },
  'obj-attr': {
    label: 'Attributes inside objects only',
    base: '.Event.Object[].Attribute[]',
    kind: 'attr',
    stream: true,
    subject: 'every attribute inside an object',
    item: 'attribute',
  },
  // Two-level drill: filter which objects first, then their attributes. `objBase`
  // is the object collection; the WHERE/CHECK vocabularies come from `kind`
  // (attr, the *final* level), and the object-level filter lives in the query's
  // `objectFilters`. Excluded from the single-level stream loop (`stream: false`)
  // and parsed by `parseObjAttrPath` instead.
  'named-obj-attr': {
    label: 'Attributes inside a specific object',
    objBase: '.Event.Object[]',
    kind: 'attr',
    stream: false,
    twoLevel: true,
    item: 'attribute',
  },
  'top-attr': {
    label: 'Top-level attributes only',
    base: '.Event.Attribute[]',
    kind: 'attr',
    stream: true,
    subject: 'every top-level attribute',
    item: 'attribute',
  },
  objects: {
    label: "The event's objects",
    base: '.Event.Object[]',
    kind: 'obj',
    stream: true,
    subject: 'the event’s objects',
    item: 'object',
  },
  tags: {
    label: "The event's tags",
    base: '.Event.Tag[]',
    kind: 'tag',
    stream: true,
    subject: 'the event’s tags',
    item: 'tag',
  },
  notes: {
    label: "The event's notes",
    base: '.Event.Note[]',
    kind: 'note',
    stream: true,
    subject: 'the event’s notes',
    item: 'note',
  },
  'event-field': {
    label: 'A single field on the event',
    base: '.Event',
    kind: 'event',
    stream: false,
    subject: 'the event',
    item: 'event',
    owner: 'the event’s ',
  },
  // Response-wrapped variants (query_search / misp_query_search). Same
  // conceptual sources, with the `.response[]` wrapper chosen for the author.
  'resp-attr': {
    label: 'Every attribute in the search response',
    base: '[.response[].Event.Object[].Attribute[], .response[].Event.Attribute[]] | .[]',
    kind: 'attr',
    stream: true,
    subject: 'every attribute in the search response',
    item: 'attribute',
  },
  'resp-obj-attr': {
    label: 'Attributes inside response objects',
    base: '.response[].Event.Object[].Attribute[]',
    kind: 'attr',
    stream: true,
    subject: 'every attribute inside a response object',
    item: 'attribute',
  },
  'resp-named-obj-attr': {
    label: 'Attributes inside a specific response object',
    objBase: '.response[].Event.Object[]',
    kind: 'attr',
    stream: false,
    twoLevel: true,
    item: 'attribute',
  },
  'resp-objects': {
    label: 'The response events’ objects',
    base: '.response[].Event.Object[]',
    kind: 'obj',
    stream: true,
    subject: 'the search response’s objects',
    item: 'object',
  },
  'resp-tags': {
    label: 'The response events’ tags',
    base: '.response[].Event.Tag[]',
    kind: 'tag',
    stream: true,
    subject: 'the search response’s tags',
    item: 'tag',
  },
  'resp-notes': {
    label: 'The response events’ notes',
    base: '.response[].Event.Note[]',
    kind: 'note',
    stream: true,
    subject: 'the search response’s notes',
    item: 'note',
  },
  'resp-field': {
    label: 'A field on each response event',
    base: '.response[].Event',
    kind: 'event',
    stream: false,
    subject: 'each response event',
    item: 'event',
    owner: 'each response event’s ',
  },
  // Non-MISP payload sources (the tool-agnostic frontier). A webhook/HTTP payload
  // is arbitrary JSON rooted at the payload itself; a Suricata IPS run and some
  // search responses (e.g. the MISP workflow-list API) are a bare array. These
  // let those scenarios author in the builder instead of hand-writing jq.
  // `root: true` marks a scalar field of the payload root (base '' → `._secret`);
  // `freeProject: true` marks an open-ended CHECK field typed by the author
  // (payload items have no fixed vocabulary). Both are excluded from the MISP
  // FROM options by `sourceOptionsForStrategy` (via `nonMisp`).
  'webhook-field': {
    label: 'A field on the payload',
    base: '',
    kind: 'event',
    stream: false,
    root: true,
    nonMisp: true,
    subject: 'the payload',
    item: 'payload',
    owner: 'the payload’s ',
  },
  'list-items': {
    label: 'Each item in the list',
    base: '.[]',
    kind: 'item',
    stream: true,
    freeProject: true,
    nonMisp: true,
    subject: 'each item in the list',
    item: 'item',
  },
}

// WHERE — filterable fields per source kind (dropdown; free text also allowed).
export const FILTER_FIELDS_BY_KIND = {
  attr: ['value', 'type', 'category', 'to_ids', 'comment', 'object_relation'],
  obj: ['name', 'meta-category', 'distribution', 'comment'],
  tag: ['name'],
  note: ['note', 'language'],
}

// CHECK — projectable fields per source kind. '*self*' = the item itself (no
// projection suffix), paired with the `count` comparison ("how many match").
export const PROJECTIONS_BY_KIND = {
  attr: ['value', 'to_ids', 'type', 'category', 'comment', '*self*'],
  obj: ['name', 'distribution', '*self*'],
  tag: ['name'],
  note: ['note', '*self*'],
}

// Field-name suggestions for the open-ended `list-items` source (a bare `.[]`
// array). Unlike MISP kinds it has no fixed schema, so the vocabulary is keyed
// by *target tool* (what the array actually contains), NOT by kind — and every
// list is only a suggestion: the builder renders an editable combobox, so any
// custom field name can still be typed. Used for both the WHERE field and the
// CHECK projection (the same field paths serve as filter and projection).
export const ITEM_FIELD_SUGGESTIONS_BY_TOOL = {
  // Suricata IPS alerts (simulate_ips) — the fields of a fired alert.
  suricata: [
    'dest_ip',
    'src_ip',
    'dest_port',
    'src_port',
    'proto',
    'verdict.action',
    'alert.signature',
    'alert.category',
  ],
  // A MISP search returning a bare array (e.g. the workflow-list API).
  MISP: ['Workflow.name', 'Workflow.enabled'],
  // A webhook payload is arbitrary JSON, so there is no authoritative schema —
  // a few generic keys as a starting point; type the real field otherwise.
  webhook: ['value', 'type', 'timestamp', 'action'],
}

// WHERE operators (how each renders inside select(...)).
export const QUERY_FILTER_OPS = ['is', 'is-one-of', 'matches', 'contains']

// Render a JS string as a jq literal: true/false/integers/decimals bare,
// everything else a double-quoted string (placeholders like {{x}} included).
function jqLiteral(value) {
  const s = String(value).trim()
  if (s === 'true' || s === 'false') {
    return s
  }
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) {
    return s
  }
  return '"' + s.replace(/"/g, '\\"') + '"'
}

// Inverse of jqLiteral: unwrap a quoted string, otherwise keep the token as-is.
function jqUnliteral(token) {
  const s = token.trim()
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"')
  }
  return s
}

// Split `s` on `sep`, but only at paren depth 0 and outside double-quoted
// strings — so ` and `/` or ` inside a value or a nested group is preserved.
function splitTopLevel(s, sep) {
  const parts = []
  let depth = 0
  let inStr = false
  let cur = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (inStr) {
      cur += c
      if (c === '\\' && i + 1 < s.length) {
        cur += s[i + 1]
        i += 2
        continue
      }
      if (c === '"') {
        inStr = false
      }
      i += 1
      continue
    }
    if (c === '"') {
      inStr = true
      cur += c
    } else if (c === '(') {
      depth += 1
      cur += c
    } else if (c === ')') {
      depth -= 1
      cur += c
    } else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(cur)
      cur = ''
      i += sep.length
      continue
    } else {
      cur += c
    }
    i += 1
  }
  parts.push(cur)
  return parts
}

// Strip fully-wrapping outer parens ("(x)" → "x"), quote-aware, repeatedly.
// Leaves "(a) or (b)" untouched (the first "(" doesn't wrap the whole string).
function stripOuterParens(input) {
  let s = input.trim()
  while (s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') {
    let depth = 0
    let inStr = false
    let wraps = true
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i]
      if (inStr) {
        if (c === '\\') {
          i += 1
        } else if (c === '"') {
          inStr = false
        }
        continue
      }
      if (c === '"') {
        inStr = true
      } else if (c === '(') {
        depth += 1
      } else if (c === ')') {
        depth -= 1
        if (depth === 0 && i !== s.length - 1) {
          wraps = false
          break
        }
      }
    }
    if (!wraps) {
      break
    }
    s = s.slice(1, -1).trim()
  }
  return s
}

// One filter → its jq expression inside select(...).
function filterToJq(filter) {
  const field = '.' + filter.field
  if (filter.op === 'matches') {
    return field + ' | match(' + jqLiteral(filter.value) + ')'
  }
  if (filter.op === 'contains') {
    return field + ' | contains(' + jqLiteral(filter.value) + ')'
  }
  if (filter.op === 'is-one-of') {
    const parts = String(filter.value)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    if (parts.length <= 1) {
      return field + ' == ' + jqLiteral(parts[0] || '')
    }
    return '(' + parts.map((v) => field + ' == ' + jqLiteral(v)).join(' or ') + ')'
  }
  // 'is'
  return field + ' == ' + jqLiteral(filter.value)
}

// A filter is meaningful once it has a value ('matches' may legitimately be
// mid-authoring, but we still emit it rather than silently drop it).
function isMeaningfulFilter(filter) {
  return filter && (filter.value !== '' || filter.op === 'matches')
}

// A select() over a filter list ("select(A and B)").
function selectClause(filters) {
  return 'select(' + filters.map(filterToJq).join(' and ') + ')'
}

// Serialise a stream base's WHERE/CHECK tail: an optional " | select(...)" and
// an optional ".<field>" projection.
function streamTail(base, rawFilters, project) {
  const projSuffix = !project || project === '*self*' ? '' : '.' + project
  const filters = (rawFilters || []).filter(isMeaningfulFilter)
  if (filters.length > 0) {
    return base + ' | ' + selectClause(filters) + projSuffix
  }
  return projSuffix ? base + projSuffix : base
}

// The null-safe "has any tag" guard form for a tag stream base
// (`.Event.Tag[]` → `.Event.Tag | select(length > 0) | .[].name`). Tags with no
// WHERE filter serialise to this — it matches the library's convention and, on
// an event with no `.Event.Tag` at all, yields an empty stream rather than the
// error a bare `.Event.Tag[]` would raise.
function tagGuardForm(streamBase) {
  return streamBase.slice(0, -2) + ' | select(length > 0) | .[].name'
}

// Serialise a query object to its canonical jq path string. Returns null for
// an unknown source.
export function buildPathFromQuery(query) {
  if (!query || typeof query !== 'object') {
    return null
  }
  const preset = SOURCE_PRESETS[query.source]
  if (!preset) {
    return null
  }
  if (preset.kind === 'event') {
    return preset.base + '.' + (query.eventField || '')
  }
  if (preset.twoLevel) {
    // objBase | select(<objectFilters>) | .Attribute[] + attribute tail. With no
    // object filter it degenerates to the flat "objects' attributes" base
    // (`.Event.Object[].Attribute[]`), which is semantically identical.
    const objFilters = (query.objectFilters || []).filter(isMeaningfulFilter)
    const base =
      objFilters.length > 0
        ? preset.objBase + ' | ' + selectClause(objFilters) + ' | .Attribute[]'
        : preset.objBase + '.Attribute[]'
    return streamTail(base, query.filters, query.project)
  }
  if (preset.kind === 'tag') {
    // A tag stream with no WHERE filter is the "has any tag" check — emit the
    // null-safe guard form. A filtered tag stream keeps the plain stream base
    // (`.Event.Tag[] | select(.name …).name`), matching the library's own
    // convention that only the unfiltered case guards against a missing array.
    const filters = (query.filters || []).filter(isMeaningfulFilter)
    if (filters.length === 0) {
      return tagGuardForm(preset.base)
    }
  }
  return streamTail(preset.base, query.filters, query.project)
}

// Parse a single conjunction term of a select() body into a filter, or null.
function parseFilterTerm(input) {
  const term = stripOuterParens(input)
  // is-one-of: ".f == a or .f == b …" (all terms on the same field)
  const orParts = splitTopLevel(term, ' or ')
  if (orParts.length > 1) {
    const values = []
    let field = null
    for (const part of orParts) {
      const m = stripOuterParens(part).match(/^\.([A-Za-z_][\w.]*)\s*==\s*(.+)$/)
      if (!m) {
        return null
      }
      if (field === null) {
        field = m[1]
      } else if (field !== m[1]) {
        return null
      }
      values.push(jqUnliteral(m[2]))
    }
    return { field, op: 'is-one-of', value: values.join(', ') }
  }
  let m = term.match(/^\.([A-Za-z_][\w.]*)\s*\|\s*match\((.+)\)$/)
  if (m) {
    return { field: m[1], op: 'matches', value: jqUnliteral(m[2]) }
  }
  m = term.match(/^\.([A-Za-z_][\w.]*)\s*\|\s*contains\((.+)\)$/)
  if (m) {
    return { field: m[1], op: 'contains', value: jqUnliteral(m[2]) }
  }
  m = term.match(/^\.([A-Za-z_][\w.]*)\s*==\s*(.+)$/)
  if (m) {
    return { field: m[1], op: 'is', value: jqUnliteral(m[2]) }
  }
  return null
}

// Parse a select() body that predicates the streamed value ITSELF — a bare
// `contains(X)` / `match(X)` with no field prefix (the `.` is the whole item).
// The library uses it after projecting a scalar (tag name → select(contains…)).
// Returns { op, value } or null.
function parseSelfPredicate(body) {
  const term = stripOuterParens(body)
  let m = term.match(/^contains\((.+)\)$/)
  if (m) {
    return { op: 'contains', value: jqUnliteral(m[1]) }
  }
  m = term.match(/^match\((.+)\)$/)
  if (m) {
    return { op: 'matches', value: jqUnliteral(m[1]) }
  }
  return null
}

// Parse a whole select() body ("A and B and C") into a filter list, or null
// if any conjunct falls outside the recognised grammar.
function parseSelectBody(body) {
  const terms = splitTopLevel(stripOuterParens(body), ' and ')
  const filters = []
  for (const term of terms) {
    const filter = parseFilterTerm(term)
    if (!filter) {
      return null
    }
    filters.push(filter)
  }
  return filters
}

// Peel a "<prefix>…)" whose prefix ends in "(", using a balanced, quote-aware
// scan for the matching ")". Returns { body, after } — the text inside the
// parens and everything past the ")" — or null.
function scanBalanced(rest, prefix) {
  if (!rest.startsWith(prefix)) {
    return null
  }
  const open = prefix.length - 1 // index of '('
  let depth = 0
  let inStr = false
  let close = -1
  for (let i = open; i < rest.length; i += 1) {
    const c = rest[i]
    if (inStr) {
      if (c === '\\') {
        i += 1
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
    } else if (c === '(') {
      depth += 1
    } else if (c === ')') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) {
    return null
  }
  return { body: rest.slice(open + 1, close), after: rest.slice(close + 1) }
}

// Peel " | select(<body>)" (+ optional ".<ident>" projection) off `rest`.
// Returns { body, project } or null.
function peelSelect(rest) {
  const scanned = scanBalanced(rest, ' | select(')
  if (!scanned) {
    return null
  }
  let project = '*self*'
  if (scanned.after !== '') {
    // Accept both canonical "select(...).field" and the equivalent
    // "select(...) | .field" pipe form (normalised to the former, see §7.1).
    // A dotted field (`.verdict.action`) projects into a nested object.
    const m = scanned.after.match(/^(?: \| )?\.([A-Za-z_][\w.]*)$/)
    if (!m) {
      return null
    }
    project = m[1]
  }
  return { body: scanned.body, project }
}

// Parse what follows a stream preset's base: "" | ".<proj>" | select(...)[.proj].
function parseStreamRest(rest) {
  if (rest === '') {
    return { filters: [], project: '*self*' }
  }
  // A projection field, possibly dotted (`.dest_ip`, `.verdict.action`) — the
  // dotted form reaches into a nested object of a bare list item.
  const projOnly = rest.match(/^\.([A-Za-z_][\w.]*)$/)
  if (projOnly) {
    return { filters: [], project: projOnly[1] }
  }
  // Project-then-self-select: ".name | select(contains(X))". Normalise to a WHERE
  // on that field plus the projection, so it re-serialises via peelSelect as
  // `select(.name | contains(X)).name` (semantically identical — jq-verified).
  const projFirst = rest.match(/^\.([A-Za-z_]\w*) \| select\(/)
  if (projFirst) {
    const field = projFirst[1]
    const scanned = scanBalanced(rest.slice(('.' + field + ' | ').length), 'select(')
    if (scanned && scanned.after === '') {
      const pred = parseSelfPredicate(scanned.body)
      if (pred) {
        return { filters: [{ field, op: pred.op, value: pred.value }], project: field }
      }
    }
  }
  const peeled = peelSelect(rest)
  if (!peeled) {
    return null
  }
  const filters = parseSelectBody(peeled.body)
  if (!filters) {
    return null
  }
  return { filters, project: peeled.project }
}

// Stream presets, longest base first, so a longer base (obj-attr) is matched
// before a base that prefixes it (objects).
const STREAM_PRESETS_LONGEST_FIRST = Object.entries(SOURCE_PRESETS)
  .filter(([, preset]) => preset.stream)
  .sort((a, b) => b[1].base.length - a[1].base.length)

// Two-level object→attribute presets, longest objBase first (so the response
// variant is tried before the plain one — they don't prefix each other, but the
// ordering is harmless and future-proof).
const OBJATTR_PRESETS_LONGEST_FIRST = Object.entries(SOURCE_PRESETS)
  .filter(([, preset]) => preset.twoLevel)
  .sort((a, b) => b[1].objBase.length - a[1].objBase.length)

// Recognise a two-level object→attribute drill:
//   <objBase> | select(<objectFilters>) [|] .Attribute[] <attribute tail>
// The bridge between the object select and .Attribute[] appears in the library
// in two semantically-equal syntaxes — " | .Attribute[]" (pipe) and
// ".Attribute[]" (dot, straight off the select) — both accepted; the attribute
// tail is the same stream grammar as a single-level source. Returns { ok, query }
// or null (so parseQueryFromPath can fall through to the single-level loop).
function parseObjAttrPath(p) {
  for (const [key, preset] of OBJATTR_PRESETS_LONGEST_FIRST) {
    if (!p.startsWith(preset.objBase)) {
      continue
    }
    const scanned = scanBalanced(p.slice(preset.objBase.length), ' | select(')
    if (!scanned) {
      continue
    }
    const objectFilters = parseSelectBody(scanned.body)
    if (!objectFilters) {
      continue
    }
    let attrRest
    if (scanned.after.startsWith(' | .Attribute[]')) {
      attrRest = scanned.after.slice(' | .Attribute[]'.length)
    } else if (scanned.after.startsWith('.Attribute[]')) {
      attrRest = scanned.after.slice('.Attribute[]'.length)
    } else {
      continue
    }
    const rest = parseStreamRest(attrRest)
    if (!rest) {
      continue
    }
    return { ok: true, query: { source: key, objectFilters, ...rest } }
  }
  return null
}

// Recognise a stored jq path as a query, or return { ok:false } for the raw
// fallback. Never throws; never rewrites the input.
export function parseQueryFromPath(path) {
  if (typeof path !== 'string') {
    return { ok: false }
  }
  const p = path.trim()
  if (p === '') {
    return { ok: false }
  }
  // Scalar event fields (must be exactly ".Event.<ident>" / response variant).
  let m = p.match(/^\.response\[\]\.Event\.([A-Za-z_]\w*)$/)
  if (m) {
    return { ok: true, query: { source: 'resp-field', eventField: m[1], filters: [], project: '' } }
  }
  m = p.match(/^\.Event\.([A-Za-z_]\w*)$/)
  if (m) {
    return {
      ok: true,
      query: { source: 'event-field', eventField: m[1], filters: [], project: '' },
    }
  }
  // Non-MISP payload root field: a bare `.<field>` at the payload root (e.g.
  // `._secret` on a webhook payload). Checked AFTER the MISP `.Event`/`.response`
  // field forms above so it can never shadow them; single-level by design (a
  // dotted or nested root path stays raw).
  m = p.match(/^\.([A-Za-z_]\w*)$/)
  if (m) {
    return {
      ok: true,
      query: { source: 'webhook-field', eventField: m[1], filters: [], project: '' },
    }
  }
  // Two-level object→attribute drill (an object select feeding into .Attribute[]).
  // Tried before the single-level loop, which would otherwise reject it.
  const objAttr = parseObjAttrPath(p)
  if (objAttr) {
    return objAttr
  }
  // "Has any tag" guard form (`.Event.Tag | select(length > 0) | .[].name`) → an
  // unfiltered tag source. Not caught by the stream loop (its base is
  // `.Event.Tag[]`, which this doesn't start with), so recognise it explicitly.
  for (const [key, preset] of STREAM_PRESETS_LONGEST_FIRST) {
    if (preset.kind === 'tag' && p === tagGuardForm(preset.base)) {
      return { ok: true, query: { source: key, filters: [], project: 'name' } }
    }
  }
  for (const [key, preset] of STREAM_PRESETS_LONGEST_FIRST) {
    if (p === preset.base) {
      return { ok: true, query: { source: key, filters: [], project: '*self*' } }
    }
    if (p.startsWith(preset.base)) {
      const rest = parseStreamRest(p.slice(preset.base.length))
      if (rest) {
        return { ok: true, query: { source: key, ...rest } }
      }
    }
  }
  return { ok: false }
}

// A blank query for a new condition (mirrors emptyCondition's default path).
export function emptyQuery() {
  return { source: 'event-field', eventField: 'info', filters: [], project: '' }
}

// Source options to offer in the FROM dropdown for a given strategy + target
// tool. The data the conditions run on depends on both:
//   • Suricata / simulate_ips → the array of alerts that fired (`list-items`).
//   • webhook / data_filtering → the raw payload: a root object (`webhook-field`)
//     or a bare list (`list-items`). (webhook's misp_query_search runs a MISP
//     search, so it falls through to the wrapped-MISP branch below.)
//   • MISP data_filtering → the MISP event (`.Event.*` presets).
//   • Any wrapped MISP search (query_search / misp_query_search) → the response
//     events (`.response[]` presets), plus `list-items` for a response that is a
//     bare array (e.g. the MISP workflow-list API returns `[…]`, not
//     `{response:[{Event:…}]}`).
// The caller keeps the stored source visible even if it falls outside this set.
export function sourceOptionsForStrategy(strategy, tool) {
  const opt = (key) => ({ key, label: SOURCE_PRESETS[key].label })
  const wrapped = strategy === 'query_search' || strategy === 'misp_query_search'
  if (tool === 'suricata') {
    return ['list-items'].map(opt)
  }
  if (tool === 'webhook' && !wrapped) {
    return ['webhook-field', 'list-items'].map(opt)
  }
  const options = []
  for (const [key, preset] of Object.entries(SOURCE_PRESETS)) {
    if (preset.nonMisp) {
      // Only the bare-array list source, and only for a wrapped MISP search.
      if (key === 'list-items' && wrapped) {
        options.push(opt(key))
      }
      continue
    }
    if (key.startsWith('resp-') === wrapped) {
      options.push(opt(key))
    }
  }
  return options
}

// Default query for a source key (used when switching FROM across kinds).
export function defaultQueryForSource(source) {
  const preset = SOURCE_PRESETS[source]
  if (!preset || preset.kind === 'event') {
    // A payload root field starts blank (no MISP-style `.Event.info` default).
    const eventField = preset && preset.root ? '' : 'info'
    return { source: source || 'event-field', eventField, filters: [], project: '' }
  }
  const projections = PROJECTIONS_BY_KIND[preset.kind] || ['*self*']
  if (preset.twoLevel) {
    // Seed the object-level filter — "attributes inside a specific object" is
    // only meaningful once you say which object.
    return {
      source,
      objectFilters: [{ field: 'name', op: 'is', value: '' }],
      filters: [],
      project: projections[0],
    }
  }
  // A free-text CHECK (bare list items) has no fixed field to default to.
  const project = preset.freeProject ? '' : projections[0]
  return { source, eventField: 'info', filters: [], project }
}

/* ==========================================================================
 * Plain-language sentence — restate a condition in English (P2).
 * Pure + display-only: turns a recognised query + its comparison/values into a
 * one-line paraphrase so a non-jq author can sanity-check the rule. Returns null
 * when the query is unrecognised (the caller shows nothing in that case).
 * ======================================================================== */

// A value for display: true/false/numbers bare, everything else quoted.
function displayValue(value) {
  const s = String(value)
  if (s === 'true' || s === 'false' || /^-?\d+(\.\d+)?$/.test(s)) {
    return s
  }
  return '“' + s + '”'
}

function describeValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'a value'
  }
  return values.map(displayValue).join(', ')
}

// How a comparison operator + its values read as a predicate ("its X <this>").
// `count` is handled by the caller (it reads as a quantity, not a per-item check).
function comparisonPhrase(comparison, values) {
  const text = describeValues(values)
  switch (comparison) {
    case 'contains':
      return 'contains ' + text
    case 'equals':
      return (Array.isArray(values) && values.length === 1 ? 'is ' : 'equals ') + text
    case 'equals_any':
      return 'is one of ' + text
    case 'regex':
    case 'contains-regex':
      return 'matches the pattern ' + text
    default:
      return comparison + ' ' + text
  }
}

const FILTER_OP_PHRASE = {
  is: 'is',
  'is-one-of': 'is one of',
  matches: 'matches',
  contains: 'contains',
}

// One filter as an English clause ("<subject> type is X"). `subject` is the
// possessive that leads it ('its' for the streamed item, 'whose' for the object
// in a two-level drill).
function filterPhrase(filter, subject) {
  const op = FILTER_OP_PHRASE[filter.op] || filter.op
  let value
  if (filter.op === 'is-one-of') {
    value = String(filter.value)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map(displayValue)
      .join(', ')
  } else {
    value = displayValue(filter.value)
  }
  return (subject ? subject + ' ' : '') + filter.field + ' ' + op + ' ' + value
}

// The WHERE clause (" where its type is X and its to_ids is true"), or '' when
// there is no meaningful filter.
function describeFilters(filters) {
  const meaningful = (filters || []).filter(isMeaningfulFilter)
  if (meaningful.length === 0) {
    return ''
  }
  return ' where ' + meaningful.map((f) => filterPhrase(f, 'its')).join(' and ')
}

// Restate a condition in plain English. `query` is the parsed FROM/WHERE/CHECK
// object; `comparison`/`values` come from the condition. Returns null for an
// unrecognised source.
export function describeCondition(query, comparison, values) {
  if (!query || typeof query !== 'object') {
    return null
  }
  const preset = SOURCE_PRESETS[query.source]
  if (!preset) {
    return null
  }
  // Scalar field — the field itself is the subject. `owner` distinguishes the
  // MISP event, a response event, and a raw payload.
  if (preset.kind === 'event') {
    const field = query.eventField || '(field)'
    const owner = preset.owner || 'the event’s '
    return 'Pass when ' + owner + field + ' ' + comparisonPhrase(comparison, values) + '.'
  }
  let subject
  if (preset.twoLevel) {
    // "every attribute inside an object whose name is X" — the object filter
    // qualifies the subject; the attribute filter still reads as the WHERE.
    const objMeaningful = (query.objectFilters || []).filter(isMeaningfulFilter)
    const inside = objMeaningful.length
      ? 'an object whose ' + objMeaningful.map((f) => filterPhrase(f, '')).join(' and ')
      : 'any object'
    subject = 'every attribute inside ' + inside
  } else {
    subject = preset.subject || preset.label.toLowerCase()
  }
  const where = describeFilters(query.filters)
  const projected = query.project && query.project !== '*self*'
  if (comparison === 'count') {
    // Count reads as a quantity of items — the projection doesn't change the
    // count, so it never appears here. "matching" only when something narrows
    // the set (a WHERE, or a two-level object filter that qualifies the subject).
    const noun = (preset.item || 'item') + 's'
    const qualified =
      where !== '' ||
      (preset.twoLevel && (query.objectFilters || []).filter(isMeaningfulFilter).length > 0)
    const what = 'the number of ' + (qualified ? 'matching ' + noun : noun)
    return 'Pass when, looking at ' + subject + where + ', ' + what + ' is ' + describeValues(values) + '.'
  }
  const check = projected
    ? 'its ' + query.project + ' ' + comparisonPhrase(comparison, values)
    : 'each ' + (preset.item || 'item') + ' ' + comparisonPhrase(comparison, values)
  return 'Pass when, looking at ' + subject + where + ', ' + check + '.'
}
