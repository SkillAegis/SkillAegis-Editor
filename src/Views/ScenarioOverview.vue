<script setup>
import { useRouter } from 'vue-router'
import { selectedScenario, selectedScenarioUUID } from '@/store.js'
import { faHashtag, faPenRuler, faSave, faTimes } from '@fortawesome/free-solid-svg-icons'
import { ref, computed, onMounted, onBeforeUnmount, watch, onActivated, onDeactivated } from 'vue'
import JsonEditorVue from 'json-editor-vue'
import { Mode } from 'vanilla-jsoneditor'
import { editScenario, fetchScenarios } from '@/api'
import { ajaxFeedback } from '@/main'
import ScenarioMap from '@/Views/scenario-overview/ScenarioMap.vue'

const props = defineProps({
  uuid: String
})

const router = useRouter()
const editor = ref()
const theEditor = computed(() => editor.value?.jsonEditor)
const showEditor = ref(false)
const canBeSaved = computed(() => {
  return hasValidChanges.value
})
const parsedMeta = computed(() => {
  try {
    return JSON.parse(exercise_meta.value)
  } catch (error) {
    return false
  }
})
const hasValidChanges = computed(() => {
  if (selectedScenario.value?.exercise && parsedMeta.value !== false) {
    return (
      selectedScenario.value.exercise.name != exercise_name.value ||
      selectedScenario.value.exercise.namespace != exercise_namespace.value ||
      selectedScenario.value.exercise.description != exercise_description.value ||
      selectedScenario.value.exercise.uuid != exercise_uuid.value ||
      selectedScenario.value.exercise.version != exercise_version.value ||
      JSON.stringify(selectedScenario.value.exercise.meta) != JSON.stringify(parsedMeta.value)
    )
  }
  return false
})

/* Have to cheat there to avoid having the editor unmount itself before the animation finishes and avoid gutter bug where editor is not displayed correctly */
onActivated(() => {
  showEditor.value = true
})
onDeactivated(() => {
  setTimeout(() => {
    showEditor.value = false
  }, 250)
})

const exercise_name = ref('')
const exercise_namespace = ref('')
const exercise_description = ref('')
const exercise_uuid = ref('')
const exercise_version = ref('')
const exercise_meta = ref('{}')

const exercise_meta_author = ref('MISP Project')
const exercise_meta_level = ref('beginner')
const exercise_meta_gamification = ref(true)
const exercise_meta_priority = ref(10)

watch(
  [exercise_meta_author, exercise_meta_level, exercise_meta_priority, exercise_meta_gamification],
  ([new_exercise_meta_author, new_exercise_meta_level, new_exercise_meta_priority, new_exercise_meta_gamification]) => {
    const meta_json = JSON.parse(exercise_meta.value)
    meta_json['author'] = new_exercise_meta_author
    meta_json['level'] = new_exercise_meta_level
    meta_json['priority'] = new_exercise_meta_priority
    meta_json['gamification'] = new_exercise_meta_gamification
    exercise_meta.value = JSON.stringify(meta_json, undefined, 4)
  }
)

watch(exercise_meta, (new_exercise_meta) => {
  const meta_json = JSON.parse(new_exercise_meta)
  exercise_meta_author.value = meta_json['author']
  exercise_meta_level.value = meta_json['level']
  exercise_meta_priority.value = meta_json['priority']
  exercise_meta_gamification.value = meta_json['gamification'] ?? true
})

const injectCount = computed(() => {
  return selectedScenario.value?.inject_flow.length || 0
})
const injectPayloadCount = computed(() => {
  return selectedScenario.value?.inject_payloads.length || 0
})

const injectTargetToolUsed = computed(() => {
  const tools = new Set()
  selectedScenario.value?.injects.forEach((inject) => {
    tools.add(inject.target_tool)
  })
  return Array.from(tools)
})

