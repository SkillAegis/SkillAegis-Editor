<script>
// Module-scoped counter for unique <datalist> ids — one per builder instance,
// so two builders with different tool-scoped suggestions don't collide.
let queryBuilderUid = 0
</script>

<script setup>
import { computed } from 'vue'
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import {
  SOURCE_PRESETS,
  FILTER_FIELDS_BY_KIND,
  PROJECTIONS_BY_KIND,
  ITEM_FIELD_SUGGESTIONS_BY_TOOL,
  QUERY_FILTER_OPS,
  buildPathFromQuery,
  defaultQueryForSource,
  sourceOptionsForStrategy,
  fieldSuggestionsFromSample,
} from '@/Views/scenario-designer/evaluationModel.js'

// The query object { source, eventField?, filters, project }. Two-way bound;
// the parent (ConditionRow) serialises it to the condition's jq path.
const query = defineModel('query', {
  type: Object,
  required: true,
})

const props = defineProps({
  // Strategy scopes the FROM options (query_search → .response[] presets).
  strategy: {
    type: String,
    default: 'data_filtering',
  },
  // Target tool scopes the FROM options too: webhook/suricata payloads are not
  // MISP events (webhook → payload sources, suricata → the alert list).
  tool: {
    type: String,
    default: 'MISP',
  },
  // Parsed sample event (or null). Its real field names are surfaced as
  // point-at-data suggestions wherever the author names a field.
  sampleData: {
    type: Object,
    default: null,
  },
})

const OP_LABELS = {
  is: 'is',
  'is-one-of': 'is one of',
  matches: 'matches regex',
  contains: 'contains',
}

const preset = computed(() => SOURCE_PRESETS[query.value.source])
const kind = computed(() => preset.value?.kind || 'event')
const isEvent = computed(() => kind.value === 'event')
const isResponse = computed(() => query.value.source?.startsWith('resp-'))
// A payload root field (webhook): a scalar `.<field>` on the payload itself.
const isRoot = computed(() => !!preset.value?.root)
// Two-level object→attribute source: an extra object-level filter picks which
// objects to dive into before the WHERE/CHECK run on their attributes.
const isTwoLevel = computed(() => !!preset.value?.twoLevel)
// A bare list item has no fixed schema, so its WHERE field and CHECK projection
// are editable comboboxes (type any field) rather than fixed dropdowns.
const freeProject = computed(() => !!preset.value?.freeProject)

const filterFields = computed(() => FILTER_FIELDS_BY_KIND[kind.value] || [])
const projections = computed(() => PROJECTIONS_BY_KIND[kind.value] || [])
// The object level always uses the object vocabulary (kind = 'obj').
const objectFilterFields = FILTER_FIELDS_BY_KIND.obj || []

// Point-at-data (P4): field names actually present in the loaded sample, so the
// builder can suggest them wherever a field is named. Pure hints — every control
// still accepts a value the sample doesn't contain.
const sampleSuggestions = computed(() => fieldSuggestionsFromSample(query.value, props.sampleData))
// Sample fields the curated dropdowns don't already list, surfaced under an "in
// your sample" optgroup so the curated names stay primary.
const filterFieldExtras = computed(() =>
  sampleSuggestions.value.itemFields.filter((f) => !filterFields.value.includes(f))
)
const projectionExtras = computed(() =>
  sampleSuggestions.value.itemFields.filter((f) => !projections.value.includes(f))
)
const objectFilterExtras = computed(() =>
  sampleSuggestions.value.objectFields.filter((f) => !objectFilterFields.includes(f))
)

// Suggestions for a `list-items` source's field/projection combobox: the sample's
// own item keys first (real data), then static hints scoped by target tool
// (Suricata alert fields vs. a webhook payload vs. a MISP bare-array response).
// Only a hint — any custom field can be typed. Unique datalist ids so two
// builders on the page don't share a suggestion list.
const itemFieldSuggestions = computed(() => {
  const staticHints = ITEM_FIELD_SUGGESTIONS_BY_TOOL[props.tool] || []
  return [...new Set([...sampleSuggestions.value.itemFields, ...staticHints])]
})
const uid = queryBuilderUid++
const fieldDatalistId = `qb-item-fields-${uid}`
const eventFieldDatalistId = `qb-event-fields-${uid}`

