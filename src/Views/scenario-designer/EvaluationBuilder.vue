<script setup>
import { Mode } from 'vanilla-jsoneditor'
import JsonEditorVue from 'json-editor-vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  faTrash,
  faPlus,
  faCode,
  faListCheck,
  faTriangleExclamation,
  faCircleQuestion,
} from '@fortawesome/free-solid-svg-icons'
import ConditionRow from '@/Views/scenario-designer/ConditionRow.vue'
import LiveTestPanel from '@/Views/scenario-designer/LiveTestPanel.vue'
import StrategyHelp from '@/Views/scenario-designer/StrategyHelp.vue'
import ComparisonOperatorsHelp from '@/Views/scenario-designer/ComparisonOperatorsHelp.vue'
import InjectEvaluationPythonEditorWrapper from '@/components/InjectEvaluationPythonEditorWrapper.vue'
import {
  ALLOWED_STRATEGIES_FOR_TOOLS,
  conditionsFromParameters,
  parametersFromConditions,
  emptyCondition,
  getStrategyInfo,
  isComparisonStrategy,
  isPythonStrategy,
  usesQueryContext,
} from '@/Views/scenario-designer/evaluationModel.js'

// The inject_evaluation object (two-way bound, edited in place).
const evaluation = defineModel('evaluation', {
  type: Object,
  required: true,
})

