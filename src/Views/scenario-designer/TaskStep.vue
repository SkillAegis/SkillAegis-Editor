<script setup>
import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons'
import { ALLOWED_TARGET_TOOLS } from '@/Views/scenario-designer/evaluationModel.js'

// Step 1 — "What the trainee does". Edits the inject's name, description and
// target tool. Two-way bound; the parent owns dirty-detection & save.
const inject = defineModel('inject', {
  type: Object,
  required: true,
})

defineProps({
  // Whether the name currently fails validation (parent decides), for styling.
  nameInvalid: {
    type: Boolean,
    default: false,
  },
})

// Tool accent hues (PRD §11: MISP indigo, Suricata amber, webhook violet).
const TOOL_SWATCH = {
  MISP: 'bg-indigo-600',
  suricata: 'bg-amber-500',
  webhook: 'bg-violet-600',
}
</script>

<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-bold text-slate-900">What is this task?</h2>
      <p class="text-sm text-slate-500">
        Describe what the trainee has to accomplish, and which tool they'll work in.
      </p>
    </div>

    <div class="rounded-lg border border-slate-300 bg-white shadow-sm p-4">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col md:flex-row gap-4">
          <div class="basis-1/3">
            <label for="inject-name" class="block text-gray-700 font-bold mb-1">
              Inject Name <span class="text-red-500">*</span>
            </label>
            <input
              id="inject-name"
              type="text"
              v-model="inject.name"
              :class="`shadow-sm border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border-slate-400 ${
                nameInvalid ? 'form-error' : 'border-slate-300'
              }`"
              placeholder="A name"
            />
          </div>

          <div class="grow">
            <label for="inject-description" class="block text-gray-700 font-bold mb-1">
              Inject Description
              <span class="font-normal text-slate-400 text-xs">shown in the injects list</span>
            </label>
            <input
              id="inject-description"
              type="text"
              v-model="inject.description"
              class="shadow-sm border border-slate-300 w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
              placeholder="A description"
            />
          </div>
        </div>

        <div>
          <label class="block text-gray-700 font-bold mb-1">
            <FontAwesomeIcon :icon="faScrewdriverWrench" class="fa-fw"></FontAwesomeIcon>
            Target Tool
            <span class="font-normal text-slate-400 text-xs">
              the environment the trainee works in
            </span>
          </label>
          <div
            class="inline-flex flex-wrap gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1"
            role="group"
            aria-label="Target tool"
          >
            <button
              v-for="(tool_info, tool) in ALLOWED_TARGET_TOOLS"
              :key="tool"
              type="button"
              :title="tool_info"
              :aria-pressed="inject.target_tool === tool"
              class="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors select-none"
              :class="
                inject.target_tool === tool
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
              @click="inject.target_tool = tool"
            >
              <span
                class="w-2.5 h-2.5 rounded-sm"
                :class="TOOL_SWATCH[tool] || 'bg-slate-400'"
              ></span>
              {{ tool_info }}
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1.5">
            MISP is the flagship, but Suricata and webhook targets are first-class. Changing the tool
            re-scopes the strategies available on the Completion step.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input.form-error {
  @apply border-2 border-red-400;
}
label {
  @apply select-none;
}
</style>
