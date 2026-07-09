<script setup>
import { v4 as uuidv4 } from 'uuid'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { Sortable } from 'sortablejs-vue3'
import {
  addNewInjectToSelectedScenario,
  removeInjectFromSelectedScenario,
  updateInjectToSelectedScenario,
  selectedScenario as originalSelectedScenario
} from '@/store.js'
import {
  faArrowDownWideShort,
  faArrowUpWideShort,
  faChevronLeft,
  faChevronRight,
  faCirclePlay,
  faCircleCheck,
  faGripVertical,
  faListCheck,
  faPlus,
  faSave,
  faScrewdriverWrench,
  faTimes,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from 'vue'
import { saveInject, removeInject, saveInjectOrder } from '@/api'
import { ajaxFeedback, toast } from '@/main'
import StepTracker from '@/Views/scenario-designer/StepTracker.vue'
import TaskStep from '@/Views/scenario-designer/TaskStep.vue'
import FlowStep from '@/Views/scenario-designer/FlowStep.vue'
import CompletionStep from '@/Views/scenario-designer/CompletionStep.vue'

const props = defineProps({
  uuid: String
})

const route = useRoute()
const router = useRouter()

// Tool accent hues for the rail chips (PRD §11).
const TOOL_CHIP = {
  MISP: 'bg-indigo-600 text-white',
  suricata: 'bg-amber-500 text-white',
  webhook: 'bg-violet-600 text-white',
}

onBeforeUnmount(() => {
  resetState()
})

onMounted(() => {
  resetState()
})

watch(
  () => route.params.uuid,
  () => {
    resetState()
  }
)

onBeforeRouteLeave(async () => {
  newUnsavedInjects.forEach((inject_uuid) => {
    removeInjectFromSelectedScenario(inject_uuid)
  })
  resetState()
})

const canBeSaved = computed(() => {
  return hasValidChanges.value
})
const hasErrors = computed(() => {
  return getFormErrors.value.length > 0
})

const getFormErrors = computed(() => {
  const errors = []
  if (!selectedInject.value) {
    return errors
  }
  if (
    selectedInject.value.name === undefined ||
    selectedInject.value.name === null ||
    selectedInject.value.name.length < 2
  ) {
    errors.push('selectedInject.name')
  }
  return errors
})

const nameInvalid = computed(() => getFormErrors.value.includes('selectedInject.name'))

const injectMovedPosition = computed(() => {
  return injectOrderOperations.value.length > 0
})

const hasValidChanges = computed(() => {
  if (!selectedInject.value) {
    return false
  }

  if (hasErrors.value) {
    return false
  }

  const originalSelectedInject = originalSelectedScenario.value.injects.filter(
    (inj) => inj.uuid == selectedInjectFlowUUID.value
  )[0]
  const originalSelectedInjectFlow = originalSelectedScenario.value.inject_flow.filter(
    (inj) => inj.inject_uuid == selectedInjectFlowUUID.value
  )[0]

  const metaChanges =
    originalSelectedInject.name != selectedInject.value.name ||
    (selectedInject.value.description !== '' &&
      originalSelectedInject.description != selectedInject.value.description) ||
    originalSelectedInject.target_tool != selectedInject.value.target_tool ||
    originalSelectedInject.inject_evaluation_join_type != selectedInject.value.inject_evaluation_join_type

  let sequenceWithoutFakeOptions = {}
  if (typeof selectedInjectFlow.value.sequence === 'object') {
    // Build a filtered *copy* — never mutate the reactive sequence here, or
    // this computed (read during render) would write a dep it reads and Vue
    // would stop the render effect ("maximum recursive updates").
    sequenceWithoutFakeOptions = {
      ...selectedInjectFlow.value.sequence,
      trigger: selectedInjectFlow.value.sequence.trigger.filter((item) => item != 'null'),
    }
  }
  let sequence_str =
    typeof selectedInjectFlow.value.sequence === 'object'
      ? JSON.stringify(sequenceWithoutFakeOptions, undefined, 4)
      : selectedInjectFlow.value.sequence
  let orig_sequence_str =
    typeof originalSelectedInjectFlow.sequence === 'object'
      ? JSON.stringify(originalSelectedInjectFlow.sequence, undefined, 4)
      : originalSelectedInjectFlow.sequence

  let timing_str =
    typeof selectedInjectFlow.value.timing === 'object'
      ? JSON.stringify(selectedInjectFlow.value.timing, undefined, 4)
      : selectedInjectFlow.value.timing
  let orig_timing_str =
    typeof originalSelectedInjectFlow.timing === 'object'
      ? JSON.stringify(originalSelectedInjectFlow.timing, undefined, 4)
      : originalSelectedInjectFlow.timing

  let requirements_str =
    typeof selectedInjectFlow.value.requirements === 'object'
      ? JSON.stringify(selectedInjectFlow.value.requirements, undefined, 4)
      : selectedInjectFlow.value.requirements
  let orig_requirements_str =
    typeof originalSelectedInjectFlow.requirements === 'object'
      ? JSON.stringify(originalSelectedInjectFlow.requirements, undefined, 4)
      : originalSelectedInjectFlow.requirements

  const injectFlowMetaChanges = sequence_str != orig_sequence_str ||
    timing_str != orig_timing_str ||
    requirements_str != orig_requirements_str

  if (metaChanges || injectFlowMetaChanges) {
    return true
  }

  for (let i = 0; i < selectedInject.value.inject_evaluation.length; i++) {
    const inject_eval = selectedInject.value.inject_evaluation[i]
    const orig_inject_eval = originalSelectedInject.inject_evaluation[i]

    if (orig_inject_eval === undefined) { // New inject_eval hasn't been saved yet
      return true
    }

    if (inject_eval.score_range[1] != orig_inject_eval.score_range[1]) {
      return true
    }
    if (inject_eval.evaluation_strategy != orig_inject_eval.evaluation_strategy) {
      return true
    }
    if (inject_eval.result != orig_inject_eval.result) {
      return true
    }

    /* evaluation_context */
    try {
      if (typeof inject_eval.evaluation_context === 'string') {
        JSON.parse(inject_eval.evaluation_context)
      }
    } catch (error) {
      return false
    }

    let context_str =
      typeof inject_eval.evaluation_context === 'object'
        ? JSON.stringify(inject_eval.evaluation_context, undefined, 4)
        : inject_eval.evaluation_context
    let orig_context_str =
      typeof orig_inject_eval?.evaluation_context === 'object'
        ? JSON.stringify(orig_inject_eval.evaluation_context, undefined, 4)
        : orig_inject_eval?.evaluation_context

    if (context_str != orig_context_str) {
      return true
    }

    /* evaluation_parameters */
    try {
      if (typeof inject_eval.parameters === 'string') {
        JSON.parse(inject_eval.parameters)
      }
    } catch (error) {
      return false
    }

    let params_str =
      typeof inject_eval.parameters === 'object'
        ? JSON.stringify(inject_eval.parameters, undefined, 4)
        : inject_eval.parameters
    let orig_params_str =
      typeof orig_inject_eval.parameters === 'object'
        ? JSON.stringify(orig_inject_eval.parameters, undefined, 4)
        : orig_inject_eval.parameters

    if (params_str != orig_params_str) {
      return true
    }
  }

  if (
    originalSelectedInject.inject_evaluation.length != selectedInject.value.inject_evaluation.length
  ) {
    return true
  }

  return false
})

const selectedScenario = computed(() => {
  return originalSelectedScenario.value !== null
    ? JSON.parse(JSON.stringify(originalSelectedScenario.value))
    : null
})

let originalInject = {}
let originalInjectFlow = {}
let injectOrderOperations = ref([])
const selectedInject = ref(null)
const selectedInjectFlow = ref(null)
const selectedInjectFlowUUID = ref(null)
const step = ref(0)
let newUnsavedInjects = []

const emptyInject = {
  uuid: '',
  target_tool: 'MISP',
  name: '',
  action: '',
  inject_evaluation: []
}
const emptyInjectFlow = {
  inject_uuid: '',
  description: '',
  requirements: {
    inject_uuid: null
  },
  sequence: {
    completion_trigger: [],
    followed_by: [],
    trigger: []
  },
  timing: {
    triggered_at: null,
    periodic_run_every: null,
  }
}

const injectByUUID = computed(() => {
  const injects = {}
  if (selectedScenario.value) {
    selectedScenario.value.injects.forEach((inj) => {
      injects[inj.uuid] = inj
    })
  }
  return injects
})

const injectFlowByUUID = computed(() => {
  const injectF = {}
  if (selectedScenario.value) {
    selectedScenario.value.inject_flow.forEach((inj) => {
      injectF[inj.inject_uuid] = inj
    })
  }
  return injectF
})

const inject_flow = computed(() => {
  return selectedScenario.value?.inject_flow || []
})

// Lightweight list of every inject for the Flow step's dependency pickers.
const injectList = computed(() =>
  Object.values(injectByUUID.value).map((inject) => ({
    uuid: inject.uuid,
    name: inject.name,
  }))
)

/* ---- guided stepper ---- */
const STEPS = [
  { key: 'task', label: 'Task', sub: 'What the trainee does' },
  { key: 'flow', label: 'Flow', sub: 'When it runs' },
  { key: 'eval', label: 'Completion & test', sub: "How it's scored" },
]

const taskDone = computed(() => (selectedInject.value?.name?.length ?? 0) > 1)
const flowDone = computed(
  () => (selectedInjectFlow.value?.sequence?.trigger?.length ?? 0) > 0
)
const completionDone = computed(
  () => (selectedInject.value?.inject_evaluation?.length ?? 0) > 0
)

const steps = computed(() => [
  { ...STEPS[0], done: taskDone.value },
  { ...STEPS[1], done: flowDone.value },
  { ...STEPS[2], done: completionDone.value },
])

const isLastStep = computed(() => step.value >= STEPS.length - 1)

function goStep(index) {
  step.value = Math.max(0, Math.min(index, STEPS.length - 1))
}
function nextStep() {
  if (!isLastStep.value) {
    step.value += 1
  }
}
function prevStep() {
  if (step.value > 0) {
    step.value -= 1
  }
}

const saveState = computed(() => {
  if (!selectedInject.value) {
    return null
  }
  if (hasErrors.value) {
    return { tone: 'warn', text: 'Fix the inject name to save' }
  }
  if (canBeSaved.value) {
    return { tone: 'dirty', text: 'Unsaved changes' }
  }
  return { tone: 'saved', text: 'All changes saved' }
})

async function onDragEnd(event) {
  moveInject(event.oldIndex, event.newIndex)
  injectOrderOperations.value.push([event.oldIndex, event.newIndex])
}

async function moveInject(from, to) {
  const item = selectedScenario.value.inject_flow.splice(from, 1)[0]
  await nextTick()
  selectedScenario.value.inject_flow.splice(to, 0, item)
}

function selectInject(uuid) {
  if (selectedInjectFlowUUID.value) {
    revertInjectChanges()
  }
  originalInject = JSON.parse(JSON.stringify(injectByUUID.value[uuid]))
  originalInjectFlow = JSON.parse(JSON.stringify(injectFlowByUUID.value[uuid]))
  selectedInject.value = injectByUUID.value[uuid]
  selectedInjectFlow.value = injectFlowByUUID.value[uuid]
  selectedInjectFlowUUID.value = uuid
}

function resetState() {
  sortableKey.value += 1
  revertInjectChanges()
  revertInjectOrderChanges()
  selectedInject.value = null
  selectedInjectFlow.value = null
  selectedInjectFlowUUID.value = null
  step.value = 0
}

function revertInjectChanges() {
  if (Object.keys(originalInject).length > 0) {
    injectByUUID.value[selectedInjectFlowUUID.value] = originalInject
    injectFlowByUUID.value[selectedInjectFlowUUID.value] = originalInjectFlow
  }
}

async function saveInjectOrderChanges() {
  const injectOrder = inject_flow.value.map((i) => i.inject_uuid)
  const result = await saveInjectOrder(props.uuid, injectOrder)
  ajaxFeedback(result)
  if (result.success) {
    injectOrderOperations.value = []
  }
}

function cancel() {
  router.push({ name: 'Scenario Overview', params: { uuid: props.uuid }, props: true })
}

const sortable = ref()
const sortableKey = ref(0)
async function revertInjectOrderChanges() {
  if (sortable.value?.sortable) {
    var order = sortable.value.sortable.toArray()
    injectOrderOperations.value.reverse().forEach(([from, to]) => {
      const item = order.splice(to, 1)[0]
      order.splice(from, 0, item)
    })
    sortable.value.sortable.sort(order, true)
    injectOrderOperations.value = []
  }
}

async function saveInjectChanges() {
  const injectTosave = JSON.parse(JSON.stringify(selectedInject.value))
  injectTosave.inject_evaluation.forEach((i_eval, i) => {
    if (typeof injectTosave.inject_evaluation[i].evaluation_context === 'string') {
      injectTosave.inject_evaluation[i].evaluation_context = JSON.parse(i_eval.evaluation_context)
    }
    if (typeof injectTosave.inject_evaluation[i].parameters === 'string') {
      injectTosave.inject_evaluation[i].parameters = JSON.parse(i_eval.parameters)
    }
  })

  const injectFlowToSave = JSON.parse(JSON.stringify(selectedInjectFlow.value))

  const result = await saveInject(props.uuid, injectTosave, injectFlowToSave)
  if (result.success) {
    newUnsavedInjects = newUnsavedInjects.filter((e) => e !== injectTosave.uuid)
    updateInjectToSelectedScenario(injectTosave, injectFlowToSave)
    originalInject = JSON.parse(JSON.stringify(injectTosave))
    originalInjectFlow = JSON.parse(JSON.stringify(injectFlowToSave))
  }
  ajaxFeedback(result)
}

function createNewInject() {
  const uuid = uuidv4()
  const newInject = JSON.parse(JSON.stringify(emptyInject))
  newInject.uuid = uuid
  const newInjectFlow = JSON.parse(JSON.stringify(emptyInjectFlow))
  newInjectFlow.inject_uuid = uuid
  newUnsavedInjects.push(uuid)
  addNewInjectToSelectedScenario(newInject, newInjectFlow)
  selectInject(uuid)
  step.value = 0
}

async function deleteInjectConfirm(inject_uuid) {
  for (let i = 0; i < inject_flow.value.length; i++) {
    const injectF = inject_flow.value[i];
    if (injectF?.requirements?.inject_uuid == inject_uuid) {
      toast({
        title: 'Confirm deletion',
        message: `You are about to delete an inject that is required by other injects. Deleting it will remove these dependencies. Are you sure you want to proceed?`,
        variant: 'danger',
        confirm: true,
        confirmCb: () => {
          deleteInject(inject_uuid)
        }
      })
      return
    }
  }
  deleteInject(inject_uuid)
}

async function deleteInject(inject_uuid) {
  let result = { success: true }
  let ajaxDone = false
  if (!newUnsavedInjects.includes(inject_uuid)) {
    result = await removeInject(props.uuid, inject_uuid)
    ajaxDone = true
  }
  if (result.success) {
    newUnsavedInjects = newUnsavedInjects.filter((e) => e !== inject_uuid)
    if (selectedInjectFlowUUID.value == inject_uuid) {
      resetState()
    }
    removeInjectFromSelectedScenario(inject_uuid)
  }
  return ajaxDone ? ajaxFeedback(result) : true
}

function triggerSummary(injectFlow) {
  const triggers = (injectFlow?.sequence?.trigger || []).filter((t) => t && t != 'null' && t != '- No trigger -')
  return triggers.length > 0 ? triggers.join(', ') : null
}
</script>

<template>
  <div class="flex flex-col lg:flex-row gap-6">
    <!-- ===== Inject rail ===== -->
    <aside class="w-full lg:w-[300px] shrink-0 flex flex-col">
      <div class="flex items-center gap-2 mb-2">
        <h2 class="text-xl font-bold">Injects</h2>
        <span class="text-sm text-slate-400 font-mono">{{ inject_flow.length }}</span>
        <div class="ml-auto flex gap-1">
          <button
            class="btn btn-xs btn-danger select-none"
            title="Reset inject order"
            :disabled="!injectMovedPosition"
            @click="revertInjectOrderChanges()"
          >
            <FontAwesomeIcon :icon="faArrowUpWideShort" class="fa-fw"></FontAwesomeIcon>
          </button>
          <button
            :class="`btn btn-xs btn-success select-none ${injectMovedPosition ? 'highlight-success' : ''}`"
            title="Save inject order"
            @click="saveInjectOrderChanges()"
            :disabled="!injectMovedPosition"
          >
            <FontAwesomeIcon :icon="faArrowDownWideShort" class="fa-fw"></FontAwesomeIcon> Order
          </button>
        </div>
      </div>

      <Alert
        v-if="inject_flow.length == 0"
        variant="warning"
        title="No inject available"
        message="Create an inject to get started."
      ></Alert>

      <Sortable
        :key="sortableKey"
        ref="sortable"
        :list="inject_flow"
        item-key="inject_uuid"
        tag="div"
        :options="{
          animation: 170,
          ghostClass: 'ghost',
          dragClass: 'drag',
          handle: '.drag-handle',
          forceFallback: true
        }"
        @end="onDragEnd"
        class="flex flex-col gap-1.5"
      >
        <template #item="{ element, index }">
          <div
            @click="selectInject(element.inject_uuid)"
            :title="element.inject_uuid"
            class="group relative rounded-lg border py-2 pl-7 pr-2 select-none cursor-pointer transition-colors"
            :class="{
              'border-blue-400 bg-blue-50 ring-1 ring-blue-400': selectedInjectFlowUUID == element.inject_uuid,
              'border-slate-300 bg-white hover:border-blue-300': selectedInjectFlowUUID != element.inject_uuid,
            }"
          >
            <FontAwesomeIcon
              :icon="faGripVertical"
              class="fa-fw drag-handle absolute left-1.5 top-2.5 text-slate-400 cursor-grab"
            ></FontAwesomeIcon>
            <span class="absolute left-1.5 bottom-2 text-2xs text-slate-400 font-mono">#{{ index + 1 }}</span>

            <div class="flex items-start gap-2">
              <div class="min-w-0 grow">
                <div class="font-semibold text-slate-800 truncate">
                  {{ injectByUUID[element.inject_uuid].name || '- Unnamed inject -' }}
                </div>
                <div class="text-xs text-slate-500 truncate">
                  <span v-if="injectByUUID[element.inject_uuid].description">
                    {{ injectByUUID[element.inject_uuid].description }}
                  </span>
                  <span v-else class="italic text-slate-400">- No description -</span>
                </div>
              </div>
              <button
                class="hidden group-hover:inline-block btn btn-xs btn-danger select-none !border-slate-400 shrink-0"
                title="Delete inject"
                @click.stop="deleteInjectConfirm(element.inject_uuid)"
              >
                <FontAwesomeIcon :icon="faTrash" class="fa-fw"></FontAwesomeIcon>
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-1 mt-2">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold"
                :class="TOOL_CHIP[injectByUUID[element.inject_uuid].target_tool] || 'bg-slate-500 text-white'"
              >
                <FontAwesomeIcon :icon="faScrewdriverWrench" class="fa-fw"></FontAwesomeIcon>
                {{ injectByUUID[element.inject_uuid].target_tool }}
              </span>
              <span
                v-if="triggerSummary(injectFlowByUUID[element.inject_uuid])"
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-mono font-semibold bg-slate-100 text-red-700 border border-slate-200"
                title="Trigger"
              >
                <FontAwesomeIcon :icon="faCirclePlay" class="fa-fw"></FontAwesomeIcon>
                {{ triggerSummary(injectFlowByUUID[element.inject_uuid]) }}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold border"
                :class="
                  injectByUUID[element.inject_uuid].inject_evaluation.length > 0
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                "
              >
                <FontAwesomeIcon :icon="faListCheck" class="fa-fw"></FontAwesomeIcon>
                <template v-if="injectByUUID[element.inject_uuid].inject_evaluation.length > 0">
                  {{ injectByUUID[element.inject_uuid].inject_evaluation.length }} eval
                </template>
                <template v-else>needs eval</template>
              </span>
            </div>
          </div>
        </template>
      </Sortable>

      <button class="btn btn-success select-none mt-3 justify-center" @click="createNewInject()">
        <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Create New Inject
      </button>
    </aside>

    <!-- ===== Guided stepper ===== -->
    <section class="grow min-w-0">
      <Alert
        v-if="!selectedInject"
        variant="info"
        title="Select an inject to edit"
        message="Pick an inject from the list, or create a new one to get started."
      ></Alert>

      <div v-else class="flex flex-col min-h-[600px]">
        <!-- sticky step tracker -->
        <div class="sticky top-0 z-10 bg-slate-50 pt-1 pb-3 -mx-1 px-1">
          <StepTracker :steps="steps" :current="step" @go="goStep"></StepTracker>
        </div>

        <!-- step panel -->
        <div class="grow py-4">
          <TaskStep
            v-if="step === 0"
            v-model:inject="selectedInject"
            :name-invalid="nameInvalid"
          ></TaskStep>
          <FlowStep
            v-else-if="step === 1"
            v-model:inject-flow="selectedInjectFlow"
            :target-tool="selectedInject.target_tool"
            :injects="injectList"
            :current-uuid="selectedInjectFlowUUID"
          ></FlowStep>
          <CompletionStep
            v-else-if="step === 2"
            v-model:inject="selectedInject"
            :target-tool="selectedInject.target_tool"
          ></CompletionStep>
        </div>

        <!-- sticky footer nav -->
        <div
          class="sticky bottom-0 z-10 flex items-center gap-3 border-t border-slate-200 bg-white/95 backdrop-blur px-3 py-3 -mx-1 rounded-b-lg shadow-[0_-4px_16px_rgba(15,23,42,0.05)]"
        >
          <button class="btn select-none" :disabled="step === 0" @click="prevStep()">
            <FontAwesomeIcon :icon="faChevronLeft" class="fa-fw"></FontAwesomeIcon> Back
          </button>

          <span
            v-if="saveState"
            class="flex items-center gap-2 text-sm"
            :class="{
              'text-amber-600': saveState.tone === 'warn',
              'text-slate-500': saveState.tone !== 'warn',
            }"
          >
            <FontAwesomeIcon
              v-if="saveState.tone === 'warn'"
              :icon="faTriangleExclamation"
              class="fa-fw"
            ></FontAwesomeIcon>
            <FontAwesomeIcon
              v-else-if="saveState.tone === 'saved'"
              :icon="faCircleCheck"
              class="fa-fw text-green-500"
            ></FontAwesomeIcon>
            <span
              v-else
              class="inline-block w-2 h-2 rounded-full bg-amber-500"
            ></span>
            {{ saveState.text }}
          </span>

          <span class="ml-auto flex items-center gap-2">
            <button class="btn btn-danger select-none" @click="cancel()">
              <FontAwesomeIcon :icon="faTimes" class="fa-fw"></FontAwesomeIcon> Cancel
            </button>
            <button
              :class="`btn btn-success select-none ${canBeSaved ? 'highlight-success' : ''}`"
              @click="saveInjectChanges()"
              :disabled="!canBeSaved"
            >
              <FontAwesomeIcon :icon="faSave" class="fa-fw"></FontAwesomeIcon> Save Inject
            </button>
            <button
              v-if="!isLastStep"
              class="btn btn-info btn-colored select-none"
              @click="nextStep()"
            >
              Next: {{ steps[step + 1].label }}
              <FontAwesomeIcon :icon="faChevronRight" class="fa-fw"></FontAwesomeIcon>
            </button>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
button.highlight-success {
  @apply bg-green-400;
}

label {
  @apply select-none;
}

.ghost {
  @apply bg-slate-200;
  @apply border-dashed;
}

.drag {
  @apply !opacity-60;
}
</style>
