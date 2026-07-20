<script setup>
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import EvaluationBuilder from '@/Views/scenario-designer/EvaluationBuilder.vue'
import { ALLOWED_STRATEGIES_FOR_TOOLS } from '@/Views/scenario-designer/evaluationModel.js'

// Step 3 — "How it's scored". Hosts the Phase-1 EvaluationBuilder (visual
// condition builder + inline live test) for each inject_evaluation, plus the
// AND/OR join control when there is more than one.
const inject = defineModel('inject', {
  type: Object,
  required: true,
})

const props = defineProps({
  targetTool: {
    type: String,
    required: true,
  },
})

function getEmptyInjectEvaluation() {
  const strategies = ALLOWED_STRATEGIES_FOR_TOOLS[props.targetTool] || {}
  return {
    parameters: [],
    result: '',
    evaluation_strategy: Object.keys(strategies)[0],
    evaluation_context: {},
    score_range: [0, 20],
  }
}

function addEvaluation() {
  inject.value.inject_evaluation.push(getEmptyInjectEvaluation())
  // Default the join to AND the moment a second evaluation appears.
  if (inject.value.inject_evaluation.length > 1 && !inject.value.inject_evaluation_join_type) {
    inject.value.inject_evaluation_join_type = 'AND'
  }
}

function removeEvaluation(index) {
  inject.value.inject_evaluation.splice(index, 1)
}
</script>

<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-bold text-slate-900">How is it marked complete?</h2>
      <p class="text-sm text-slate-500">
        Build the rule on the left; the panel on the right runs it against sample data as you type.
      </p>
    </div>

    <Alert
      v-if="inject.inject_evaluation.length === 0"
      variant="info"
      title="No evaluation yet"
      message="Add an evaluation to define how this inject is scored."
    ></Alert>

    <!-- join control (only meaningful with more than one evaluation) -->
    <div
      v-if="inject.inject_evaluation.length > 1"
      class="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
      title="Determines whether all evaluations must be met (AND) or any single one is sufficient (OR)."
    >
      <span>🔗</span>
      <span>
        This inject has <b>{{ inject.inject_evaluation.length }} evaluations</b>. Combine them with
      </span>
      <select
        v-model="inject.inject_evaluation_join_type"
        class="shadow-sm border border-slate-300 rounded py-1 px-2 text-gray-700 leading-tight focus:outline-none focus:border-slate-400 bg-white"
      >
        <option value="AND">AND</option>
        <option value="OR">OR</option>
      </select>
      <span>— <b>AND</b> = all pass, <b>OR</b> = any one passes.</span>
    </div>

    <div class="flex flex-col gap-4">
      <div
        v-for="(inject_eval, i) in inject.inject_evaluation"
        :key="`${inject.uuid}-${i}`"
      >
        <EvaluationBuilder
          v-model:evaluation="inject.inject_evaluation[i]"
          :target-tool="targetTool"
          :index="i"
          @remove="removeEvaluation(i)"
        ></EvaluationBuilder>
        <div
          v-if="inject.inject_evaluation.length > 1 && i !== inject.inject_evaluation.length - 1"
          class="text-center mt-4"
        >
          <span class="py-0.5 px-5 text-white bg-blue-600 shadow-md font-semibold rounded">
            {{ inject.inject_evaluation_join_type ?? 'AND' }}
          </span>
        </div>
      </div>
    </div>

    <div class="flex justify-center mt-4">
      <button class="btn btn-success select-none" @click="addEvaluation()">
        <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Add another evaluation
      </button>
    </div>
  </div>
</template>