async function saveScenario() {
  const result = await editScenario({
    name: exercise_name.value,
    namespace: exercise_namespace.value,
    description: exercise_description.value,
    uuid: exercise_uuid.value,
    version: exercise_version.value,
    meta: parsedMeta.value
  })
  ajaxFeedback(result)
  fetchScenarios()
}

function cancel() {
  router.push({ name: 'Scenario Index' })
}

function designScenario() {
  router.push({ name: 'Scenario Designer', params: { uuid: props.uuid }, props: true })
}

// From the Scenario Map's "Open in Designer": jump to the Stepper with the
// clicked inject pre-selected (the Designer reads ?inject= on entry).
function openInjectInDesigner(inject_uuid) {
  router.push({
    name: 'Scenario Designer',
    params: { uuid: props.uuid },
    query: { inject: inject_uuid },
    props: true
  })
}

onMounted(() => {
  initForm()
})

watch(selectedScenario, () => {
  initForm()
})

onBeforeUnmount(() => {
  resetForm()
})

function resetForm() {
  exercise_name.value = ''
  exercise_namespace.value = ''
  exercise_description.value = ''
  exercise_uuid.value = ''
  exercise_version.value = ''
  exercise_meta.value = {}
}

function initForm() {
  if (selectedScenario.value?.exercise) {
    exercise_name.value = selectedScenario.value.exercise.name
    exercise_namespace.value = selectedScenario.value.exercise.namespace
    exercise_description.value = selectedScenario.value.exercise.description
    exercise_uuid.value = selectedScenario.value.exercise.uuid
    exercise_version.value = selectedScenario.value.exercise.version
    exercise_meta.value = JSON.stringify(selectedScenario.value.exercise.meta, null, 4)
  }
}
</script>

