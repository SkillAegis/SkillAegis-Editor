<script setup>
import { faCheck } from '@fortawesome/free-solid-svg-icons'

// A presentational 3-step tracker for the Guided Stepper. Steps look like:
//   { key, label, sub, done }
// `current` is the active step index; clicking a step emits `go`.
defineProps({
  steps: {
    type: Array,
    required: true,
  },
  current: {
    type: Number,
    required: true,
  },
})

const emit = defineEmits(['go'])
</script>

<template>
  <div class="flex max-w-3xl select-none">
    <div
      v-for="(s, i) in steps"
      :key="s.key"
      class="relative flex-1 flex flex-col gap-1.5 cursor-pointer pb-3 border-b-[3px] transition-colors"
      :class="i === current ? 'border-blue-600' : 'border-transparent'"
      @click="emit('go', i)"
    >
      <div class="flex items-center gap-2.5">
        <span
          class="w-6 h-6 rounded-full grid place-items-center font-bold text-xs border-2 shrink-0 transition-colors"
          :class="
            i === current
              ? 'bg-blue-600 border-blue-600 text-white'
              : s.done
                ? 'bg-green-100 border-green-500 text-green-600'
                : 'bg-white border-slate-300 text-slate-500'
          "
        >
          <FontAwesomeIcon v-if="s.done && i !== current" :icon="faCheck"></FontAwesomeIcon>
          <span v-else>{{ i + 1 }}</span>
        </span>
        <span
          class="font-semibold text-sm"
          :class="i === current ? 'text-slate-900' : 'text-slate-500'"
        >
          {{ s.label }}
        </span>
        <span
          v-if="i < steps.length - 1"
          class="hidden md:block grow h-0.5 bg-slate-200 ml-1"
        ></span>
      </div>
      <div class="text-xs text-slate-400 pl-[2.1rem] -mt-0.5">{{ s.sub }}</div>
    </div>
  </div>
</template>
