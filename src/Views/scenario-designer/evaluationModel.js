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

export const ALLOWED_TRIGGERS = {
  manual: 'Manually trigger by external tools',
  startex: 'Start of the exercise',
  periodic: 'Periodically runs based on the timing function',
  triggered_at: 'Runs once based on the timing function',
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