// FROM options for the strategy + tool, guaranteeing the stored source stays visible.
const sourceOptions = computed(() => {
  const options = sourceOptionsForStrategy(props.strategy, props.tool)
  if (query.value.source && !options.some((o) => o.key === query.value.source)) {
    const preset = SOURCE_PRESETS[query.value.source]
    options.push({ key: query.value.source, label: preset ? preset.label : query.value.source })
  }
  return options
})

const generatedPath = computed(() => buildPathFromQuery(query.value))

function projectionLabel(projection) {
  return projection === '*self*' ? '(the item itself)' : '.' + projection
}

// Switching FROM keeps filters/projection when the kind AND the level are
// unchanged (e.g. all-attr → obj-attr); crossing the single/two-level boundary
// (or changing kind) reshapes the query, so reset it to the source's default.
function onSourceChange(newSource) {
  const next = SOURCE_PRESETS[newSource]
  const sameKind = next?.kind === kind.value
  const sameLevel = !!next?.twoLevel === isTwoLevel.value
  if (sameKind && sameLevel) {
    query.value = { ...query.value, source: newSource }
  } else {
    query.value = defaultQueryForSource(newSource)
  }
}

function addFilter() {
  const field = freeProject.value
    ? itemFieldSuggestions.value[0] || 'value'
    : filterFields.value[0] || 'value'
  query.value.filters.push({ field, op: 'is', value: '' })
}

function removeFilter(index) {
  query.value.filters.splice(index, 1)
}

function addObjectFilter() {
  if (!Array.isArray(query.value.objectFilters)) {
    query.value.objectFilters = []
  }
  query.value.objectFilters.push({ field: objectFilterFields[0] || 'name', op: 'is', value: '' })
}

