<script setup>
import { computed } from 'vue'
import { faLightbulb, faDatabase, faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons'
import { getStrategyInfo } from '@/Views/scenario-designer/evaluationModel.js'

const props = defineProps({
  strategy: {
    type: String,
    required: true,
  },
  targetTool: {
    type: String,
    required: true,
  },
})

const info = computed(() => getStrategyInfo(props.strategy, props.targetTool))
</script>

<template>
  <div
    v-if="info"
    class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700"
  >
    <div class="flex items-start gap-2">
      <FontAwesomeIcon :icon="faLightbulb" class="fa-fw mt-0.5 text-blue-600"></FontAwesomeIcon>
      <div class="flex flex-col gap-1.5">
        <p class="font-semibold text-slate-800">{{ info.title }}</p>
        <p class="text-slate-600">{{ info.summary }}</p>

        <p class="flex gap-1.5">
          <FontAwesomeIcon
            :icon="faDatabase"
            class="fa-fw mt-0.5 text-slate-400"
            title="What gets checked"
          ></FontAwesomeIcon>
          <span>
            <span class="font-semibold text-slate-700">Checks:</span>
            {{ info.source }}
          </span>
        </p>

        <p class="flex gap-1.5">
          <FontAwesomeIcon
            :icon="faScrewdriverWrench"
            class="fa-fw mt-0.5 text-slate-400"
            title="What you configure"
          ></FontAwesomeIcon>
          <span>
            <span class="font-semibold text-slate-700">You configure:</span>
            {{ info.youConfigure }}
          </span>
        </p>

        <p v-if="info.example" class="text-slate-600">
          <span class="font-semibold text-slate-700">Example condition:</span>
          <code class="ml-1 font-mono text-2xs text-red-700 bg-white border border-slate-200 rounded px-1.5 py-0.5">
            {{ info.example }}
          </code>
        </p>

        <p v-if="info.note" class="text-xs italic text-slate-500">{{ info.note }}</p>
      </div>
    </div>
  </div>
</template>
