<script setup>
import { computed } from 'vue'
import PeriodicRate from '@/Views/scenario-designer/PeriodicRate.vue'
import { faStopwatch, faCirclePlay, faLink } from '@fortawesome/free-solid-svg-icons'
import {
  ALLOWED_TRIGGERS,
  ALLOWED_TRIGGER_FOR_STRATEGIES,
} from '@/Views/scenario-designer/evaluationModel.js'

// Step 2 — "When it runs". Edits the inject_flow: trigger, timing and the
// single prerequisite. The advanced chaining fields (followed_by /
// completion_trigger) are preserved as-is on save but not yet edited here
// (their editor lands in a later phase — see the redesign PRD).
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
  </div>
</template>

<style scoped>
label {
  @apply select-none;
}
</style>
