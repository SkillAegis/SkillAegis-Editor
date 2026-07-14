#!/usr/bin/env node
//
// Property test for the guided query builder's pure core (buildPathFromQuery /
// parseQueryFromPath in src/Views/scenario-designer/evaluationModel.js).
// See docs/redesign/PRD-condition-query-builder.md §12.
//
// Run:  node tools/query-builder-property-test.mjs
// Exits non-zero on any invariant violation.
//
// Two parts:
//   A. Self-contained unit assertions (always run).
//   B. Library property test — for every distinct condition path in the real
//      scenario library (../scenarios, if present), enforce the invariant:
//        every path is EITHER parsed & re-serialised to a SEMANTICALLY-equal
//        jq expression (verified with the jq CLI where the string differs),
//        OR not parsed (raw fallback). No third outcome. Coverage is reported,
//        not asserted, so growth in the library never breaks the build.
//
// The repo has no JS test runner and isn't "type":"module", so this is a
// dependency-free Node script that loads the ESM module via a data: URL.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const modelPath = resolve(here, '../src/Views/scenario-designer/evaluationModel.js')
const modelSrc = readFileSync(modelPath, 'utf8')
const model = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(modelSrc))
const { buildPathFromQuery, parseQueryFromPath, describeCondition, fieldSuggestionsFromSample } =
  model