function removeObjectFilter(index) {
  query.value.objectFilters.splice(index, 1)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- shared field-name suggestions for a list-items source (tool-scoped) -->
    <datalist v-if="freeProject" :id="fieldDatalistId">
      <option v-for="f in itemFieldSuggestions" :key="f" :value="f"></option>
    </datalist>
    <!-- sample-derived field names for the event/payload FROM field (P4) -->
    <datalist v-if="isEvent && sampleSuggestions.eventFields.length" :id="eventFieldDatalistId">
      <option v-for="f in sampleSuggestions.eventFields" :key="f" :value="f"></option>
    </datalist>

    <!-- FROM -->
    <div class="rounded border border-slate-200 bg-white">
      <div class="flex items-center gap-2 px-2 py-1 border-b border-slate-100 bg-slate-50">
        <span
          class="font-mono text-2xs font-bold text-white bg-blue-500 rounded px-1 py-0.5 leading-none"
          >FROM</span
        >
        <span class="text-xs font-bold text-slate-600">Look at…</span>
      </div>
      <div class="p-2 flex flex-col gap-2">
        <select
          :value="query.source"
          @change="onSourceChange($event.target.value)"
          class="shadow-sm border border-slate-300 w-full rounded py-1 px-2 text-sm text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white"
        >
          <option v-for="opt in sourceOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
        <div v-if="isEvent" class="flex items-center gap-2">
          <span class="text-xs text-slate-500 shrink-0">field</span>
          <input
            type="text"
            v-model="query.eventField"
            :list="eventFieldDatalistId"
            class="shadow-sm border border-slate-300 font-mono text-sm text-red-700 w-full rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white"
            :placeholder="isRoot ? '_secret' : isResponse ? 'event_creator_email' : 'info'"
            spellcheck="false"
          />
        </div>

        <!-- object-level filter (two-level sources): which objects to dive into -->
        <div v-if="isTwoLevel" class="flex flex-col gap-1.5 rounded bg-violet-50 border border-violet-100 p-1.5">
          <div class="flex items-center gap-2">
            <span
              class="font-mono text-2xs font-bold text-white bg-violet-500 rounded px-1 py-0.5 leading-none"
              >IN OBJECT</span
            >
            <span class="text-xs font-semibold text-slate-600">Dive into objects where…</span>
          </div>
          <p v-if="(query.objectFilters || []).length === 0" class="text-2xs text-amber-600 italic">
            No object filter — this looks at every object's attributes.
          </p>
          <template v-for="(objFilter, oi) in query.objectFilters" :key="oi">
            <div v-if="oi > 0" class="text-2xs font-bold text-slate-400 text-center leading-none">
              AND
            </div>
            <div class="flex items-center gap-1.5">
              <select
                v-model="objFilter.field"
                class="shadow-sm border border-slate-300 rounded py-1 px-1 text-xs font-mono text-red-700 leading-tight focus:outline-none focus:border-slate-400 bg-white shrink-0 w-28"
              >
                <option v-for="f in objectFilterFields" :key="f" :value="f">.{{ f }}</option>
                <optgroup v-if="objectFilterExtras.length" label="in your sample">
                  <option v-for="f in objectFilterExtras" :key="f" :value="f">.{{ f }}</option>
                </optgroup>
                <option
                  v-if="!objectFilterFields.includes(objFilter.field) && !objectFilterExtras.includes(objFilter.field)"
                  :value="objFilter.field"
                >
                  .{{ objFilter.field }}
                </option>
              </select>
              <select
                v-model="objFilter.op"
                class="shadow-sm border border-slate-300 rounded py-1 px-1 text-xs text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white shrink-0 w-28"
              >
                <option v-for="op in QUERY_FILTER_OPS" :key="op" :value="op">
                  {{ OP_LABELS[op] }}
                </option>
              </select>
              <input
                type="text"
                v-model="objFilter.value"
                class="shadow-sm border border-slate-300 font-mono text-xs text-slate-700 grow rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white min-w-[4rem]"
                :placeholder="objFilter.op === 'is-one-of' ? 'url, domain-ip' : 'object name'"
                spellcheck="false"
              />
              <button
                type="button"
                class="btn btn-sm btn-danger select-none shrink-0 !px-1.5"
                title="Remove object filter"
                @click="removeObjectFilter(oi)"
              >
                <FontAwesomeIcon :icon="faXmark" class="fa-fw"></FontAwesomeIcon>
              </button>
            </div>
          </template>
          <div>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 select-none"
              @click="addObjectFilter()"
            >
              <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Add object filter
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- WHERE -->
    <div v-if="!isEvent" class="rounded border border-slate-200 bg-white">
      <div class="flex items-center gap-2 px-2 py-1 border-b border-slate-100 bg-slate-50">
        <span
          class="font-mono text-2xs font-bold text-white bg-amber-500 rounded px-1 py-0.5 leading-none"
          >WHERE</span
        >
        <span class="text-xs font-bold text-slate-600">{{
          isTwoLevel ? 'Then keep only the attributes where…' : 'Keep only the ones where…'
        }}</span>
        <span class="text-2xs text-slate-400 ml-auto">optional · all AND together</span>
      </div>
      <div class="p-2 flex flex-col gap-1.5">
        <p v-if="query.filters.length === 0" class="text-xs text-slate-400 italic">
          No filter — the check runs on all of them.
        </p>
        <template v-for="(filter, fi) in query.filters" :key="fi">
          <div v-if="fi > 0" class="text-2xs font-bold text-slate-400 text-center leading-none">
            AND
          </div>
          <div class="flex items-center gap-1.5">
            <!-- editable combobox for open-ended list items; fixed dropdown otherwise -->
            <input
              v-if="freeProject"
              type="text"
              v-model="filter.field"
              :list="fieldDatalistId"
              class="shadow-sm border border-slate-300 rounded py-1 px-1 text-xs font-mono text-red-700 leading-tight focus:outline-none focus:border-slate-400 bg-white shrink-0 w-28"
              placeholder="field"
              spellcheck="false"
            />
            <select
              v-else
              v-model="filter.field"
              class="shadow-sm border border-slate-300 rounded py-1 px-1 text-xs font-mono text-red-700 leading-tight focus:outline-none focus:border-slate-400 bg-white shrink-0 w-28"
            >
              <option v-for="f in filterFields" :key="f" :value="f">.{{ f }}</option>
              <optgroup v-if="filterFieldExtras.length" label="in your sample">
                <option v-for="f in filterFieldExtras" :key="f" :value="f">.{{ f }}</option>
              </optgroup>
              <option
                v-if="!filterFields.includes(filter.field) && !filterFieldExtras.includes(filter.field)"
                :value="filter.field"
              >
                .{{ filter.field }}
              </option>
            </select>
            <select
              v-model="filter.op"
              class="shadow-sm border border-slate-300 rounded py-1 px-1 text-xs text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white shrink-0 w-28"
            >
              <option v-for="op in QUERY_FILTER_OPS" :key="op" :value="op">
                {{ OP_LABELS[op] }}
              </option>
            </select>
            <input
              type="text"
              v-model="filter.value"
              class="shadow-sm border border-slate-300 font-mono text-xs text-slate-700 grow rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white min-w-[4rem]"
              :placeholder="filter.op === 'is-one-of' ? 'a, b, c' : 'value'"
              spellcheck="false"
            />
            <button
              type="button"
              class="btn btn-sm btn-danger select-none shrink-0 !px-1.5"
              title="Remove filter"
              @click="removeFilter(fi)"
            >
              <FontAwesomeIcon :icon="faXmark" class="fa-fw"></FontAwesomeIcon>
            </button>
          </div>
        </template>
        <div>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 select-none"
            @click="addFilter()"
          >
            <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Add filter
          </button>
        </div>
      </div>
    </div>

    <!-- CHECK -->
    <div v-if="!isEvent" class="rounded border border-slate-200 bg-white">
      <div class="flex items-center gap-2 px-2 py-1 border-b border-slate-100 bg-slate-50">
        <span
          class="font-mono text-2xs font-bold text-white bg-green-600 rounded px-1 py-0.5 leading-none"
          >CHECK</span
        >
        <span class="text-xs font-bold text-slate-600">Then check…</span>
      </div>
      <div class="p-2">
        <!-- open-ended item field (Suricata alert / webhook payload / workflow
             entry): pick a suggestion or type any field; blank = the item itself -->
        <div v-if="freeProject" class="flex items-center gap-2">
          <span class="font-mono text-sm text-slate-400 shrink-0">.</span>
          <input
            type="text"
            v-model="query.project"
            :list="fieldDatalistId"
            class="shadow-sm border border-slate-300 font-mono text-sm text-gray-700 w-full rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white"
            placeholder="field (blank = the item itself)"
            spellcheck="false"
          />
        </div>
        <select
          v-else
          v-model="query.project"
          class="shadow-sm border border-slate-300 w-full rounded py-1 px-2 text-sm font-mono text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white"
        >
          <option v-for="p in projections" :key="p" :value="p">{{ projectionLabel(p) }}</option>
          <optgroup v-if="projectionExtras.length" label="in your sample">
            <option v-for="p in projectionExtras" :key="p" :value="p">{{ projectionLabel(p) }}</option>
          </optgroup>
          <option
            v-if="!projections.includes(query.project) && !projectionExtras.includes(query.project)"
            :value="query.project"
          >
            {{ projectionLabel(query.project) }}
          </option>
        </select>
      </div>
    </div>

    <!-- generated jq preview -->
    <div class="flex items-baseline gap-2 text-2xs">
      <span class="uppercase tracking-wide font-bold text-slate-400 shrink-0">jq</span>
      <code class="font-mono text-red-700 break-all leading-relaxed">{{ generatedPath }}</code>
    </div>
  </div>
</template>