<template>
  <div>
    <div>
      <div class="mb-4 flex flex-row-reverse gap-2">
        <button class="btn btn-success select-none" @click="saveScenario()" :disabled="!canBeSaved">
          <FontAwesomeIcon :icon="faSave" class="fa-fw"></FontAwesomeIcon>Save Scenario
        </button>
        <button class="btn btn-danger select-none" @click="cancel()">
          <FontAwesomeIcon :icon="faTimes" class="fa-fw"></FontAwesomeIcon>Cancel Changes
        </button>
        <button class="btn select-none" @click="designScenario()">
          <FontAwesomeIcon :icon="faPenRuler" class="fa-fw"></FontAwesomeIcon>Design Scenario
        </button>
      </div>

      <form>
        <div class="flex flex-col gap-6">
          <div class="flex flex-row gap-6">
            <div class="basis-1/2">
              <label for="name" class="block text-gray-700 font-bold mb-2">Scenario Name</label>
              <input
                type="text"
                v-model="exercise_name"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
                id="name"
                placeholder="My Scenario"
              />
            </div>

            <div>
              <label for="namespace" class="block text-gray-700 font-bold mb-2"
                >Scenario Namespace</label
              >
              <input
                type="text"
                v-model="exercise_namespace"
                class="shadow border font-mono w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400"
                id="namespace"
                placeholder="My Namespace"
              />
            </div>

            <div class="basis-1/4">
              <label for="uuid" class="block text-gray-700 font-bold mb-2">Scenario UUID</label>
              <input
                type="text"
                v-model="exercise_uuid"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400"
                id="uuid"
                placeholder="e0e52134-f84c-4c18-ae19-b6bd3acbfef7"
                disabled
              />
            </div>

            <div class="shrink">
              <label for="uuid" class="block text-gray-700 font-bold mb-2">Scenario Version</label>
              <input
                type="text"
                v-model="exercise_version"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400"
                id="uuid"
                placeholder="20240717"
                disabled
              />
            </div>
          </div>

          <div class="flex flex-row gap-6">
            <div class="">
              <label for="name" class="block text-gray-700 font-bold mb-2"
                >Scenario Meta Author</label
              >
              <input
                type="text"
                v-model="exercise_meta_author"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border-slate-400"
                id="name"
                placeholder="MISP Project"
              />
            </div>

            <div>
              <label for="namespace" class="block text-gray-700 font-bold mb-2"
                >Scenario Meta Level</label
              >
              <select
                v-model="exercise_meta_level"
                class="shadow border font-mono w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400 bg-white"
                id="namespace"
                placeholder="beginner"
              >
                <option value="beginner">Beginner</option>
                <option value="advanced">Advanced</option>
                <option value="expert">Expert</option>
              </select>
            </div>

            <div>
              <label for="uuid" class="block text-gray-700 font-bold mb-2"
                >Scenario Meta Priority</label
              >
              <input
                type="number"
                min="0"
                v-model="exercise_meta_priority"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400"
                id="uuid"
                placeholder="10"
              />
            </div>

            <div class="grow">
              <label for="description" class="block text-gray-700 font-bold mb-2"
                >Scenario Description</label
              >
              <input
                type="text"
                v-model="exercise_description"
                class="shadow border w-full rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400"
                id="description"
                placeholder="A description"
              />
            </div>
          </div>

          <div class="flex gap-6">
            <div class="basis-1/2">
              <label for="gamification" class="block text-gray-700 font-bold mb-2"
                >Gamification</label
              >
              <select
                v-model="exercise_meta_gamification"
                class="shadow border font-mono rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:border focus:border-slate-400 bg-white"
                id="gamification"
                placeholder="Active"
              >
                <option :value="true">Enabled</option>
                <option :value="false">Disabled</option>
              </select>
            </div>
          </div>

          <div class="flex gap-6">
            <div class="basis-1/2">
              <label for="name" class="block text-gray-700 font-bold mb-2">Scenario Meta</label>
              <JsonEditorVue
                v-if="showEditor"
                v-model="exercise_meta"
                ref="editor"
                :mode="Mode.text"
                :mainMenuBar="false"
                :indentation="4"
                class="shadow-lg border w-full"
              />
            </div>
            <div class="basis-1/4">
              <label for="name" class="block text-gray-700 font-bold mb-2">Scenario Meta</label>
              <div class="border-slate-200 border p-3 rounded w-full bg-white">
                <div class="flex gap-1">
                  <span class="font-bold">
                    <FontAwesomeIcon :icon="faHashtag"></FontAwesomeIcon> Injects
                  </span>
                  <span class="ml-auto font-semibold">{{ injectCount }}</span>
                </div>
                <div class="flex gap-1">
                  <span class="font-bold">
                    <FontAwesomeIcon :icon="faHashtag"></FontAwesomeIcon> Inject Payloads
                  </span>
                  <span class="ml-auto font-semibold">{{ injectPayloadCount }}</span>
                </div>
                <div class="flex gap-1">
                  <span class="font-bold">
                    <FontAwesomeIcon :icon="faHashtag"></FontAwesomeIcon> Target Tools Used
                  </span>
                  <span
                    :class="`ml-auto font-semibold ${
                      injectTargetToolUsed.length > 0 ? '' : 'font-normal text-gray-400'
                    }`"
                    >{{
                      injectTargetToolUsed.length > 0 ? injectTargetToolUsed.join(', ') : '- none -'
                    }}</span
                  >
                </div>
              </div>
            </div>
          </div>

          <div class="flex gap-6">
            <div class="basis-1/2">
              <label for="name" class="block text-gray-700 font-bold mb-2">Scenario Payloads</label>
              <div class="border-slate-200 border p-3 rounded w-full bg-white">
                <p class="text-slate-600 italic">Feature not supported yet</p>
              </div>
            </div>
          </div>

        </div>
      </form>

      <div class="mt-6">
        <ScenarioMap @open-designer="openInjectInDesigner"></ScenarioMap>
      </div>
    </div>
  </div>
</template>