let failures = 0
const fail = (msg) => {
  failures += 1
  console.error('  \x1b[31m✗\x1b[0m ' + msg)
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ------------------------------------------------------------------ *
 * Part A — unit assertions
 * ------------------------------------------------------------------ */
console.log('\nPart A — unit assertions')

const FLAGGED =
  '[.Event.Object[].Attribute[], .Event.Attribute[]] | .[] | select(.value == "194.78.89.250").to_ids'
const flaggedQuery = {
  source: 'all-attr',
  filters: [{ field: 'value', op: 'is', value: '194.78.89.250' }],
  project: 'to_ids'
}

const cases = [
  // [label, query, expected canonical jq]
  ['flagged example', flaggedQuery, FLAGGED],
  ['event field', { source: 'event-field', eventField: 'info' }, '.Event.info'],
  [
    'response field',
    { source: 'resp-field', eventField: 'event_creator_email' },
    '.response[].Event.event_creator_email'
  ],
  [
    'union, project value, no filter',
    { source: 'all-attr', filters: [], project: 'value' },
    '[.Event.Object[].Attribute[], .Event.Attribute[]] | .[].value'
  ],
  [
    'obj-attr, filter type, project value',
    { source: 'obj-attr', filters: [{ field: 'type', op: 'is', value: 'sha1' }], project: 'value' },
    '.Event.Object[].Attribute[] | select(.type == "sha1").value'
  ],
  [
    'is-one-of',
    {
      source: 'objects',
      filters: [{ field: 'name', op: 'is-one-of', value: 'url, domain-ip' }],
      project: '*self*'
    },
    '.Event.Object[] | select((.name == "url" or .name == "domain-ip"))'
  ],
  [
    'matches regex, self',
    {
      source: 'all-attr',
      filters: [{ field: 'value', op: 'matches', value: '(0x)?281A77EA' }],
      project: '*self*'
    },
    '[.Event.Object[].Attribute[], .Event.Attribute[]] | .[] | select(.value | match("(0x)?281A77EA"))'
  ],
  [
    'two filters AND-ed',
    {
      source: 'top-attr',
      filters: [
        { field: 'type', op: 'is', value: 'text' },
        { field: 'value', op: 'is', value: 'Classified information' }
      ],
      project: 'distribution'
    },
    '.Event.Attribute[] | select(.type == "text" and .value == "Classified information").distribution'
  ],
  [
    'two-level: object name + attr type, project value',
    {
      source: 'named-obj-attr',
      objectFilters: [{ field: 'name', op: 'is', value: 'domain-ip' }],
      filters: [{ field: 'type', op: 'is', value: 'ip' }],
      project: 'value'
    },
    '.Event.Object[] | select(.name == "domain-ip") | .Attribute[] | select(.type == "ip").value'
  ],
  [
    'two-level: object is-one-of, no attr filter, project value',
    {
      source: 'named-obj-attr',
      objectFilters: [{ field: 'name', op: 'is-one-of', value: 'domain-ip, ip-port' }],
      filters: [],
      project: 'value'
    },
    '.Event.Object[] | select((.name == "domain-ip" or .name == "ip-port")) | .Attribute[].value'
  ],
  [
    'two-level: response variant, object_relation filter',
    {
      source: 'resp-named-obj-attr',
      objectFilters: [{ field: 'name', op: 'is', value: 'url' }],
      filters: [{ field: 'object_relation', op: 'is', value: 'ip' }],
      project: 'value'
    },
    '.response[].Event.Object[] | select(.name == "url") | .Attribute[] | select(.object_relation == "ip").value'
  ],
  [
    'two-level: no object filter degenerates to flat obj-attr base',
    { source: 'named-obj-attr', objectFilters: [], filters: [], project: 'value' },
    '.Event.Object[].Attribute[].value'
  ],
  [
    'tags: has any tag (no filter) → null-safe guard form',
    { source: 'tags', filters: [], project: 'name' },
    '.Event.Tag | select(length > 0) | .[].name'
  ],
  [
    'tags: name contains → field-select then project',
    { source: 'tags', filters: [{ field: 'name', op: 'contains', value: 'tlp:white' }], project: 'name' },
    '.Event.Tag[] | select(.name | contains("tlp:white")).name'
  ],
  [
    'resp-tags: name contains',
    {
      source: 'resp-tags',
      filters: [{ field: 'name', op: 'contains', value: 'misp-galaxy:mitre-attack-pattern' }],
      project: 'name'
    },
    '.response[].Event.Tag[] | select(.name | contains("misp-galaxy:mitre-attack-pattern")).name'
  ],
  [
    'notes: project .note',
    { source: 'notes', filters: [], project: 'note' },
    '.Event.Note[].note'
  ],
  // Non-MISP payloads (tool-agnostic sources).
  [
    'webhook: payload root field',
    { source: 'webhook-field', eventField: '_secret', filters: [], project: '' },
    '._secret'
  ],
  [
    'list-items: project a field (suricata alert)',
    { source: 'list-items', filters: [], project: 'dest_ip' },
    '.[].dest_ip'
  ],
  [
    'list-items: dotted projection (nested field)',
    { source: 'list-items', filters: [], project: 'verdict.action' },
    '.[].verdict.action'
  ],
  [
    'list-items: dotted projection (workflow entry)',
    { source: 'list-items', filters: [], project: 'Workflow.name' },
    '.[].Workflow.name'
  ],
  [
    'list-items: filter on dotted field + project (authored)',
    {
      source: 'list-items',
      filters: [{ field: 'verdict.action', op: 'is', value: 'allowed' }],
      project: 'alert.signature'
    },
    '.[] | select(.verdict.action == "allowed").alert.signature'
  ],
  [
    'list-items: no projection (the item itself)',
    { source: 'list-items', filters: [], project: '' },
    '.[]'
  ]
]

for (const [label, query, expected] of cases) {
  const built = buildPathFromQuery(query)
  if (built !== expected) {
    fail(`build "${label}"\n      expected: ${expected}\n      got:      ${built}`)
    continue
  }
  // round-trip: parse(build(q)) must reproduce a query that rebuilds identically
  const parsed = parseQueryFromPath(built)
  if (!parsed.ok) {
    fail(`parse "${label}" — expected ok, got fallback for: ${built}`)
    continue
  }
  const rebuilt = buildPathFromQuery(parsed.query)
  if (rebuilt !== built) {
    fail(`round-trip "${label}"\n      first:  ${built}\n      second: ${rebuilt}`)
    continue
  }
  console.log(`  \x1b[32m✓\x1b[0m ${label}`)
}

// paths that MUST fall back to raw (out of grammar scope)
const mustFallback = [
  // A dotted / nested payload root field: `webhook-field` is single-level by
  // design, so anything deeper than a bare `.<field>` stays raw.
  '.data.value',
  // Root-array map/group_by pipeline (webhook workflow list) — irreducible.
  '. | map( select(.Workflow.name | contains("x")) ) | .[].Workflow.name',
  // Union projecting a field INSIDE each arm before the flatten — distinct from
  // the recognised `[…] | .[].value` (projection after the flatten); deferred.
  '[.response[].Event.Object[].Attribute[].value, .response[].Event.Attribute[].value] | .[]',
  '.Event.Attribute | map(select(has("Tag"))) | length',
  // attr → tag: a select feeding a second-level projection into .Tag[] (a
  // sub-array projection — beyond the single-field CHECK; deferred).
  '.Event.Attribute[] | select(.value == "x") | .Tag[].name',
  // attribute → its Sighting with a null guard (projection into a sub-object +
  // self null-check — a distinct shape from the tag self-predicate; deferred).
  '.response[].Event.Attribute[].Sighting | select(. != null)',
  // union embedding a scoped object select — more than the two-level drill
  '[(.Event.Object[] | select((.name == "email")).Attribute[]), .Event.Attribute[]] | .[].value',
  // three-level: object select → attribute select → tag projection
  '.Event.Object[] | select(.name == "url") | .Attribute[] | select(.type == "url") | .Tag[].name'
]
for (const p of mustFallback) {
  if (parseQueryFromPath(p).ok) {
    fail(`expected raw fallback but parsed: ${p}`)
  } else {
    console.log(`  \x1b[32m✓\x1b[0m fallback: ${p.length > 52 ? p.slice(0, 52) + '…' : p}`)
  }
}

// Stored, non-canonical forms the library actually contains must be recognised
// into the expected query (they normalise to the canonical form on re-serialise;
// the semantic-equivalence of that normalisation is verified in Part B via jq).
const recogniseCases = [
  [
    '.Event.Tag[].name | select((contains("tlp:white")))',
    { source: 'tags', filters: [{ field: 'name', op: 'contains', value: 'tlp:white' }], project: 'name' }
  ],
  [
    '.response[].Event.Tag[].name | select((contains("misp-galaxy:mitre-attack-pattern")))',
    {
      source: 'resp-tags',
      filters: [{ field: 'name', op: 'contains', value: 'misp-galaxy:mitre-attack-pattern' }],
      project: 'name'
    }
  ],
  [
    '.Event.Tag | select(length > 0) | .[].name',
    { source: 'tags', filters: [], project: 'name' }
  ],
  // Non-MISP payload paths from the real library.
  [
    '._secret',
    { source: 'webhook-field', eventField: '_secret', filters: [], project: '' }
  ],
  [
    '.[].dest_ip',
    { source: 'list-items', filters: [], project: 'dest_ip' }
  ],
  [
    '.[].verdict.action',
    { source: 'list-items', filters: [], project: 'verdict.action' }
  ],
  [
    '.[].Workflow.enabled',
    { source: 'list-items', filters: [], project: 'Workflow.enabled' }
  ]
]
for (const [stored, expected] of recogniseCases) {
  const parsed = parseQueryFromPath(stored)
  if (!parsed.ok || JSON.stringify(parsed.query) !== JSON.stringify(expected)) {
    fail(
      `recognise "${stored}"\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(parsed.query)}`
    )
  } else {
    console.log(`  \x1b[32m✓\x1b[0m recognise: ${stored.length > 46 ? stored.slice(0, 46) + '…' : stored}`)
  }
}

/* ------------------------------------------------------------------ *
 * Part A2 — plain-language sentences (describeCondition)
 * ------------------------------------------------------------------ */
console.log('\nPart A2 — plain-language sentences')

const sentenceCases = [
  // [label, query, comparison, values, expected sentence]
  [
    'flagged example',
    flaggedQuery,
    'equals',
    ['true'],
    'Pass when, looking at every attribute in the event where its value is “194.78.89.250”, its to_ids is true.'
  ],
  [
    'event field contains',
    { source: 'event-field', eventField: 'info', filters: [], project: '' },
    'contains',
    ['phishing'],
    'Pass when the event’s info contains “phishing”.'
  ],
  [
    'objects count',
    { source: 'objects', filters: [{ field: 'name', op: 'is', value: 'suricata' }], project: '*self*' },
    'count',
    ['>=1'],
    'Pass when, looking at the event’s objects where its name is “suricata”, the number of matching objects is “>=1”.'
  ],
  [
    'response field equals_any',
    { source: 'resp-field', eventField: 'event_creator_email', filters: [], project: '' },
    'equals_any',
    ['a@x.test', 'b@x.test'],
    'Pass when each response event’s event_creator_email is one of “a@x.test”, “b@x.test”.'
  ],
  [
    'two-level object→attribute',
    {
      source: 'named-obj-attr',
      objectFilters: [{ field: 'name', op: 'is', value: 'domain-ip' }],
      filters: [{ field: 'type', op: 'is', value: 'ip' }],
      project: 'value'
    },
    'equals',
    ['9.9.9.9'],
    'Pass when, looking at every attribute inside an object whose name is “domain-ip” where its type is “ip”, its value is “9.9.9.9”.'
  ],
  [
    'tags: has any tag (count, no filter — no "matching")',
    { source: 'tags', filters: [], project: 'name' },
    'count',
    ['>0'],
    'Pass when, looking at the event’s tags, the number of tags is “>0”.'
  ],
  [
    'tags: name contains (count, filtered — "matching")',
    { source: 'tags', filters: [{ field: 'name', op: 'contains', value: 'tlp:white' }], project: 'name' },
    'count',
    ['>0'],
    'Pass when, looking at the event’s tags where its name contains “tlp:white”, the number of matching tags is “>0”.'
  ],
  [
    'notes: note contains',
    { source: 'notes', filters: [], project: 'note' },
    'contains',
    ['scam'],
    'Pass when, looking at the event’s notes, its note contains “scam”.'
  ],
  [
    'webhook: payload root field equals',
    { source: 'webhook-field', eventField: '_secret', filters: [], project: '' },
    'equals',
    ['__secret_key__'],
    'Pass when the payload’s _secret is “__secret_key__”.'
  ],
  [
    'list-items: project dotted field',
    { source: 'list-items', filters: [], project: 'verdict.action' },
    'equals',
    ['blocked'],
    'Pass when, looking at each item in the list, its verdict.action is “blocked”.'
  ],
  [
    'list-items: count of items',
    { source: 'list-items', filters: [], project: '' },
    'count',
    ['>=1'],
    'Pass when, looking at each item in the list, the number of items is “>=1”.'
  ]
]
for (const [label, query, comparison, values, expected] of sentenceCases) {
  const got = describeCondition(query, comparison, values)
  if (got !== expected) {
    fail(`sentence "${label}"\n      expected: ${expected}\n      got:      ${got}`)
  } else {
    console.log(`  \x1b[32m✓\x1b[0m sentence: ${label}`)
  }
}
// An unrecognised query yields no sentence (caller shows nothing).
if (describeCondition({ source: 'nope' }, 'contains', ['x']) !== null) {
  fail('sentence for unknown source should be null')
}

/* ------------------------------------------------------------------ *
 * Part A3 — point-at-data field suggestions (fieldSuggestionsFromSample)
 * The builder reads real field names from a sample so it can suggest them.
 * A compact sample with predictable keys lets us assert the exact vocabulary
 * derived at each level (event / item / object) per source kind.
 * ------------------------------------------------------------------ */
console.log('\nPart A3 — point-at-data field suggestions')

const SAMPLE = {
  Event: {
    info: 'x',
    uuid: 'u1',
    Attribute: [
      { type: 'ip-dst', value: '1.2.3.4', to_ids: true },
      { type: 'text', value: 'y', comment: 'c', object_relation: 'rel' }
    ],
    Object: [
      {
        name: 'file',
        'meta-category': 'file',
        Attribute: [{ type: 'sha1', value: 'abc', to_ids: false }]
      },
      { name: 'person', Attribute: [{ type: 'phone', value: '123', object_relation: 'from' }] }
    ],
    Tag: [{ name: 'tlp:red', colour: '#ff0000' }],
    Note: [{ note: 'hello', language: 'en' }]
  }
}
const RESP = { response: [SAMPLE] }
const WEBHOOK = { _secret: 's', action: 'create', id: 7 }

const sug = (source, sample) => fieldSuggestionsFromSample({ source }, sample)
const noFields = { eventFields: [], itemFields: [], objectFields: [] }
const attrVocab = ['comment', 'object_relation', 'to_ids', 'type', 'value']
const eventVocab = ['Attribute', 'Note', 'Object', 'Tag', 'info', 'uuid']

const suggestionCases = [
  // stream sources — item-level keys feed WHERE + CHECK
  ['all-attr (union of object + top attrs)', sug('all-attr', SAMPLE), { ...noFields, itemFields: attrVocab }],
  ['top-attr', sug('top-attr', SAMPLE), { ...noFields, itemFields: attrVocab }],
  ['objects', sug('objects', SAMPLE), { ...noFields, itemFields: ['Attribute', 'meta-category', 'name'] }],
  ['tags', sug('tags', SAMPLE), { ...noFields, itemFields: ['colour', 'name'] }],
  ['notes', sug('notes', SAMPLE), { ...noFields, itemFields: ['language', 'note'] }],
  // event / payload field sources — event-level keys feed the FROM `field` input
  ['event-field', sug('event-field', SAMPLE), { ...noFields, eventFields: eventVocab }],
  ['webhook-field (payload root keys)', sug('webhook-field', WEBHOOK), { ...noFields, eventFields: ['_secret', 'action', 'id'] }],
  // two-level — objects feed the object filter, their attributes feed WHERE/CHECK
  ['named-obj-attr', sug('named-obj-attr', SAMPLE), { eventFields: [], objectFields: ['Attribute', 'meta-category', 'name'], itemFields: ['object_relation', 'to_ids', 'type', 'value'] }],
  // response-wrapped variants walk through `.response[]`
  ['resp-attr', sug('resp-attr', RESP), { ...noFields, itemFields: attrVocab }],
  ['resp-field', sug('resp-field', RESP), { ...noFields, eventFields: eventVocab }],
  // fail-soft: bad/absent inputs and array-shaped samples yield nothing
  ['null query', fieldSuggestionsFromSample(null, SAMPLE), noFields],
  ['null sample', sug('all-attr', null), noFields],
  ['unknown source', sug('nope', SAMPLE), noFields],
  ['empty object sample', sug('all-attr', {}), noFields],
  ['list-items needs an array sample (object → nothing)', sug('list-items', SAMPLE), noFields]
]
for (const [label, got, want] of suggestionCases) {
  if (!eq(got, want)) {
    fail(`suggest "${label}"\n      expected: ${JSON.stringify(want)}\n      got:      ${JSON.stringify(got)}`)
  } else {
    console.log(`  \x1b[32m✓\x1b[0m suggest: ${label}`)
  }
}

/* ------------------------------------------------------------------ *
 * Part B — library property test
 * ------------------------------------------------------------------ */
console.log('\nPart B — library round-trip property')

// jq availability probe (semantic equivalence check for normalised paths).
let jqOk = true
try {
  execFileSync('jq', ['--version'], { stdio: 'ignore' })
} catch {
  jqOk = false
  console.log('  ⚠ jq CLI not found — semantic equivalence of normalised paths NOT verified.')
}

// Rich sample data so a rewrite that changes extraction is caught.
const EVENT = {
  Event: {
    info: 'Phishing campaign impersonating finance',
    published: true,
    distribution: '1',
    uuid: 'e1e2e3',
    event_creator_email: 'author@org.test',
    Attribute: [
      {
        type: 'ip-dst',
        value: '194.78.89.250',
        to_ids: true,
        category: 'Network activity',
        comment: 'c2'
      },
      {
        type: 'text',
        value: 'Classified information',
        to_ids: false,
        distribution: '2',
        category: 'Other'
      },
      { type: 'ip-dst', value: '1.2.3.4', to_ids: true, Tag: [{ name: 'tlp:red' }] },
      { type: 'domain', value: 'evil.example', to_ids: true },
      { type: 'vulnerability', value: 'CVE-2026-0001', to_ids: false },
      { type: 'yara', value: 'rule x {}', to_ids: false }
    ],
    Object: [
      {
        name: 'person',
        distribution: '1',
        Attribute: [{ type: 'phone-number', value: '+12243359185', to_ids: false }]
      },
      {
        name: 'file',
        Attribute: [
          { type: 'sha1', value: '04d496d39bc9409bfdabdeb07002b97093b58f77', to_ids: false },
          { type: 'filename', value: 'invoice_2026.exe', to_ids: true },
          { type: 'url', value: 'https://evil.example/bin.exe', to_ids: true }
        ]
      },
      { name: 'suricata', Attribute: [] },
      {
        name: 'email',
        Attribute: [{ type: 'email-src', value: 'billing@secure-pay.com', object_relation: 'from' }]
      },
      {
        name: 'domain-ip',
        Attribute: [
          { type: 'ip', value: '9.9.9.9', object_relation: 'ip' },
          { type: 'domain', value: 'd.example', object_relation: 'domain' },
          { type: 'text', value: 'note', object_relation: 'text' }
        ]
      },
      {
        name: 'url',
        Attribute: [
          { type: 'url', value: 'http://u.example', object_relation: 'url' },
          { type: 'hostname', value: 'h.example', object_relation: 'host' },
          { type: 'ip', value: '8.8.8.8', object_relation: 'ip' }
        ]
      }
    ],
    Tag: [{ name: 'tlp:white' }, { name: 'misp-galaxy:mitre-attack-pattern="T1566"' }]
  }
}
const RESPONSE = {
  response: [EVENT, { Event: { ...EVENT.Event, info: 'second event', uuid: 'e4e5e6' } }]
}
const SAMPLES = [JSON.stringify(EVENT), JSON.stringify(RESPONSE)]

// Run a jq program against one input; return a comparable outcome string.
function jqRun(program, input) {
  try {
    const out = execFileSync('jq', ['-c', program], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    })
    return 'OK:' + out
  } catch (err) {
    return 'ERR:' + (err.status ?? 'x')
  }
}
// Semantically equal if extraction matches on every sample input.
function semanticallyEqual(a, b) {
  if (!jqOk) {
    return null // unverified
  }
  return SAMPLES.every((input) => jqRun(a, input) === jqRun(b, input))
}