const props = defineProps({
  targetTool: {
    type: String,
    required: true,
  },
  index: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['remove'])

const strategy = computed(() => evaluation.value.evaluation_strategy)
const isComparison = computed(() => isComparisonStrategy(strategy.value))
const isPython = computed(() => isPythonStrategy(strategy.value))
const isQueryMirror = computed(() => strategy.value === 'query_mirror')

const strategyOptions = computed(() => {
  const scoped = ALLOWED_STRATEGIES_FOR_TOOLS[props.targetTool] || {}
  const options = { ...scoped }
  // Keep the stored strategy visible even if the tool no longer lists it.
  if (strategy.value && !(strategy.value in options)) {
    options[strategy.value] = strategy.value
  }
  return options
})

// Human-friendly label for a strategy option (falls back to the raw key).
function strategyLabel(strat) {
  const info = getStrategyInfo(strat, props.targetTool)
  return info ? info.title : strat
}

/* ---- condition builder <-> parameters sync ---- */
const localConditions = ref([])
const representable = ref(true)
const rawMode = ref(false)
let armed = false

function reload() {
  const { ok, conditions } = conditionsFromParameters(evaluation.value.parameters)
  representable.value = ok
  localConditions.value = ok ? conditions : []
  armed = false
  nextTick(() => {
    armed = true
  })
}

watch(
  localConditions,
  () => {
    if (!armed) {
      return
    }
    evaluation.value.parameters = parametersFromConditions(localConditions.value)
  },
  { deep: true }
)

const showConditionBuilder = computed(
  () => isComparison.value && representable.value && !rawMode.value
)
const showRawParams = computed(
  () => isQueryMirror.value || (isComparison.value && (!representable.value || rawMode.value))
)

function toggleRaw() {
  rawMode.value = !rawMode.value
  if (!rawMode.value) {
    reload() // returning to the visual builder: pick up any raw edits
  }
}

function addCondition() {
  if (rawMode.value || !representable.value) {
    return
  }
  localConditions.value.push(emptyCondition())
}

function removeCondition(i) {
  localConditions.value.splice(i, 1)
}

watch(strategy, (newStrategy) => {
  if (isPythonStrategy(newStrategy)) {
    const params = evaluation.value.parameters
    if (!(Array.isArray(params) && params.length === 1 && typeof params[0] === 'string')) {
      evaluation.value.parameters = ['']
    }
  } else if (isComparisonStrategy(newStrategy)) {
    // Coming from python code or a raw payload leaves parameters the builder
    // can't represent — start clean so the visual builder is usable.
    const { ok } = conditionsFromParameters(evaluation.value.parameters)
    if (!ok) {
      evaluation.value.parameters = []
    }
    rawMode.value = false
    reload()
  }
})

onMounted(() => {
  reload()
})

/* ---- context editor ---- */
const showContext = ref(usesQueryContext(strategy.value))
const showOperatorsHelp = ref(false)

/* ---- per-condition verdicts from the live test ---- */
const lastResultData = ref(null)
function onTestResult(data) {
  lastResultData.value = data
}

// Map the backend debug groups back onto the flat condition list. Only works
// when each group corresponds 1:1 to a condition (the normalised shape the
// builder writes); otherwise per-row verdicts are skipped.
const conditionResults = computed(() => {
  const debug = lastResultData.value?.debug
  if (!Array.isArray(debug) || debug.length === 0) {
    return null
  }
  const results = []
  for (const group of debug) {
    if (!Array.isArray(group)) {
      return null
    }
    const primaries = group.filter((m) => m && m.style === 'primary')
    if (primaries.length !== 1) {
      return null
    }
    const failed = group.some((m) => m && (m.style === 'fail' || m.style === 'error'))
    let extracted = null
    const extractedMsg = group.find(
      (m) => typeof m?.message === 'string' && m.message.includes('extracted the following data')
    )
    if (extractedMsg) {
      try {
        extracted = JSON.stringify(extractedMsg.data)
      } catch (error) {
        extracted = String(extractedMsg.data)
      }
    }
    results.push({ pass: !failed, extracted })
  }
  return results.length === localConditions.value.length ? results : null
})

function verdictFor(i) {
  const r = conditionResults.value
  if (!r || !r[i]) {
    return null
  }
  return r[i].pass ? 'pass' : 'fail'
}
function extractedFor(i) {
  return conditionResults.value?.[i]?.extracted ?? null
}
</script>

<template>
  <div class="relative flex flex-col gap-3 rounded-lg border border-slate-400 bg-slate-100 p-3">
    <!-- header -->
    <div class="flex items-center gap-2">
      <span class="font-semibold text-slate-700">Evaluation {{ index + 1 }}</span>
      <span
        class="font-mono text-2xs text-red-700 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5"
      >
        {{ strategy }}
      </span>
      <button
        class="ml-auto btn btn-sm btn-danger select-none"
        title="Remove evaluation"
        @click="emit('remove')"
      >
        <FontAwesomeIcon :icon="faTrash" class="fa-fw"></FontAwesomeIcon>
      </button>
    </div>

    <div class="flex flex-col lg:flex-row gap-4 items-start">
      <!-- builder column -->
      <div class="w-full lg:basis-3/5 flex flex-col gap-3">
        <!-- strategy / result / score -->
        <div class="flex flex-wrap gap-3">
          <div class="grow min-w-[12rem]">
            <label class="block text-sm font-bold text-gray-700 mb-1">Evaluation Strategy</label>
            <select
              v-model="evaluation.evaluation_strategy"
              class="shadow-sm border border-slate-300 w-full rounded py-1.5 px-2 text-sm text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white"
            >
              <option
                v-for="(info, strat) in strategyOptions"
                :key="strat"
                :value="strat"
                :title="info"
              >
                {{ strategyLabel(strat) }} · {{ strat }}
              </option>
            </select>
          </div>
          <div class="grow min-w-[10rem]">
            <label class="block text-sm font-bold text-gray-700 mb-1">Result label</label>
            <input
              type="text"
              v-model="evaluation.result"
              class="shadow-sm border border-slate-300 font-mono text-sm w-full rounded py-1.5 px-2 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
              placeholder="Data created"
            />
          </div>
          <div class="w-24">
            <label class="block text-sm font-bold text-gray-700 mb-1">Max score</label>
            <input
              type="number"
              min="0"
              v-model.number="evaluation.score_range[1]"
              class="shadow-sm border border-slate-300 font-mono text-sm w-full rounded py-1.5 px-2 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
              placeholder="20"
            />
          </div>
        </div>

        <!-- what this strategy does -->
        <StrategyHelp :strategy="strategy" :target-tool="targetTool"></StrategyHelp>

        <ComparisonOperatorsHelp
          :show="showOperatorsHelp"
          @close="showOperatorsHelp = false"
        ></ComparisonOperatorsHelp>

        <!-- parameters -->
        <div>
          <div class="flex items-center gap-2 mb-1">
            <label class="text-sm font-bold text-gray-700">
              {{ isPython ? 'Python function' : isQueryMirror ? 'Query payload' : 'Conditions' }}
            </label>
            <button
              v-if="isComparison"
              type="button"
              class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 select-none hover:text-blue-900"
              @click="showOperatorsHelp = true"
              title="What each comparison operator does"
            >
              <FontAwesomeIcon :icon="faCircleQuestion" class="fa-fw"></FontAwesomeIcon>
              operators
            </button>
            <button
              v-if="isComparison"
              type="button"
              class="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold select-none"
              :class="rawMode ? 'text-blue-700' : 'text-slate-500'"
              @click="toggleRaw()"
              :title="representable ? 'Toggle raw jq/JSON editing' : 'Parameters use a custom shape — edit as raw JSON'"
            >
              <FontAwesomeIcon :icon="faCode" class="fa-fw"></FontAwesomeIcon>
              raw jq/JSON
              <span
                class="relative inline-block w-8 h-4 rounded-full transition-colors"
                :class="rawMode ? 'bg-blue-500' : 'bg-slate-300'"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                  :class="rawMode ? 'translate-x-4' : ''"
                ></span>
              </span>
            </button>
          </div>

          <!-- python editor -->
          <div v-if="isPython">
            <InjectEvaluationPythonEditorWrapper
              v-model="evaluation.parameters"
            ></InjectEvaluationPythonEditorWrapper>
          </div>

          <!-- visual condition builder -->
          <div v-else-if="showConditionBuilder" class="flex flex-col gap-2">
            <Alert
              v-if="localConditions.length === 0"
              variant="info"
              title="No condition yet"
              message="Add a condition to define when this evaluation passes. All conditions must hold."
            ></Alert>
            <ConditionRow
              v-for="(condition, ci) in localConditions"
              :key="ci"
              :condition="condition"
              :strategy="strategy"
              :verdict="verdictFor(ci)"
              :extracted="extractedFor(ci)"
              @remove="removeCondition(ci)"
            ></ConditionRow>
            <div class="flex items-center gap-2">
              <button class="btn btn-sm btn-success select-none" @click="addCondition()">
                <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Add condition
              </button>
              <span class="text-xs text-slate-500">
                All conditions in an evaluation must hold (AND).
              </span>
            </div>
          </div>

          <!-- raw parameters editor (query_mirror payload, non-representable, or raw toggle) -->
          <div v-else-if="showRawParams">
            <div
              v-if="isComparison && !representable"
              class="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-1"
            >
              <FontAwesomeIcon :icon="faTriangleExclamation" class="fa-fw mt-0.5"></FontAwesomeIcon>
              <span>
                These parameters use a custom structure the visual builder can't display. Edit them
                as raw JSON below.
              </span>
            </div>
            <JsonEditorVue
              v-model="evaluation.parameters"
              :mode="Mode.text"
              :mainMenuBar="false"
              :navigationBar="false"
              :statusBar="false"
              :indentation="2"
              class="shadow-sm border border-slate-300 w-full"
            />
          </div>

          <!-- fallback for unknown strategies -->
          <div v-else>
            <JsonEditorVue
              v-model="evaluation.parameters"
              :mode="Mode.text"
              :mainMenuBar="false"
              :navigationBar="false"
              :statusBar="false"
              :indentation="2"
              class="shadow-sm border border-slate-300 w-full"
            />
          </div>
        </div>

        <!-- evaluation context (advanced) -->
        <details class="rounded border border-dashed border-slate-300 bg-slate-50" :open="showContext">
          <summary class="cursor-pointer select-none px-2 py-1.5 text-xs font-semibold text-slate-600">
            <FontAwesomeIcon :icon="faListCheck" class="fa-fw"></FontAwesomeIcon>
            Evaluation context
            <span class="font-normal text-slate-400">
              {{ usesQueryContext(strategy) ? 'query_context (URL, method, payload)' : 'usually empty for data_filtering' }}
            </span>
          </summary>
          <div class="px-2 pb-2">
            <JsonEditorVue
              v-model="evaluation.evaluation_context"
              :mode="Mode.text"
              :mainMenuBar="false"
              :navigationBar="false"
              :statusBar="false"
              :indentation="2"
              class="shadow-sm border border-slate-300 w-full"
            />
          </div>
        </details>
      </div>

      <!-- live test column -->
      <div class="w-full lg:basis-2/5 lg:sticky lg:top-2">
        <LiveTestPanel
          :evaluation="evaluation"
          :target-tool="targetTool"
          @result="onTestResult"
        ></LiveTestPanel>
      </div>
    </div>
  </div>
</template>
