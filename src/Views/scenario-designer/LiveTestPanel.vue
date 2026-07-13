<script setup>
import { Mode } from 'vanilla-jsoneditor'
import JsonEditorVue from 'json-editor-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  faListCheck,
  faClock,
  faCircleExclamation,
  faTriangleExclamation,
  faCircleCheck,
  faBolt,
} from '@fortawesome/free-solid-svg-icons'
import { testInject as testInjectAPI, testJqPath as testJqPathAPI, getSandboxStatus } from '@/api'
import {
  isLiveTestable,
  isPythonStrategy,
  parseMaybeJSON,
} from '@/Views/scenario-designer/evaluationModel.js'

const props = defineProps({
  // The inject_evaluation being tested (reactive, edited by EvaluationBuilder).
  evaluation: {
    type: Object,
    required: true,
  },
  targetTool: {
    type: String,
    required: true,
  },
})

// Emits the raw `data` payload of a test ({outcome, debug}) or null when the
// result is stale/pending, so the builder can derive per-condition verdicts.
const emit = defineEmits(['result'])

const OUTCOME_SUCCESS = 1
const OUTCOME_FAILED = 2
const OUTCOME_PENDING = 3
const OUTCOME_WAITING = 4

const TEST_GROUP_COLORS = ['cyan', 'amber', 'blue', 'pink', 'violet', 'green']

const testData = ref('{\n  "Event": {\n    "info": ""\n  }\n}')
const mispUrl = ref('https://localhost/')
const mispApikey = ref('')

const testResult = ref(null) // null=waiting, 'Fetching'=pending, {outcome,debug}=done
const testError = ref(null)

const strategy = computed(() => props.evaluation.evaluation_strategy)
const canLiveTest = computed(() => isLiveTestable(strategy.value))
// A live MISP connection is only meaningful when there is actually a MISP query
// to run: query_search always, and python only under the MISP tool (its data is
// the query result). For the webhook tool python's data is the payload — i.e.
// the Sample data box — so no connection fields are shown.
const needsTarget = computed(
  () =>
    strategy.value === 'query_search' ||
    (isPythonStrategy(strategy.value) && props.targetTool === 'MISP')
)

// Only the `python` strategy needs the Docker-backed sandbox agent. Probe its
// readiness so the author is warned upfront instead of only via a 503 after
// hitting "Run test".
const needsSandbox = computed(() => isPythonStrategy(strategy.value))
const sandboxStatus = ref(null) // null=unknown, else { reachable, host, port, hint? }
const sandboxChecking = ref(false)

async function checkSandbox() {
  if (!needsSandbox.value) {
    return
  }
  sandboxChecking.value = true
  try {
    sandboxStatus.value = await getSandboxStatus()
  } catch (error) {
    // A failed probe request itself means we cannot confirm readiness.
    sandboxStatus.value = { reachable: false, hint: String(error.message || error) }
  } finally {
    sandboxChecking.value = false
  }
}
const usesTestData = computed(
  () => strategy.value === 'data_filtering' || isPythonStrategy(strategy.value)
)

const testDataValid = computed(() => parseMaybeJSON(testData.value).ok)

const outcomeState = computed(() => {
  if (testResult.value === null) return OUTCOME_WAITING
  if (testResult.value === 'Fetching') return OUTCOME_PENDING
  if (testResult.value?.outcome === OUTCOME_SUCCESS) return OUTCOME_SUCCESS
  if (testResult.value?.outcome === OUTCOME_FAILED) return OUTCOME_FAILED
  return OUTCOME_WAITING
})

const outcomeStyle = computed(() => {
  switch (outcomeState.value) {
    case OUTCOME_SUCCESS:
      return { icon: faCircleCheck, color: 'green', title: 'Would be marked complete' }
    case OUTCOME_FAILED:
      return { icon: faTriangleExclamation, color: 'red', title: 'Not complete yet' }
    case OUTCOME_PENDING:
      return { icon: faCircleExclamation, color: 'purple', title: 'Testing…' }
    default:
      return { icon: faClock, color: 'amber', title: 'Not tested yet' }
  }
})

