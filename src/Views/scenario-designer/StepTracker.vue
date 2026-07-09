<script setup>
import { faCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

// A presentational 3-step tracker for the Guided Stepper. Steps look like:
//   { key, label, sub, done, issues }   (issues = count of validation hints)
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
  <div class="flex max-w-3xl select-none" role="group" aria-label="Inject editing steps">
    <div
      v-for="(s, i) in steps"
      :key="s.key"
      role="button"
      tabindex="0"
      :aria-current="i === current ? 'step' : undefined"
      :aria-label="`Step ${i + 1}: ${s.label}${s.issues ? ` — ${s.issues} thing${s.issues > 1 ? 's' : ''} to check` : ''}`"
      class="relative flex-1 flex flex-col gap-1.5 cursor-pointer pb-3 border-b-[3px] transition-colors rounded-sm"
      :class="i === current ? 'border-blue-600' : 'border-transparent'"
      @click="emit('go', i)"
      @keydown.enter.prevent="emit('go', i)"
      @keydown.space.prevent="emit('go', i)"
    >
      <div class="flex items-center gap-2.5">
        <span
          class="w-6 h-6 rounded-full grid place-items-center font-bold text-xs border-2 shrink-0 transition-colors"
          :class="
            i === current
              ? s.issues
                ? 'bg-blue-600 border-amber-400 text-white ring-2 ring-amber-300'
                : 'bg-blue-600 border-blue-600 text-white'
              : s.issues
                ? 'bg-amber-100 border-amber-400 text-amber-600'
                : s.done
                  ? 'bg-green-100 border-green-500 text-green-600'
                  : 'bg-white border-slate-300 text-slate-500'
          "
        >
          <FontAwesomeIcon
            v-if="s.issues && i !== current"
            :icon="faTriangleExclamation"
          ></FontAwesomeIcon>
          <FontAwesomeIcon v-else-if="s.done && i !== current" :icon="faCheck"></FontAwesomeIcon>
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