const scenariosDir = resolve(here, '../../scenarios')
if (!existsSync(scenariosDir)) {
  console.log(
    `  ⚠ scenario library not found at ${scenariosDir} — skipping (Part A still enforced).`
  )
} else {
  // Collect distinct condition paths with occurrence counts.
  const counts = new Map()
  const collect = (node) => {
    if (Array.isArray(node)) {
      node.forEach(collect)
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'comparison' in value) {
          counts.set(key, (counts.get(key) || 0) + 1)
        }
        collect(value)
      }
    }
  }
  for (const file of readdirSync(scenariosDir).filter((f) => f.endsWith('.json'))) {
    try {
      collect(JSON.parse(readFileSync(resolve(scenariosDir, file), 'utf8')))
    } catch {
      /* ignore unparseable scenario files */
    }
  }

  let distinctExact = 0
  let distinctNormalised = 0
  let distinctFallback = 0
  let distinctUnverified = 0
  let occTotal = 0
  let occParsed = 0
  const fallbackExamples = []

  for (const [path, count] of counts) {
    occTotal += count
    const parsed = parseQueryFromPath(path)
    if (!parsed.ok) {
      distinctFallback += 1
      if (fallbackExamples.length < 12) {
        fallbackExamples.push(path)
      }
      continue
    }
    occParsed += count
    const rebuilt = buildPathFromQuery(parsed.query)

    // Every builder-mode path must also produce a plain-language sentence.
    const sentence = describeCondition(parsed.query, 'contains', ['x'])
    if (typeof sentence !== 'string' || sentence.length === 0) {
      fail(`describeCondition produced no sentence for: ${path}`)
    }

    // Stability: re-parsing the rebuilt path yields the same query, and it is a
    // fixed point of build∘parse.
    const reparsed = parseQueryFromPath(rebuilt)
    if (!reparsed.ok || !eq(reparsed.query, parsed.query)) {
      fail(`unstable re-parse for: ${path}\n      rebuilt: ${rebuilt}`)
      continue
    }
    if (buildPathFromQuery(reparsed.query) !== rebuilt) {
      fail(`not a build∘parse fixed point: ${rebuilt}`)
      continue
    }

    if (rebuilt === path) {
      distinctExact += 1
    } else {
      const same = semanticallyEqual(path, rebuilt)
      if (same === false) {
        fail(`NORMALISATION CHANGED SEMANTICS\n      original: ${path}\n      rebuilt:  ${rebuilt}`)
      } else if (same === null) {
        distinctUnverified += 1
      } else {
        distinctNormalised += 1
      }
    }
  }

  const distinct = counts.size
  const parsedDistinct = distinctExact + distinctNormalised + distinctUnverified
  const pct = (n, d) => (d === 0 ? '0' : ((100 * n) / d).toFixed(1))

  console.log(`  distinct paths: ${distinct}   occurrences: ${occTotal}`)
  console.log(
    `  parsed (builder mode): ${parsedDistinct}/${distinct} distinct = ${pct(parsedDistinct, distinct)}%  ·  ${occParsed}/${occTotal} occurrences = ${pct(occParsed, occTotal)}%`
  )
  console.log(
    `    ├─ exact round-trip:      ${distinctExact}` +
      `\n    ├─ normalised (jq-equal): ${distinctNormalised}` +
      (distinctUnverified ? `\n    ├─ normalised (unverified, no jq): ${distinctUnverified}` : '') +
      `\n    └─ raw fallback:          ${distinctFallback}`
  )
  console.log('  fallback examples (round-trip verbatim, out of P1 grammar scope):')
  for (const p of fallbackExamples) {
    console.log(`      · ${p.length > 90 ? p.slice(0, 90) + '…' : p}`)
  }
  console.log(
    '  \x1b[32m✓\x1b[0m invariant holds: every path parsed→semantically-equal, or fell back.'
  )
}

/* ------------------------------------------------------------------ */
if (failures > 0) {
  console.error(`\n\x1b[31mFAILED\x1b[0m — ${failures} assertion(s) violated.\n`)
  process.exit(1)
}
console.log('\n\x1b[32mPASSED\x1b[0m — all assertions and the library invariant hold.\n')