const maxScore = computed(() => props.evaluation.score_range?.[1] ?? 0)
const debugGroups = computed(() =>
  Array.isArray(testResult.value?.debug) ? testResult.value.debug : []
)

function buildPayload() {
  const context = parseMaybeJSON(props.evaluation.evaluation_context).value || {}
  const queryContext = (context && context.query_context) || {}
  const params = parseMaybeJSON(props.evaluation.parameters).value
  const payload = {
    target_tool: props.targetTool,
    evaluation_strategy: strategy.value,
    eval_params: Array.isArray(params) ? params : [],
    test_data: parseMaybeJSON(testData.value).value || {},
    evaluation_context: context,
  }
  if (needsTarget.value) {
    payload.query_search_url = queryContext.url || '/'
    payload.query_search_method = queryContext.request_method || 'GET'
    payload.query_search_payload = queryContext.payload || {}
    payload.query_search_misp_url = mispUrl.value
    payload.query_search_misp_apikey = mispApikey.value
  }
  return payload
}

async function runTest() {
  if (!canLiveTest.value) {
    return
  }
  testError.value = null
  testResult.value = 'Fetching'
  emit('result', null)
  try {
    const response = await testInjectAPI(buildPayload())
    testResult.value = response.data
    emit('result', response.data)
  } catch (error) {
    testError.value = String(error.message || error)
    testResult.value = null
    emit('result', null)
    // A python failure is often the sandbox agent being down — refresh the badge.
    checkSandbox()
  }
}

// Auto-run for the cheap local jq strategy; keystrokes elsewhere need an
// explicit run (they hit a live MISP/endpoint).
let debounceTimer = null
function scheduleAutoRun() {
  if (strategy.value !== 'data_filtering' || !testDataValid.value) {
    return
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(runTest, 400)
}

watch(
  () => [testData.value, JSON.stringify(props.evaluation.parameters)],
  () => {
    // Invalidate the previous verdict so stale results are not shown as current.
    if (testResult.value !== 'Fetching') {
      emit('result', null)
    }
    scheduleAutoRun()
  }
)

watch(strategy, () => {
  testResult.value = null
  testError.value = null
  emit('result', null)
  sandboxStatus.value = null
  checkSandbox()
})

onMounted(() => {
  // Give immediate feedback for the cheap local-jq strategy so the
  // "auto-evaluates" affordance is honest as soon as the inject opens.
  scheduleAutoRun()
  checkSandbox()
})

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})

/* ---- jq path helper ---- */
const showJqModal = ref(false)
const jqPath = ref('')
const jqData = ref('{"Event": {"info": "My Event"}}')
const jqExtractType = ref('all')
const jqResult = ref('')
const jqInputsValid = computed(() => jqData.value.length > 0 && jqPath.value.length > 0)

async function runJqPath() {
  jqResult.value = ''
  try {
    const result = await testJqPathAPI({
      path: jqPath.value,
      data: parseMaybeJSON(jqData.value).value || {},
      extract_type: jqExtractType.value,
    })
    jqResult.value =
      result.success === false
        ? JSON.stringify(result, undefined, 2)
        : JSON.stringify(result.data, undefined, 2)
  } catch (error) {
    jqResult.value = String(error.message || error)
  }
}
</script>

