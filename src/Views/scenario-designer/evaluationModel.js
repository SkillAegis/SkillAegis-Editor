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
 * P1 scope: single-level sources only. Two-level object→attribute selects
 * (`.Event.Object[] | select(.name=="url") | .Attribute[] | select(...)`),
 * multi-level projections (`.Tag[].name`), and map/group_by pipelines are
 * intentionally NOT recognised — they round-trip verbatim to the raw field.
 * ======================================================================== */

// FROM — the source collection. `base` is the jq prefix; `kind` drives the
// WHERE/CHECK vocabularies. `stream` sources iterate elements (an optional
// select() + a projected field apply); `event` sources are one scalar field.
export const SOURCE_PRESETS = {
  'all-attr': {
    label: 'Every attribute in the event',
    base: '[.Event.Object[].Attribute[], .Event.Attribute[]] | .[]',
    kind: 'attr',
    stream: true,
  },
  'obj-attr': {
    label: 'Attributes inside objects only',
    base: '.Event.Object[].Attribute[]',
    kind: 'attr',
    stream: true,
  },
  'top-attr': {
    label: 'Top-level attributes only',
    base: '.Event.Attribute[]',
    kind: 'attr',
    stream: true,
  },
  objects: {
    label: "The event's objects",
    base: '.Event.Object[]',
    kind: 'obj',
    stream: true,
  },
  tags: {
    label: "The event's tags",
    base: '.Event.Tag[]',
    kind: 'tag',
    stream: true,
  },
  'event-field': {
    label: 'A single field on the event',
    base: '.Event',
    kind: 'event',
    stream: false,
  },
  // Response-wrapped variants (query_search / misp_query_search). Same
  // conceptual sources, with the `.response[]` wrapper chosen for the author.
  'resp-attr': {
    label: 'Every attribute in the search response',
    base: '[.response[].Event.Object[].Attribute[], .response[].Event.Attribute[]] | .[]',
    kind: 'attr',
    stream: true,
  },
  'resp-obj-attr': {
    label: 'Attributes inside response objects',
    base: '.response[].Event.Object[].Attribute[]',
    kind: 'attr',
    stream: true,
  },
  'resp-objects': {
    label: 'The response events’ objects',
    base: '.response[].Event.Object[]',
    kind: 'obj',
    stream: true,
  },
  'resp-field': {
    label: 'A field on each response event',
    base: '.response[].Event',
    kind: 'event',
    stream: false,
  },
}

// WHERE — filterable fields per source kind (dropdown; free text also allowed).
export const FILTER_FIELDS_BY_KIND = {
  attr: ['value', 'type', 'category', 'to_ids', 'comment', 'object_relation'],
  obj: ['name', 'meta-category', 'distribution', 'comment'],
  tag: ['name'],
}

// CHECK — projectable fields per source kind. '*self*' = the item itself (no
// projection suffix), paired with the `count` comparison ("how many match").
export const PROJECTIONS_BY_KIND = {
  attr: ['value', 'to_ids', 'type', 'category', 'comment', '*self*'],
  obj: ['name', 'distribution', '*self*'],
  tag: ['name'],
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
  const projSuffix = !query.project || query.project === '*self*' ? '' : '.' + query.project
  const filters = (query.filters || []).filter(isMeaningfulFilter)
  if (filters.length > 0) {
    const select = 'select(' + filters.map(filterToJq).join(' and ') + ')'
    return preset.base + ' | ' + select + projSuffix
  }
  return projSuffix ? preset.base + projSuffix : preset.base
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
      const m = stripOuterParens(part).match(/^\.([A-Za-z_]\w*)\s*==\s*(.+)$/)
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
  let m = term.match(/^\.([A-Za-z_]\w*)\s*\|\s*match\((.+)\)$/)
  if (m) {
    return { field: m[1], op: 'matches', value: jqUnliteral(m[2]) }
  }
  m = term.match(/^\.([A-Za-z_]\w*)\s*\|\s*contains\((.+)\)$/)
  if (m) {
    return { field: m[1], op: 'contains', value: jqUnliteral(m[2]) }
  }
  m = term.match(/^\.([A-Za-z_]\w*)\s*==\s*(.+)$/)
  if (m) {
    return { field: m[1], op: 'is', value: jqUnliteral(m[2]) }
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

// Peel " | select(<body>)" (+ optional ".<ident>" projection) off `rest`.
// Uses a balanced, quote-aware scan for the matching ")". Returns
// { body, project } or null.
function peelSelect(rest) {
  const prefix = ' | select('
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
  const body = rest.slice(open + 1, close)
  const after = rest.slice(close + 1)
  let project = '*self*'
  if (after !== '') {
    // Accept both canonical "select(...).field" and the equivalent
    // "select(...) | .field" pipe form (normalised to the former, see §7.1).
    const m = after.match(/^(?: \| )?\.([A-Za-z_]\w*)$/)
    if (!m) {
      return null
    }
    project = m[1]
  }
  return { body, project }
}

// Parse what follows a stream preset's base: "" | ".<proj>" | select(...)[.proj].
function parseStreamRest(rest) {
  if (rest === '') {
    return { filters: [], project: '*self*' }
  }
  const projOnly = rest.match(/^\.([A-Za-z_]\w*)$/)
  if (projOnly) {
    return { filters: [], project: projOnly[1] }
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

// Source options to offer in the FROM dropdown for a given strategy: the
// response-wrapped strategies (query_search / misp_query_search) work on a
// `.response[]`-wrapped payload, so they get the resp-* presets; everything
// else gets the plain-event presets. The caller keeps the stored source
// visible even if it falls outside this set.
export function sourceOptionsForStrategy(strategy) {
  const wrapped = strategy === 'query_search' || strategy === 'misp_query_search'
  const options = []
  for (const [key, preset] of Object.entries(SOURCE_PRESETS)) {
    if (key.startsWith('resp-') === wrapped) {
      options.push({ key, label: preset.label })
    }
  }
  return options
}

// Default query for a source key (used when switching FROM across kinds).
export function defaultQueryForSource(source) {
  const preset = SOURCE_PRESETS[source]
  if (!preset || preset.kind === 'event') {
    return { source: source || 'event-field', eventField: 'info', filters: [], project: '' }
  }
  const projections = PROJECTIONS_BY_KIND[preset.kind] || ['*self*']
  return { source, eventField: 'info', filters: [], project: projections[0] }
}
