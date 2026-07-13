<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  faTimes,
  faXmark,
  faArrowRightLong,
  faCode,
  faTableList,
  faCircleCheck,
  faCircleXmark,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'
import { testJqPath as testJqPathAPI } from '@/api'
import {
  OPERATORS,
  parseQueryFromPath,
  buildPathFromQuery,
  describeCondition,
} from '@/Views/scenario-designer/evaluationModel.js'
import QueryBuilder from '@/Views/scenario-designer/QueryBuilder.vue'

// A single condition: { path, comparison, values, extract_type }. Two-way bound
// so the parent's flat condition list stays in sync as it is edited.
const condition = defineModel('condition', {
  type: Object,
  required: true,
})

const props = defineProps({
  // Live-test feedback for this condition (optional).
  verdict: {
    type: String, // 'pass' | 'fail' | null
    default: null,
  },
  extracted: {
    type: String,
    default: null,
  },
  // Evaluation strategy — scopes the query builder's FROM options.
  strategy: {
    type: String,
    default: 'data_filtering',
  },
  // Parsed sample-data object the path preview runs against (null when the
  // sample is invalid/absent). Used only for the data_filtering path preview.
  sampleData: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['remove'])

const newValue = ref('')

function addValue() {
  const value = newValue.value.trim()
  if (value.length === 0) {
    return
  }
  condition.value.values.push(value)
  newValue.value = ''
}

function removeValue(index) {
  condition.value.values.splice(index, 1)
}

function onExtractAllToggle(event) {
  condition.value.extract_type = event.target.checked ? 'all' : ''
}

/* ---- query builder <-> path sync ---- */
// The condition's jq `path` is authored visually whenever it fits the
// FROM/WHERE/CHECK grammar; anything else falls back to the raw jq field.
const query = ref(null)
const representable = ref(true)
const forceRaw = ref(false)
let armed = false

const showBuilder = computed(
  () => representable.value && !forceRaw.value && query.value !== null
)

function reload() {
  const parsed = parseQueryFromPath(condition.value.path)
  representable.value = parsed.ok
  query.value = parsed.ok ? parsed.query : null
  armed = false
  nextTick(() => {
    armed = true
  })
}

// Builder edits → serialise back to the path (guarded so it doesn't fight the
// external-change watch below).
watch(
  query,
  () => {
    if (!armed || !query.value) {
      return
    }
    const built = buildPathFromQuery(query.value)
    if (built !== null && built !== condition.value.path) {
      condition.value.path = built
    }
  },
  { deep: true }
)

// Path changed from outside the builder (raw edit, or the parent swapped the
// condition) → re-parse. Skips our own writes.
watch(
  () => condition.value.path,
  (newPath) => {
    if (query.value && newPath === buildPathFromQuery(query.value)) {
      return
    }
    reload()
  }
)

function toggleRaw() {
  forceRaw.value = !forceRaw.value
  if (!forceRaw.value) {
    reload() // returning to the builder: pick up any raw edits
  }
}

/* ---- plain-language sentence (builder mode only) ---- */
const sentence = computed(() =>
  showBuilder.value
    ? describeCondition(query.value, condition.value.comparison, condition.value.values)
    : null
)

/* ---- live path preview (P2) ---- */
// Compile-check the condition's jq path against the sample data and preview what
// it extracts. data_filtering only: it is the one strategy whose "Sample data"
// box holds the actual data the rule runs on (query_search etc. hit a live
// target, so a local sample would be misleading).
const isDataFiltering = computed(() => props.strategy === 'data_filtering')
const pathState = ref('idle') // 'idle' | 'testing' | 'valid' | 'error'
const pathExtracted = ref(null)
const pathError = ref(null)

let pathTestTimer = null
let pathTestSeq = 0

function formatExtracted(value) {
  let text
  try {
    text = JSON.stringify(value)
  } catch (error) {
    text = String(value)
  }
  if (typeof text !== 'string') {
    text = String(text)
  }
  return text.length > 200 ? text.slice(0, 200) + '…' : text
}

function schedulePathTest() {
  if (pathTestTimer) {
    clearTimeout(pathTestTimer)
    pathTestTimer = null
  }
  const path = condition.value.path
  if (!isDataFiltering.value || !props.sampleData || typeof path !== 'string' || path.trim() === '') {
    pathState.value = 'idle'
    return
  }
  pathState.value = 'testing'
  pathTestTimer = setTimeout(runPathTest, 350)
}

async function runPathTest() {
  const path = condition.value.path
  const data = props.sampleData
  if (!isDataFiltering.value || !data || typeof path !== 'string' || path.trim() === '') {
    pathState.value = 'idle'
    return
  }
  const seq = (pathTestSeq += 1)
  try {
    const result = await testJqPathAPI({
      path,
      data,
      // Preview what the comparison actually receives ('' → backend 'first').
      extract_type: condition.value.extract_type || 'first',
    })
    if (seq !== pathTestSeq) {
      return // superseded by a newer test
    }
    if (result && result.success === false) {
      pathState.value = 'error'
      pathError.value = result.message || 'Invalid jq path'
      pathExtracted.value = null
    } else {
      pathState.value = 'valid'
      pathError.value = null
      pathExtracted.value = formatExtracted(result ? result.data : null)
    }
  } catch (error) {
    if (seq !== pathTestSeq) {
      return
    }
    pathState.value = 'error'
    pathError.value = String(error.message || error)
    pathExtracted.value = null
  }
}

watch(
  [
    () => condition.value.path,
    () => props.sampleData,
    () => condition.value.extract_type,
    isDataFiltering,
  ],
  schedulePathTest
)

onMounted(() => {
  reload()
  schedulePathTest()
})

onBeforeUnmount(() => {
  if (pathTestTimer) {
    clearTimeout(pathTestTimer)
  }
})
</script>

<template>
  <div
    class="relative rounded border px-2 py-2"
    :class="{
      'border-green-400 bg-green-50': verdict === 'pass',
      'border-red-400 bg-red-50': verdict === 'fail',
      'border-slate-300 bg-slate-50': verdict === null,
    }"
  >
    <span
      v-if="verdict !== null"
      class="absolute top-1.5 right-2 text-2xs font-bold px-1.5 py-0.5 rounded-full"
      :class="verdict === 'pass' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'"
    >
      {{ verdict === 'pass' ? 'match' : 'no match' }}
    </span>

    <div class="flex flex-col gap-1.5">
      <!-- path authoring: visual builder or raw jq -->
      <div class="flex flex-col gap-1.5">
        <!-- reserve room on the right for the absolute verdict badge so the raw/advanced toggle never sits under it -->
        <div class="flex items-center gap-2" :class="{ 'pr-20': verdict !== null }">
          <span class="text-2xs font-bold uppercase tracking-wide text-slate-400">Data to check</span>
          <button
            v-if="representable"
            type="button"
            class="ml-auto inline-flex items-center gap-1 text-2xs font-semibold select-none"
            :class="forceRaw ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'"
            @click="toggleRaw()"
            :title="forceRaw ? 'Switch to the visual builder' : 'Edit as raw jq'"
          >
            <FontAwesomeIcon :icon="forceRaw ? faTableList : faCode" class="fa-fw"></FontAwesomeIcon>
            {{ forceRaw ? 'use builder' : 'raw jq' }}
          </button>
          <span
            v-else
            class="ml-auto text-2xs font-semibold text-amber-600"
            title="This jq path is beyond the visual builder (e.g. a nested or computed query) — edit it directly."
          >
            advanced jq
          </span>
        </div>

        <QueryBuilder v-if="showBuilder" v-model:query="query" :strategy="strategy"></QueryBuilder>

        <input
          v-else
          type="text"
          v-model="condition.path"
          class="shadow-sm border border-slate-300 font-mono text-sm text-red-700 w-full rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white"
          placeholder=".Event.info"
          spellcheck="false"
        />

        <!-- live path preview: does the jq compile, and what does it pull from the sample? -->
        <div
          v-if="isDataFiltering && pathState !== 'idle'"
          class="flex items-baseline gap-1.5 text-2xs leading-relaxed"
        >
          <template v-if="pathState === 'testing'">
            <FontAwesomeIcon :icon="faSpinner" spin class="fa-fw text-slate-400"></FontAwesomeIcon>
            <span class="text-slate-400">checking against the sample…</span>
          </template>
          <template v-else-if="pathState === 'valid'">
            <FontAwesomeIcon :icon="faCircleCheck" class="fa-fw text-green-600"></FontAwesomeIcon>
            <span class="text-slate-500 shrink-0">extracts</span>
            <code
              class="font-mono text-slate-700 bg-white border border-slate-200 rounded px-1 py-0.5 break-all"
              >{{ pathExtracted }}</code
            >
          </template>
          <template v-else-if="pathState === 'error'">
            <FontAwesomeIcon :icon="faCircleXmark" class="fa-fw text-red-600"></FontAwesomeIcon>
            <span class="font-mono text-red-700 break-all">{{ pathError }}</span>
          </template>
        </div>
      </div>

      <!-- operator + values + remove -->
      <div class="flex gap-2 items-start">
        <select
          v-model="condition.comparison"
          class="shadow-sm border border-slate-300 rounded py-1 px-1 text-sm text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white font-mono shrink-0 w-32"
        >
          <option v-for="op in OPERATORS" :key="op" :value="op">{{ op }}</option>
        </select>

        <FontAwesomeIcon
          :icon="faArrowRightLong"
          class="fa-fw text-slate-400 mt-1.5 shrink-0"
        ></FontAwesomeIcon>

        <div
          class="flex flex-wrap gap-1 items-center border border-slate-300 rounded px-1.5 py-1 bg-white grow min-h-[2rem]"
        >
          <span
            v-for="(value, vi) in condition.values"
            :key="vi"
            class="inline-flex items-center gap-1 bg-blue-100 text-blue-800 border border-blue-300 rounded px-1.5 py-0.5 text-xs font-mono"
          >
            {{ value }}
            <button
              type="button"
              class="text-blue-500 hover:text-blue-800 font-bold leading-none"
              title="Remove value"
              @click="removeValue(vi)"
            >
              <FontAwesomeIcon :icon="faXmark"></FontAwesomeIcon>
            </button>
          </span>
          <input
            type="text"
            v-model="newValue"
            @keydown.enter.prevent="addValue()"
            @blur="addValue()"
            class="grow min-w-[4rem] border-none outline-none font-mono text-xs py-0.5 px-0.5 bg-transparent"
            placeholder="add value…"
            spellcheck="false"
          />
        </div>

        <button
          type="button"
          class="btn btn-sm btn-danger select-none shrink-0 !px-1.5"
          title="Remove condition"
          @click="emit('remove')"
        >
          <FontAwesomeIcon :icon="faTimes" class="fa-fw"></FontAwesomeIcon>
        </button>
      </div>

      <!-- plain-language restatement of the rule (builder mode only) -->
      <p v-if="sentence" class="text-xs text-slate-500 leading-snug">
        <span class="font-semibold text-slate-400">In plain English:</span>
        <span class="italic">{{ sentence }}</span>
      </p>

      <!-- footer: extracted preview + extract type -->
      <div class="flex items-center gap-2 flex-wrap text-xs text-slate-500">
        <label
          class="inline-flex items-center gap-1 cursor-pointer select-none"
          title="Extract all matches instead of just the first one (jq extract_type)"
        >
          <input
            type="checkbox"
            :checked="condition.extract_type === 'all'"
            @change="onExtractAllToggle"
          />
          match all results
        </label>
        <span v-if="extracted !== null && !isDataFiltering" class="ml-auto inline-flex items-center gap-1">
          extracted:
          <code class="font-mono bg-white border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded">{{ extracted }}</code>
        </span>
      </div>
    </div>
  </div>
</template>