<template>
  <div class="rounded shadow-md bg-white border border-slate-300 overflow-hidden">
    <div class="flex items-center gap-2 bg-slate-600 px-4 py-2 text-gray-50 rounded-t">
      <FontAwesomeIcon :icon="faBolt" class="fa-fw"></FontAwesomeIcon>
      <span class="font-semibold">Live test</span>
      <span
        v-if="strategy === 'data_filtering'"
        class="ml-auto text-2xs font-semibold bg-green-500/90 text-white rounded-full px-2 py-0.5"
        title="This strategy re-evaluates automatically as you type"
      >
        auto-evaluates
      </span>
      <button
        v-if="needsSandbox"
        type="button"
        @click="checkSandbox()"
        :disabled="sandboxChecking"
        :title="
          sandboxChecking
            ? 'Checking the python sandbox agent…'
            : sandboxStatus?.reachable
              ? `Python sandbox agent reachable on ${sandboxStatus.host}:${sandboxStatus.port} — click to re-check`
              : `${sandboxStatus?.hint || 'Python sandbox agent not reachable'} — click to re-check`
        "
        class="ml-auto text-2xs font-semibold rounded-full px-2 py-0.5 transition-colors"
        :class="
          sandboxChecking
            ? 'bg-slate-400/90 text-white'
            : sandboxStatus === null
              ? 'bg-slate-400/90 text-white'
              : sandboxStatus.reachable
                ? 'bg-green-500/90 text-white'
                : 'bg-red-500/90 text-white'
        "
      >
        {{
          sandboxChecking
            ? 'checking sandbox…'
            : sandboxStatus === null
              ? 'sandbox: unknown'
              : sandboxStatus.reachable
                ? 'sandbox ready'
                : 'sandbox offline'
        }}
      </button>
    </div>

    <div class="p-3 flex flex-col gap-3">
      <!-- Verdict -->
      <div
        class="rounded-lg px-3 py-2 flex items-center gap-2 font-bold border"
        :class="{
          'bg-green-100 text-green-800 border-green-300': outcomeState === OUTCOME_SUCCESS,
          'bg-red-100 text-red-800 border-red-300': outcomeState === OUTCOME_FAILED,
          'bg-purple-100 text-purple-800 border-purple-300': outcomeState === OUTCOME_PENDING,
          'bg-amber-100 text-amber-800 border-amber-300': outcomeState === OUTCOME_WAITING,
        }"
      >
        <FontAwesomeIcon :icon="outcomeStyle.icon" class="fa-fw"></FontAwesomeIcon>
        <span>{{ outcomeStyle.title }}</span>
        <span class="ml-auto font-mono text-sm">
          {{ outcomeState === OUTCOME_SUCCESS ? maxScore : 0 }} / {{ maxScore }} pts
        </span>
      </div>

      <Alert
        v-if="!canLiveTest"
        variant="warning"
        title="Live testing not available for this strategy in the Editor"
        :message="
          strategy === 'query_mirror'
            ? 'query_mirror only compares the trainee\'s own request; there is nothing to test here.'
            : 'This strategy is evaluated by the Dashboard against a live target. Build the rule here, then validate it during a live exercise.'
        "
      ></Alert>

      <template v-if="canLiveTest">
        <!-- MISP connection (target-backed strategies) -->
        <div v-if="needsTarget" class="flex flex-col gap-2">
          <div>
            <div class="font-semibold text-sm">MISP URL</div>
            <input
              type="text"
              v-model="mispUrl"
              class="shadow-sm border border-slate-300 font-mono text-sm w-full rounded py-1.5 px-2 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
              placeholder="https://localhost/"
            />
          </div>
          <div>
            <div class="font-semibold text-sm">MISP API Key</div>
            <input
              type="text"
              v-model="mispApikey"
              class="shadow-sm border border-slate-300 font-mono text-sm w-full rounded py-1.5 px-2 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
              placeholder="API key"
            />
          </div>
          <p v-if="isPythonStrategy(strategy)" class="text-xs text-slate-500">
            Optional — fill in to run this inject's query against live MISP and feed the result to
            your function; leave blank to use the Sample data below.
          </p>
        </div>

        <!-- Sample data -->
        <div v-if="usesTestData">
          <div class="font-semibold text-sm mb-1">
            Sample data
            <span class="font-normal text-slate-500">— the data the rule runs against</span>
          </div>
          <JsonEditorVue
            v-model="testData"
            :mode="Mode.text"
            :mainMenuBar="false"
            :navigationBar="false"
            :statusBar="false"
            :indentation="2"
            class="shadow-sm border border-slate-300 w-full max-h-72 overflow-auto"
          />
          <div v-if="!testDataValid" class="text-xs text-amber-600 mt-1">
            ⚠ Not valid JSON yet
          </div>
        </div>

        <Alert
          v-if="needsSandbox && sandboxStatus && !sandboxStatus.reachable"
          variant="warning"
          title="Python sandbox agent not running"
          :message="`${sandboxStatus.hint || 'Start the sandbox agent, then re-check.'} Tests will fail until it is running.`"
        ></Alert>

        <button
          class="btn btn-info btn-colored btn-block select-none"
          @click="runTest()"
          :disabled="!testDataValid || outcomeState === OUTCOME_PENDING"
        >
          <FontAwesomeIcon :icon="faListCheck" class="fa-fw"></FontAwesomeIcon>
          {{ needsTarget ? 'Run test against target' : 'Run test' }}
        </button>

        <div v-if="testError" class="text-sm text-red-700">
          <span class="font-semibold">Error:</span>
          <pre class="whitespace-pre-wrap">{{ testError }}</pre>
        </div>

        <!-- Debug breakdown -->
        <div v-if="debugGroups.length > 0" class="flex flex-col">
          <div class="font-semibold text-sm mb-1">Breakdown</div>
          <div
            v-for="(testGroup, i) in debugGroups"
            :key="i"
            class="relative flex flex-col mb-4"
          >
            <div
              v-for="(entry, j) in testGroup"
              :key="j"
              class="relative flex flex-col justify-center"
            >
              <div
                :class="`absolute left-3 ${
                  j < testGroup.length - 1 ? 'h-full' : 'h-2/3 top-0 w-2 border-b-2'
                } border-l-2 border-slate-300`"
              ></div>
              <div class="relative mb-1.5">
                <span
                  v-if="j == 0"
                  :class="`absolute select-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-${TEST_GROUP_COLORS[i % TEST_GROUP_COLORS.length]}-500 p-3 text-center text-sm font-semibold text-white shadow`"
                  >{{ i + 1 }}</span
                >
                <div class="ml-10 w-auto pt-0.5">
                  <h6
                    v-if="entry.style == 'primary'"
                    class="text-sm font-bold text-slate-800"
                  >
                    {{ entry.message }}
                  </h6>
                  <h6 v-else class="text-sm font-semibold text-slate-700">
                    <span
                      v-if="
                        entry.style == 'success' ||
                        entry.style == 'fail' ||
                        entry.style == 'error'
                      "
                    >
                      <span
                        :class="`text-2xs mr-1 px-2 py-0.5 rounded-lg shadow bg-${
                          entry.style == 'success' ? 'green' : 'red'
                        }-100 text-${entry.style == 'success' ? 'green' : 'red'}-800`"
                      >
                        <FontAwesomeIcon
                          :icon="
                            entry.style == 'success'
                              ? faCircleCheck
                              : entry.style == 'error'
                              ? faCircleExclamation
                              : faTriangleExclamation
                          "
                          class="mr-1"
                        ></FontAwesomeIcon>
                        <span class="font-semibold capitalize">{{ entry.style }}</span>
                      </span>
                    </span>
                    {{ entry.message }}
                  </h6>
                  <div class="mt-1 text-sm text-gray-500">
                    <div v-if="strategy == 'python' && entry.exit_code !== undefined">
                      <table>
                        <tbody>
                          <tr>
                            <th class="text-left">Status:</th>
                            <td class="pl-2 text-right">{{ entry.status }}</td>
                          </tr>
                          <tr>
                            <th class="text-left">Exit code:</th>
                            <td class="pl-2 text-right"><pre>{{ entry.exit_code }}</pre></td>
                          </tr>
                          <tr v-if="entry.duration !== undefined">
                            <th class="text-left">Duration:</th>
                            <td class="pl-2 text-right">{{ entry.duration.toFixed(2) }}s</td>
                          </tr>
                        </tbody>
                      </table>
                      <div class="mb-2">
                        <strong class="mr-2">STDOUT:</strong>
                        <pre class="text-xs max-h-32 overflow-y-auto whitespace-pre-wrap mt-1 p-1 rounded-sm bg-slate-100 border border-slate-200">{{ (entry.stdout || '').trim() }}</pre>
                      </div>
                      <div>
                        <strong class="mr-2">STDERR:</strong>
                        <pre class="text-xs max-h-32 overflow-y-auto whitespace-pre-wrap mt-1 p-1 rounded-sm bg-slate-100 border border-slate-200">{{ (entry.stderr || '').trim() }}</pre>
                      </div>
                    </div>
                    <pre
                      v-else-if="
                        typeof entry.data !== 'object' ||
                        entry.data === null ||
                        Object.keys(entry.data).length > 0
                      "
                      :class="`text-xs max-h-32 overflow-y-auto whitespace-pre-wrap ${
                        typeof entry.data === 'object'
                          ? 'mt-1 p-1 rounded-sm bg-slate-100 border border-slate-200'
                          : ''
                      }`"
                      >{{ JSON.stringify(entry.data, undefined, 2)?.slice(0, 15000) }}</pre
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- jq path helper -->
      <div class="border-t border-slate-200 pt-2">
        <button class="btn btn-sm select-none" @click="showJqModal = true">
          <FontAwesomeIcon :icon="faListCheck" class="fa-fw"></FontAwesomeIcon>
          Test <code class="text-gray-500">./jq</code> path
        </button>
      </div>
    </div>

    <Modal :showModal="showJqModal" @modal-close="showJqModal = false">
      <template #header>Test <code class="text-gray-500">./jq</code> path</template>
      <template #body>
        <div>
          <div class="font-semibold pt-1">Data</div>
          <JsonEditorVue
            v-model="jqData"
            :mode="Mode.text"
            :mainMenuBar="false"
            :indentation="4"
            class="shadow border w-full max-h-60 overflow-auto"
          />
        </div>
        <div class="mt-2">
          <div class="font-semibold pt-1"><code class="text-gray-500">./jq</code> Path</div>
          <input
            type="text"
            v-model="jqPath"
            class="shadow border font-mono w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
            placeholder=".Event.info"
            @keypress.enter="jqInputsValid && runJqPath()"
          />
        </div>
        <div class="mt-2">
          <div class="font-semibold pt-1">Extract Type</div>
          <div class="inline-flex gap-1">
            <input type="radio" id="jqfirst" value="first" v-model="jqExtractType" />
            <label for="jqfirst">First</label>
          </div>
          <div class="inline-flex gap-1 ml-3">
            <input type="radio" id="jqall" value="all" v-model="jqExtractType" />
            <label for="jqall">All</label>
          </div>
        </div>
        <button
          class="btn btn-block btn-info btn-colored select-none my-2"
          @click="runJqPath()"
          :disabled="!jqInputsValid"
        >
          Test <code :class="jqInputsValid ? 'text-gray-200' : 'text-gray-500'">./jq</code> path
        </button>
        <div class="mt-2">
          <div class="font-semibold pt-1">Result</div>
          <JsonEditorVue
            v-model="jqResult"
            :mode="Mode.view"
            :mainMenuBar="false"
            :navigationBar="false"
            :indentation="4"
            class="shadow border w-full max-h-60 overflow-auto"
            readOnly
          />
        </div>
      </template>
    </Modal>
  </div>
</template>
