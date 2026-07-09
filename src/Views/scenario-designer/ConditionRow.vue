<script setup>
import { ref } from 'vue'
import { faTimes, faXmark, faArrowRightLong } from '@fortawesome/free-solid-svg-icons'
import { OPERATORS } from '@/Views/scenario-designer/evaluationModel.js'

// A single condition: { path, comparison, values, extract_type }. Two-way bound
// so the parent's flat condition list stays in sync as it is edited.
const condition = defineModel('condition', {
  type: Object,
  required: true,
})

defineProps({
  // Live-test feedback for this condition (optional).
  verdict: {
    type: String, // 'pass' | 'fail' | null
    default: null,
  },
  extracted: {
    type: String,
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
      <!-- jq path -->
      <input
        type="text"
        v-model="condition.path"
        class="shadow-sm border border-slate-300 font-mono text-sm text-red-700 w-full rounded py-1 px-2 leading-tight focus:outline-none focus:border-slate-400 bg-white"
        placeholder=".Event.info"
        spellcheck="false"
      />

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
        <span v-if="extracted !== null" class="ml-auto inline-flex items-center gap-1">
          extracted:
          <code class="font-mono bg-white border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded">{{ extracted }}</code>
        </span>
      </div>
    </div>
  </div>
</template>
