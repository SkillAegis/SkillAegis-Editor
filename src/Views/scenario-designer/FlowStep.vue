<script setup>
import { computed, ref } from 'vue'
import PeriodicRate from '@/Views/scenario-designer/PeriodicRate.vue'
import {
  faStopwatch,
  faCirclePlay,
  faLink,
  faDiagramProject,
  faForward,
  faFlagCheckered,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons'
import {
  ALLOWED_TRIGGERS,
  ALLOWED_TRIGGER_FOR_STRATEGIES,
  COMPLETION_TRIGGER_KEYWORDS,
} from '@/Views/scenario-designer/evaluationModel.js'

// Step 2 — "When it runs". Edits the inject_flow: trigger, timing, the single
// prerequisite and — under "Advanced chaining" — the two fields that used to be
// editable only as raw JSON: sequence.completion_trigger and
// sequence.followed_by (PRD P4 / FR-S3).
const injectFlow = defineModel('injectFlow', {
  type: Object,
  required: true,
})

const props = defineProps({
  // Target tool of the owning inject — scopes the timing guardrails.
  targetTool: {
    type: String,
    required: true,
  },
  // All injects in the scenario: [{ uuid, name }].
  injects: {
    type: Array,
    required: true,
  },
  // UUID of the inject being edited (excluded from its own dependency pickers).
  currentUuid: {
    type: String,
    required: true,
  },
})

const showPeriodic = computed(() => injectFlow.value.sequence.trigger.includes('periodic'))
const showTriggeredAt = computed(() => injectFlow.value.sequence.trigger.includes('triggered_at'))
const showTiming = computed(() => showPeriodic.value || showTriggeredAt.value)

function toggleTrigger(key) {
  const triggers = injectFlow.value.sequence.trigger
  const i = triggers.indexOf(key)
  if (i >= 0) {
    triggers.splice(i, 1)
  } else {
    triggers.push(key)
  }
}

function strategyHint(triggerKey) {
  const scoped = ALLOWED_TRIGGER_FOR_STRATEGIES[triggerKey]?.[props.targetTool]
  return scoped ? scoped.join(', ') : null
}

const prerequisiteOptions = computed(() =>
  props.injects.map((inject) => ({
    value: inject.uuid,
    label: inject.name || '(unnamed inject)',
    disabled: inject.uuid === props.currentUuid,
  }))
)

const prerequisiteName = computed(() => {
  const req = injectFlow.value.requirements?.inject_uuid
  if (!req) {
    return null
  }
  return props.injects.find((i) => i.uuid === req)?.name || '(unknown inject)'
})

/* ---- advanced chaining (completion_trigger + followed_by) ---- */

// Ensure the two arrays always exist (older injects may miss them).
const completionTrigger = computed(() => injectFlow.value.sequence.completion_trigger || [])
const followedBy = computed(() => injectFlow.value.sequence.followed_by || [])

// The panel is open by default whenever the inject already carries chaining
// config, so previously-JSON-only data is discoverable; otherwise collapsed.
const advancedOpen = ref(completionTrigger.value.length > 0 || followedBy.value.length > 0)
const advancedCount = computed(() => completionTrigger.value.length + followedBy.value.length)

function toggleCompletionTrigger(key) {
  if (!Array.isArray(injectFlow.value.sequence.completion_trigger)) {
    injectFlow.value.sequence.completion_trigger = []
  }
  const list = injectFlow.value.sequence.completion_trigger
  const i = list.indexOf(key)
  if (i >= 0) {
    list.splice(i, 1)
  } else {
    list.push(key)
  }
}

// Any completion_trigger value we don't have a label for (custom / future
// keyword). Surfaced as removable chips so nothing is silently dropped.
const unknownCompletionTriggers = computed(() =>
  completionTrigger.value.filter((v) => !(v in COMPLETION_TRIGGER_KEYWORDS))
)

function removeCompletionTrigger(value) {
  const list = injectFlow.value.sequence.completion_trigger
  const i = list.indexOf(value)
  if (i >= 0) {
    list.splice(i, 1)
  }
}

// followed_by options = every other inject, PLUS any UUID already present that
// no longer resolves to an inject. Including stale values as options is what
// keeps Dropdown's getOptionLabel from dereferencing null (see PRD Phase-4
// note) and lets the author clean them up.
const followedByOptions = computed(() => {
  const opts = props.injects
    .filter((inject) => inject.uuid !== props.currentUuid)
    .map((inject) => ({ value: inject.uuid, label: inject.name || '(unnamed inject)' }))
  const known = new Set(opts.map((o) => o.value))
  for (const uuid of followedBy.value) {
    if (!known.has(uuid)) {
      opts.push({ value: uuid, label: `⚠ unknown inject · ${String(uuid).slice(0, 8)}…` })
      known.add(uuid)
    }
  }
  return opts
})
</script>

<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-bold text-slate-900">When does it run?</h2>
      <p class="text-sm text-slate-500">
        Control when the inject becomes available and what has to happen first.
      </p>
    </div>

    <!-- Trigger -->
    <div class="rounded-lg border border-slate-300 bg-white shadow-sm">
      <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 class="font-bold text-slate-800">
          <FontAwesomeIcon :icon="faCirclePlay" class="fa-fw text-slate-500"></FontAwesomeIcon>
          Trigger
        </h3>
        <span class="text-xs text-slate-400">what makes this inject start</span>
      </div>
      <div class="p-4">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="(desc, key) in ALLOWED_TRIGGERS"
            :key="key"
            type="button"
            :aria-pressed="injectFlow.sequence.trigger.includes(key)"
            class="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors select-none min-w-[9.5rem] basis-[calc(50%-0.25rem)] sm:basis-auto"
            :class="
              injectFlow.sequence.trigger.includes(key)
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-300 bg-white hover:border-blue-300'
            "
            @click="toggleTrigger(key)"
          >
            <span class="font-mono font-bold text-xs text-red-700">[{{ key }}]</span>
            <span
              class="text-xs"
              :class="injectFlow.sequence.trigger.includes(key) ? 'text-blue-800' : 'text-slate-500'"
            >
              {{ desc }}
            </span>
          </button>
        </div>

        <!-- Timing -->
        <div
          v-if="showTiming"
          class="mt-4 rounded border border-slate-200 bg-slate-50 p-3 shadow-sm"
        >
          <label class="block text-gray-700 font-bold mb-1">
            <FontAwesomeIcon :icon="faStopwatch" class="fa-fw"></FontAwesomeIcon>
            Timing Function{{ showTriggeredAt && showPeriodic ? 's' : '' }}
          </label>
          <div class="flex flex-col gap-2">
            <div v-show="showTriggeredAt">
              <span class="select-none p-1">
                <span
                  class="text-red-700 font-mono py-0.5 px-1 rounded-sm bg-white mr-1 border-gray-300 border"
                  >[triggered_at]</span
                >
                Triggers
              </span>
              <span class="p-1">
                <PeriodicRate v-model="injectFlow.timing.triggered_at"></PeriodicRate>
              </span>
              after exercise start.
              <Alert
                v-if="strategyHint('triggered_at')"
                class="ml-2 mt-1"
                variant="warning"
                :title="`Only works for strategy: ${strategyHint('triggered_at')}`"
              ></Alert>
            </div>
            <div v-show="showPeriodic">
              <span class="select-none p-1">
                <span
                  class="text-red-700 font-mono py-0.5 px-1 rounded-sm bg-white mr-1 border-gray-300 border"
                  >[periodic]</span
                >
                Rate
              </span>
              <span class="p-1">
                <PeriodicRate v-model="injectFlow.timing.periodic_run_every"></PeriodicRate>
              </span>
              <Alert
                v-if="strategyHint('periodic')"
                class="ml-2 mt-1"
                variant="warning"
                :title="`Only works for strategy: ${strategyHint('periodic')}`"
              ></Alert>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Prerequisite -->
    <div class="mt-4 rounded-lg border border-slate-300 bg-white shadow-sm">
      <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 class="font-bold text-slate-800">
          <FontAwesomeIcon :icon="faLink" class="fa-fw text-slate-500"></FontAwesomeIcon>
          Prerequisite
        </h3>
        <span class="text-xs text-slate-400">gate this inject behind another</span>
      </div>
      <div class="p-4">
        <label for="requirement" class="block text-gray-700 font-bold mb-1">
          Becomes available only after…
        </label>
        <Dropdown
          id="requirement"
          v-model="injectFlow.requirements.inject_uuid"
          :options="prerequisiteOptions"
          trackBy="value"
          searchable
          placeholder="- No prerequisite -"
          class="max-w-xl"
        ></Dropdown>
        <p class="text-xs text-slate-500 mt-1.5">
          <template v-if="prerequisiteName">
            Locked until <b class="text-slate-700">{{ prerequisiteName }}</b> is validated.
          </template>
          <template v-else> Available as soon as its trigger fires. </template>
        </p>
      </div>
    </div>

    <!-- Advanced chaining (completion_trigger + followed_by) -->
    <div class="mt-4 rounded-lg border border-slate-300 bg-white shadow-sm">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-4 py-2.5 text-left select-none rounded-t-lg hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        :class="advancedOpen ? 'border-b border-slate-100' : ''"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <FontAwesomeIcon
          :icon="faChevronRight"
          class="fa-fw text-slate-400 transition-transform"
          :class="advancedOpen ? 'rotate-90' : ''"
        ></FontAwesomeIcon>
        <FontAwesomeIcon :icon="faDiagramProject" class="fa-fw text-slate-500"></FontAwesomeIcon>
        <h3 class="font-bold text-slate-800">Advanced chaining</h3>
        <span
          v-if="advancedCount > 0"
          class="rounded-full bg-slate-200 px-2 py-0.5 text-2xs font-semibold text-slate-600"
        >
          {{ advancedCount }} set
        </span>
        <span class="ml-auto font-mono text-2xs text-slate-400">
          completion_trigger · followed_by
        </span>
      </button>

      <div v-show="advancedOpen" class="p-4">
        <p class="mb-4 text-xs text-slate-500">
          Optional flow-control fields, defined by the exercise format. They were previously only
          editable as raw JSON. Most injects leave both empty.
        </p>

        <!-- completion_trigger -->
        <div>
          <label class="block text-gray-700 font-bold mb-1">
            <FontAwesomeIcon :icon="faFlagCheckered" class="fa-fw text-slate-500"></FontAwesomeIcon>
            Also mark complete when…
            <span class="font-normal text-slate-400 text-xs">completion_trigger</span>
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(desc, key) in COMPLETION_TRIGGER_KEYWORDS"
              :key="key"
              type="button"
              class="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors select-none min-w-[11rem]"
              :class="
                completionTrigger.includes(key)
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-slate-300 bg-white hover:border-emerald-300'
              "
              :aria-pressed="completionTrigger.includes(key)"
              @click="toggleCompletionTrigger(key)"
            >
              <span class="font-mono font-bold text-xs text-red-700">[{{ key }}]</span>
              <span
                class="text-xs"
                :class="completionTrigger.includes(key) ? 'text-emerald-800' : 'text-slate-500'"
              >
                {{ desc }}
              </span>
            </button>
          </div>

          <!-- custom / unknown keywords, preserved and removable -->
          <div v-if="unknownCompletionTriggers.length > 0" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-xs text-slate-400">Custom:</span>
            <span
              v-for="value in unknownCompletionTriggers"
              :key="value"
              class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-2xs font-mono text-slate-700"
            >
              {{ value }}
              <button
                type="button"
                class="text-slate-400 hover:text-red-600 focus:outline-none focus-visible:text-red-600"
                title="Remove keyword"
                @click="removeCompletionTrigger(value)"
              >
                ✕
              </button>
            </span>
          </div>

          <p class="mt-1.5 text-xs text-slate-500">
            Extra ways the inject can be considered complete, on top of its evaluation.
          </p>
        </div>

        <!-- followed_by -->
        <div class="mt-5">
          <label for="followed-by" class="block text-gray-700 font-bold mb-1">
            <FontAwesomeIcon :icon="faForward" class="fa-fw text-slate-500"></FontAwesomeIcon>
            Then activate these injects
            <span class="font-normal text-slate-400 text-xs">followed_by</span>
          </label>
          <Dropdown
            id="followed-by"
            v-model="injectFlow.sequence.followed_by"
            :options="followedByOptions"
            trackBy="value"
            multiple
            searchable
            placeholder="- None -"
            class="max-w-xl"
          ></Dropdown>
          <p class="mt-1.5 text-xs text-slate-500">
            Injects to activate once this one completes. This is a forward sequence link, separate
            from the prerequisite above.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
label {
  @apply select-none;
}
</style>
