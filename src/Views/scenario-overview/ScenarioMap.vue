<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { faPlus, faTrashCan, faPenRuler, faDiagramProject } from '@fortawesome/free-solid-svg-icons'
import {
  selectedScenario,
  selectedScenarioUUID,
  updateInjectToSelectedScenario,
  addNewInjectToSelectedScenario,
  removeInjectFromSelectedScenario
} from '@/store.js'
import { saveInject, removeInject } from '@/api'
import { toast, ajaxFeedback } from '@/main'
import { ALLOWED_TRIGGERS } from '@/Views/scenario-designer/evaluationModel.js'
import {
  NODE_W,
  NODE_H,
  START_RAIL_W,
  isTimed,
  canDepend,
  computeLayout,
  portCenter,
  edgePath
} from '@/Views/scenario-overview/scenarioMapModel.js'

// The Scenario Map is the scenario "home": a drag-driven board of every inject
// that replaces the old read-only dependency table (RequirementTree). Two
// gestures wire up flow — drag the ▸ handle (or a whole card) onto another
// inject to set a prerequisite; drop a card into the timed lane / onto the
// start rail to change when it fires. Every edit persists immediately for the
// affected inject via saveInject (PRD §10), optimistically with revert on
// failure. Layout is recomputed from dependency depth on every change — no
// coordinates are stored.

const emit = defineEmits(['open-designer'])

/* ---------- reactive scenario data (live store, so edits reflect) ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o))

const injectFlows = computed(() => selectedScenario.value?.inject_flow || [])

const injectByUUID = computed(() => {
  const map = {}
  ;(selectedScenario.value?.injects || []).forEach((inj) => {
    map[inj.uuid] = inj
  })
  return map
})
const flowByUUID = computed(() => {
  const map = {}
  injectFlows.value.forEach((flow) => {
    map[flow.inject_uuid] = flow
  })
  return map
})

// Canonical draw order = the flow (execution) order shown in the Designer rail.
const orderedUuids = computed(() => injectFlows.value.map((f) => f.inject_uuid))

const requiresOf = (uuid) => flowByUUID.value[uuid]?.requirements?.inject_uuid || null
const isTimedByUuid = (uuid) => isTimed(flowByUUID.value[uuid])
const nameOf = (uuid) => injectByUUID.value[uuid]?.name || '(unnamed inject)'

const TOOL_TOP = {
  MISP: 'bg-indigo-600',
  suricata: 'bg-amber-500',
  webhook: 'bg-violet-600',
  python: 'bg-cyan-600'
}
const TOOL_CHIP = {
  MISP: 'bg-indigo-600 text-white',
  suricata: 'bg-amber-500 text-white',
  webhook: 'bg-violet-600 text-white',
  python: 'bg-cyan-600 text-white'
}

const nodes = computed(() =>
  orderedUuids.value
    .map((uuid, index) => ({
      uuid,
      index,
      inject: injectByUUID.value[uuid],
      flow: flowByUUID.value[uuid]
    }))
    .filter((n) => n.inject && n.flow)
    .map((n) => ({
      ...n,
      name: n.inject.name,
      tool: n.inject.target_tool || 'MISP',
      triggers: (n.flow.sequence?.trigger || []).filter((t) => t && t !== 'null'),
      evalCount: (n.inject.inject_evaluation || []).length,
      score: (n.inject.inject_evaluation || []).reduce(
        (sum, ev) => sum + (Number(ev?.score_range?.[1]) || 0),
        0
      )
    }))
)

/* ---------- layout + edges (pure, recomputed on every change) ---------- */
const layout = computed(() => computeLayout(orderedUuids.value, requiresOf, isTimedByUuid))

const startEdges = computed(() => {
  const out = []
  const pos = layout.value.pos
  orderedUuids.value.forEach((uuid) => {
    if (!requiresOf(uuid) && !isTimedByUuid(uuid) && pos[uuid]) {
      const t = portCenter(pos[uuid], 'in')
      out.push({ key: `s-${uuid}`, d: edgePath(START_RAIL_W, t.y, t.x, t.y) })
    }
  })
  return out
})

const reqEdges = computed(() => {
  const out = []
  const pos = layout.value.pos
  orderedUuids.value.forEach((uuid) => {
    const parent = requiresOf(uuid)
    if (parent && pos[parent] && pos[uuid]) {
      const s = portCenter(pos[parent], 'out')
      const t = portCenter(pos[uuid], 'in')
      out.push({
        key: `e-${uuid}`,
        child: uuid,
        d: edgePath(s.x, s.y, t.x, t.y),
        mx: (s.x + t.x) / 2,
        my: (s.y + t.y) / 2
      })
    }
  })
  return out
})

/* ---------- UI / interaction state ---------- */
const boardRef = ref(null)
const canvasRef = ref(null)
const selectedUuid = ref(null)
const drag = ref(null) // { uuid, moved, sx, sy, offX, offY }
const dragPos = ref(null) // { uuid, x, y } — live position of the card under the cursor
const link = ref(null) // { from, target, ok } — dragging the ▸ handle
const hoverZone = ref(null) // { type: 'dep'|'timed'|'start', uuid?, ok? }
const tempEdgeD = ref(null)
const savingSet = new Set() // per-inject re-entrancy guard (non-reactive)

let clickSuppressed = false
function suppressClick() {
  clickSuppressed = true
  setTimeout(() => {
    clickSuppressed = false
  }, 80)
}

const selectedFlow = computed(() =>
  selectedUuid.value ? flowByUUID.value[selectedUuid.value] : null
)
const selectedNode = computed(() => nodes.value.find((n) => n.uuid === selectedUuid.value) || null)
const selectedReqName = computed(() => {
  const req = selectedFlow.value?.requirements?.inject_uuid
  return req ? nameOf(req) : null
})
const showSelbar = computed(() => !!selectedNode.value && !drag.value && !link.value)

/* ---------- node presentation ---------- */
function nodeStyle(uuid) {
  if (drag.value?.uuid === uuid && drag.value.moved && dragPos.value) {
    return { left: `${dragPos.value.x}px`, top: `${dragPos.value.y}px` }
  }
  const p = layout.value.pos[uuid]
  return p ? { left: `${p.x}px`, top: `${p.y}px` } : { left: '0px', top: '0px' }
}

function nodeStateClass(uuid) {
  const classes = []
  const isDragging = drag.value?.uuid === uuid && drag.value.moved
  if (isDragging) {
    classes.push('is-dragging')
  }
  if (selectedUuid.value === uuid && !drag.value && !link.value) {
    classes.push('is-selected')
  }
  // Highlight the hovered dependency target (either gesture).
  if (link.value && link.value.target === uuid && uuid !== link.value.from) {
    classes.push(link.value.ok ? 'is-link-ok' : 'is-link-bad')
  }
  if (hoverZone.value?.type === 'dep' && hoverZone.value.uuid === uuid) {
    classes.push(hoverZone.value.ok ? 'is-link-ok' : 'is-link-bad')
  }
  return classes
}

/* ---------- persistence (optimistic, revert on failure) ---------- */
async function persistFlow(uuid, mutate, successMsg) {
  const inject = injectByUUID.value[uuid]
  const flow = flowByUUID.value[uuid]
  if (!inject || !flow || savingSet.has(uuid)) {
    return
  }
  const prevInject = clone(inject)
  const prevFlow = clone(flow)
  const nextInject = clone(inject)
  const nextFlow = clone(flow)
  mutate(nextInject, nextFlow)

  updateInjectToSelectedScenario(nextInject, nextFlow) // optimistic
  savingSet.add(uuid)
  try {
    const result = await saveInject(selectedScenarioUUID.value, nextInject, nextFlow)
    if (result.success) {
      if (successMsg) {
        toast({ variant: 'success', title: 'Map updated', message: successMsg })
      }
    } else {
      updateInjectToSelectedScenario(prevInject, prevFlow)
      ajaxFeedback(result)
    }
  } catch (error) {
    updateInjectToSelectedScenario(prevInject, prevFlow)
    toast({ variant: 'danger', title: 'Save failed', message: String(error) })
  } finally {
    savingSet.delete(uuid)
  }
}

function setPrerequisite(childUuid, parentUuid) {
  if (!canDepend(childUuid, parentUuid, requiresOf)) {
    toast({
      variant: 'danger',
      title: 'Not allowed',
      message: `Can't link — that would create a dependency loop.`
    })
    return
  }
  persistFlow(
    childUuid,
    (inject, flow) => {
      flow.requirements = { ...(flow.requirements || {}), inject_uuid: parentUuid }
      // A prerequisite implies the flow graph, not a timer — drop timed triggers.
      const kept = (flow.sequence.trigger || []).filter(
        (t) => t !== 'periodic' && t !== 'triggered_at'
      )
      flow.sequence.trigger = kept.length ? kept : ['manual']
    },
    `“${nameOf(parentUuid)}” is now a prerequisite of “${nameOf(childUuid)}”.`
  )
}

function removeDep(childUuid) {
  const parentName = selectedReqNameFor(childUuid)
  persistFlow(
    childUuid,
    (inject, flow) => {
      flow.requirements = { inject_uuid: null }
    },
    `Removed prerequisite${parentName ? ` “${parentName}”` : ''} from “${nameOf(childUuid)}”.`
  )
}
function selectedReqNameFor(uuid) {
  const req = flowByUUID.value[uuid]?.requirements?.inject_uuid
  return req ? nameOf(req) : null
}

/* ---------- ① drag the ▸ handle → set prerequisite ---------- */
function startLink(event, uuid) {
  if (event.button !== 0) {
    return
  }
  event.preventDefault()
  link.value = { from: uuid, target: null, ok: true }
  selectedUuid.value = null
  window.addEventListener('mousemove', onLinkMove)
  window.addEventListener('mouseup', onLinkUp)
}
function onLinkMove(event) {
  if (!link.value || !boardRef.value) {
    return
  }
  const rect = boardRef.value.getBoundingClientRect()
  const s = portCenter(layout.value.pos[link.value.from], 'out')
  tempEdgeD.value = edgePath(s.x, s.y, event.clientX - rect.left, event.clientY - rect.top)

  const el = document.elementFromPoint(event.clientX, event.clientY)
  const node = el && el.closest('.map-node')
  const target = node ? node.dataset.uuid : null
  if (target && target !== link.value.from) {
    link.value = { ...link.value, target, ok: canDepend(target, link.value.from, requiresOf) }
  } else {
    link.value = { ...link.value, target: null, ok: true }
  }
}
function onLinkUp() {
  window.removeEventListener('mousemove', onLinkMove)
  window.removeEventListener('mouseup', onLinkUp)
  const l = link.value
  link.value = null
  tempEdgeD.value = null
  suppressClick()
  if (l && l.target && l.target !== l.from) {
    setPrerequisite(l.target, l.from)
  }
}

/* ---------- ② drag the whole card → re-lane / set prerequisite ---------- */
function startCardDrag(event, uuid) {
  if (event.button !== 0 || event.target.closest('.map-port-out')) {
    return
  }
  event.preventDefault()
  const rect = boardRef.value.getBoundingClientRect()
  const p = layout.value.pos[uuid]
  drag.value = {
    uuid,
    moved: false,
    sx: event.clientX,
    sy: event.clientY,
    offX: event.clientX - (rect.left + p.x),
    offY: event.clientY - (rect.top + p.y)
  }
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}
function onDragMove(event) {
  const d = drag.value
  if (!d || !boardRef.value) {
    return
  }
  if (!d.moved) {
    if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) < 5) {
      return
    }
    d.moved = true
    selectedUuid.value = null
  }
  const rect = boardRef.value.getBoundingClientRect()
  dragPos.value = {
    uuid: d.uuid,
    x: event.clientX - rect.left - d.offX,
    y: event.clientY - rect.top - d.offY
  }
  highlightZone(event)
}
function highlightZone(event) {
  const el = document.elementFromPoint(event.clientX, event.clientY)
  const overNode = el && el.closest('.map-node')
  if (overNode && overNode.dataset.uuid !== drag.value.uuid) {
    const target = overNode.dataset.uuid
    hoverZone.value = {
      type: 'dep',
      uuid: target,
      ok: canDepend(drag.value.uuid, target, requiresOf)
    }
    return
  }
  if (el && el.closest('.map-lane')) {
    hoverZone.value = { type: 'timed' }
    return
  }
  if (el && el.closest('.map-startbar')) {
    hoverZone.value = { type: 'start' }
    return
  }
  hoverZone.value = null
}
function onDragUp() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
  const d = drag.value
  const zone = hoverZone.value
  drag.value = null
  dragPos.value = null
  hoverZone.value = null
  if (!d) {
    return
  }
  suppressClick()
  if (!d.moved) {
    selectNode(d.uuid)
    return
  }
  applyCardDrop(d.uuid, zone)
}
function applyCardDrop(uuid, zone) {
  if (zone?.type === 'dep') {
    setPrerequisite(uuid, zone.uuid)
  } else if (zone?.type === 'timed') {
    persistFlow(
      uuid,
      (inject, flow) => {
        flow.sequence.trigger = ['periodic']
        flow.timing = {
          ...(flow.timing || {}),
          periodic_run_every: flow.timing?.periodic_run_every || 10
        }
        flow.requirements = { inject_uuid: null }
      },
      `“${nameOf(uuid)}” now runs on a timer.`
    )
  } else if (zone?.type === 'start') {
    persistFlow(
      uuid,
      (inject, flow) => {
        flow.requirements = { inject_uuid: null }
        flow.sequence.trigger = ['startex']
      },
      `“${nameOf(uuid)}” now fires at exercise start.`
    )
  } else if (isTimedByUuid(uuid)) {
    // Dragged out of the timed lane into the flow area → back to manual.
    persistFlow(
      uuid,
      (inject, flow) => {
        flow.sequence.trigger = ['manual']
      },
      `“${nameOf(uuid)}” now fires manually.`
    )
  }
  // Otherwise: dropped in empty flow space with no state change — snaps back.
}

/* ---------- selection bar actions ---------- */
function selectNode(uuid) {
  selectedUuid.value = selectedUuid.value === uuid ? null : uuid
}
function toggleTrigger(triggerKey) {
  const uuid = selectedUuid.value
  if (!uuid) {
    return
  }
  const current = (selectedFlow.value?.sequence?.trigger || []).slice()
  const idx = current.indexOf(triggerKey)
  let next
  if (idx >= 0) {
    if (current.length <= 1) {
      return // keep at least one trigger
    }
    next = current.filter((t) => t !== triggerKey)
  } else {
    next = [...current, triggerKey]
  }
  persistFlow(uuid, (inject, flow) => {
    flow.sequence.trigger = next
    flow.timing = flow.timing || {}
    if (next.includes('periodic') && !flow.timing.periodic_run_every) {
      flow.timing.periodic_run_every = 10
    }
    if (next.includes('triggered_at') && !flow.timing.triggered_at) {
      flow.timing.triggered_at = 10
    }
  })
}
function openInDesigner() {
  if (selectedUuid.value) {
    emit('open-designer', selectedUuid.value)
  }
}
function deleteSelected() {
  const uuid = selectedUuid.value
  if (!uuid) {
    return
  }
  const dependents = injectFlows.value.filter((f) => f.requirements?.inject_uuid === uuid)
  if (dependents.length) {
    toast({
      title: 'Confirm deletion',
      variant: 'danger',
      confirm: true,
      message: `This inject is a prerequisite of ${dependents.length} other inject${
        dependents.length > 1 ? 's' : ''
      }. Deleting it will remove ${dependents.length > 1 ? 'those dependencies' : 'that dependency'}. Proceed?`,
      confirmCb: () => doDelete(uuid)
    })
    return
  }
  doDelete(uuid)
}
async function doDelete(uuid) {
  const result = await removeInject(selectedScenarioUUID.value, uuid)
  if (result.success) {
    if (selectedUuid.value === uuid) {
      selectedUuid.value = null
    }
    removeInjectFromSelectedScenario(uuid)
  }
  ajaxFeedback(result)
}

/* ---------- toolbar ---------- */
async function addInject() {
  const uuid = uuidv4()
  const inject = {
    uuid,
    target_tool: 'MISP',
    name: 'New inject',
    action: '',
    inject_evaluation: []
  }
  const flow = {
    inject_uuid: uuid,
    description: '',
    requirements: { inject_uuid: null },
    sequence: { completion_trigger: [], followed_by: [], trigger: ['manual'] },
    timing: { triggered_at: null, periodic_run_every: null }
  }
  addNewInjectToSelectedScenario(inject, flow)
  selectedUuid.value = uuid
  savingSet.add(uuid)
  try {
    const result = await saveInject(selectedScenarioUUID.value, inject, flow)
    if (result.success) {
      toast({
        variant: 'success',
        title: 'Inject added',
        message: 'Open it in the Designer to set its task and completion rule.'
      })
    } else {
      removeInjectFromSelectedScenario(uuid)
      selectedUuid.value = null
      ajaxFeedback(result)
    }
  } catch (error) {
    removeInjectFromSelectedScenario(uuid)
    selectedUuid.value = null
    toast({ variant: 'danger', title: 'Save failed', message: String(error) })
  } finally {
    savingSet.delete(uuid)
  }
}
function autoArrange() {
  // Layout is always derived from dependency depth, so this only re-centres the
  // view and reassures the author (idempotent — PRD §5.1 / Q3).
  if (canvasRef.value) {
    canvasRef.value.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }
  toast({ variant: 'success', title: 'Auto-arranged', message: 'Re-flowed by dependency depth.' })
}

function onCanvasClick(event) {
  if (clickSuppressed) {
    return
  }
  if (event.target.closest('.map-node') || event.target.closest('.map-edge-g')) {
    return
  }
  selectedUuid.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onLinkMove)
  window.removeEventListener('mouseup', onLinkUp)
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
})
</script>

<template>
  <div class="w-full">
    <div class="flex items-center gap-2 mb-2">
      <label class="block text-gray-700 font-bold">Scenario Map</label>
      <span class="text-sm text-slate-400 font-mono">{{ nodes.length }} injects</span>
      <div class="ml-auto flex items-center gap-2">
        <button type="button" class="btn btn-sm select-none" @click="autoArrange()">
          <FontAwesomeIcon :icon="faDiagramProject" class="fa-fw"></FontAwesomeIcon> Auto-arrange
        </button>
        <button type="button" class="btn btn-success select-none" @click="addInject()">
          <FontAwesomeIcon :icon="faPlus" class="fa-fw"></FontAwesomeIcon> Add inject
        </button>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900"
    >
      <span>
        🔗 Drag the <span class="map-kbd">▸</span> handle — or a whole <b>card</b> — onto another
        inject to set a <b>prerequisite</b>.
      </span>
      <span>
        🖐 Drop a card into the <span class="map-kbd">⏱ timed lane</span> or onto the
        <span class="map-kbd">start rail</span> to change when it fires.
      </span>
      <span>Click a connection to remove it.</span>
      <span class="ml-auto flex items-center gap-3 text-slate-500">
        <span class="flex items-center gap-1"
          ><span class="map-legend-line"></span> prerequisite</span
        >
        <span class="flex items-center gap-1"
          ><span class="map-legend-line dash"></span> from start</span
        >
      </span>
    </div>

    <div ref="canvasRef" class="map-canvas" @click="onCanvasClick">
      <Alert
        v-if="nodes.length === 0"
        variant="info"
        title="No injects yet"
        message="Use “Add inject” to create the first one, then drag to wire up the flow."
        class="m-4 max-w-md"
      ></Alert>

      <div
        ref="boardRef"
        class="map-board"
        :style="{ width: layout.width + 'px', height: layout.height + 'px' }"
      >
        <!-- start rail -->
        <div class="map-startbar" :class="{ 'drop-hot': hoverZone?.type === 'start' }">
          <span>Exercise start ▶</span>
        </div>

        <!-- timed lane -->
        <div
          v-if="layout.lane"
          class="map-lane"
          :class="{ 'drop-hot': hoverZone?.type === 'timed' }"
          :style="{
            left: layout.lane.left + 'px',
            right: '0px',
            top: layout.lane.top + 'px',
            height: layout.lane.height + 'px'
          }"
        >
          <span class="map-lane-lbl">⏱ Timed &amp; periodic</span>
        </div>

        <!-- connectors -->
        <svg
          class="map-edges"
          :style="{ width: layout.width + 'px', height: layout.height + 'px' }"
        >
          <path v-for="e in startEdges" :key="e.key" class="map-edge dash" :d="e.d" />
          <g v-for="e in reqEdges" :key="e.key" class="map-edge-g" @click.stop="removeDep(e.child)">
            <path class="map-edge-hit" :d="e.d" />
            <path class="map-edge" :d="e.d" />
            <g class="map-edge-rm" :transform="`translate(${e.mx},${e.my})`">
              <circle r="9"></circle>
              <text x="0" y="3.5" text-anchor="middle" font-size="13" font-weight="700">×</text>
            </g>
          </g>
          <path v-if="tempEdgeD" class="map-temp-edge" :d="tempEdgeD" />
        </svg>

        <!-- nodes -->
        <div
          v-for="n in nodes"
          :key="n.uuid"
          class="map-node"
          :class="nodeStateClass(n.uuid)"
          :style="nodeStyle(n.uuid)"
          :data-uuid="n.uuid"
          :title="n.uuid"
          role="button"
          tabindex="0"
          :aria-pressed="selectedUuid === n.uuid"
          :aria-label="`Inject ${n.index + 1}: ${n.name || 'unnamed inject'}. Press Enter to select and edit its flow.`"
          @mousedown="startCardDrag($event, n.uuid)"
          @keydown.enter.prevent="selectNode(n.uuid)"
          @keydown.space.prevent="selectNode(n.uuid)"
        >
          <div class="map-node-top" :class="TOOL_TOP[n.tool] || 'bg-slate-500'"></div>
          <span class="map-port-in"></span>
          <span
            class="map-port-out"
            title="Drag onto another inject to make this its prerequisite"
            @mousedown.stop.prevent="startLink($event, n.uuid)"
            >▸</span
          >
          <div class="px-3 pt-2 pb-2.5">
            <div class="flex items-center gap-1.5 font-mono text-2xs text-slate-400">
              <span class="tracking-tighter">⠿</span> #{{ n.index + 1 }} ·
              {{ n.uuid.slice(0, 8) }}
            </div>
            <div class="font-bold text-slate-900 text-sm leading-tight mt-0.5 map-node-name">
              {{ n.name || '- Unnamed inject -' }}
            </div>
            <div class="flex flex-wrap items-center gap-1 mt-2">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold"
                :class="TOOL_CHIP[n.tool] || 'bg-slate-500 text-white'"
                >{{ n.tool }}</span
              >
              <span
                v-for="t in n.triggers"
                :key="t"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-mono font-semibold bg-slate-100 text-red-700 border border-slate-200"
                >[{{ t }}]</span
              >
            </div>
            <div
              class="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100 text-2xs text-slate-500"
            >
              <span
                class="inline-block w-2 h-2 rounded-full"
                :class="n.evalCount > 0 ? 'bg-green-500' : 'bg-amber-500'"
              ></span>
              <span>{{ n.evalCount > 0 ? 'completion set' : 'needs eval' }}</span>
              <span v-if="n.evalCount > 0"
                >· {{ n.evalCount }} eval{{ n.evalCount > 1 ? 's' : '' }}</span
              >
              <span class="ml-auto font-mono font-bold text-slate-700">{{ n.score }} pts</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- floating selection bar -->
    <Transition name="map-selbar">
      <div v-if="showSelbar" class="map-selbar">
        <span
          class="font-bold text-slate-900 text-sm truncate max-w-[200px]"
          :title="selectedNode.name"
        >
          {{ selectedNode.name || '- Unnamed inject -' }}
        </span>
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold"
          :class="TOOL_CHIP[selectedNode.tool] || 'bg-slate-500 text-white'"
          >{{ selectedNode.tool }}</span
        >
        <span class="map-selbar-div"></span>

        <div class="flex flex-col gap-1">
          <span class="text-2xs uppercase tracking-wide text-slate-400">trigger</span>
          <div class="flex gap-1">
            <button
              v-for="(desc, key) in ALLOWED_TRIGGERS"
              :key="key"
              type="button"
              :title="desc"
              :aria-pressed="selectedNode.triggers.includes(key)"
              class="rounded border px-2 py-0.5 font-mono text-2xs font-semibold select-none transition-colors"
              :class="
                selectedNode.triggers.includes(key)
                  ? 'border-blue-400 bg-blue-100 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-500 hover:border-blue-300'
              "
              @click="toggleTrigger(key)"
            >
              {{ key }}
            </button>
          </div>
        </div>
        <span class="map-selbar-div"></span>

        <div class="flex flex-col gap-1">
          <span class="text-2xs uppercase tracking-wide text-slate-400">prerequisite</span>
          <span v-if="selectedReqName" class="text-sm text-slate-700">
            {{ selectedReqName }}
            <button
              type="button"
              class="ml-1 font-bold text-red-600 rounded"
              title="Clear prerequisite"
              aria-label="Clear prerequisite"
              @click="removeDep(selectedUuid)"
            >
              ×
            </button>
          </span>
          <span v-else class="text-sm text-slate-400 italic"
            >— none — drag a ▸ handle onto it —</span
          >
        </div>
        <span class="map-selbar-div"></span>

        <button
          type="button"
          class="btn btn-info btn-colored btn-sm select-none"
          @click="openInDesigner()"
        >
          <FontAwesomeIcon :icon="faPenRuler" class="fa-fw"></FontAwesomeIcon> Open in Designer
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm select-none !border-slate-300"
          title="Delete inject"
          aria-label="Delete inject"
          @click="deleteSelected()"
        >
          <FontAwesomeIcon :icon="faTrashCan" class="fa-fw"></FontAwesomeIcon>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.map-kbd {
  @apply font-mono bg-white border border-blue-200 rounded px-1 text-2xs;
}
.map-legend-line {
  @apply inline-block w-5 border-t-2 border-blue-400;
}
.map-legend-line.dash {
  @apply border-t border-dashed border-slate-400;
}

.map-canvas {
  @apply relative overflow-auto rounded-lg border border-slate-300 bg-slate-100;
  height: 560px;
  background-image: radial-gradient(circle at 1px 1px, #cbd5e1 1px, transparent 0);
  background-size: 26px 26px;
}
.map-board {
  @apply relative;
  margin: 20px;
}

.map-startbar {
  @apply absolute left-0 top-0 flex items-center justify-center rounded-lg;
  width: 34px;
  height: 100%;
  background: linear-gradient(180deg, #1e293b, #0f172a);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: box-shadow 0.12s;
}
.map-startbar span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  @apply text-blue-300 font-bold text-xs tracking-widest uppercase;
}
.map-startbar.drop-hot {
  box-shadow: 0 0 0 3px #16a34a;
}

.map-lane {
  @apply absolute rounded-xl;
  border: 1px dashed #d97706;
  background: rgba(217, 119, 6, 0.06);
  transition:
    background 0.12s,
    box-shadow 0.12s;
}
.map-lane.drop-hot {
  background: rgba(217, 119, 6, 0.16);
  box-shadow: inset 0 0 0 2px #d97706;
}
.map-lane-lbl {
  @apply absolute font-bold text-xs uppercase tracking-wide;
  top: -10px;
  left: 16px;
  padding: 0 8px;
  background: #eef2f7;
  color: #d97706;
}

.map-edges {
  @apply absolute inset-0;
  overflow: visible;
  pointer-events: none;
}
.map-edge {
  fill: none;
  stroke: #60a5fa;
  stroke-width: 2.2;
}
.map-edge.dash {
  stroke: #94a3b8;
  stroke-dasharray: 5 5;
  stroke-width: 1.8;
}
.map-edge-g {
  pointer-events: auto;
  cursor: pointer;
}
.map-edge-hit {
  stroke: transparent;
  stroke-width: 16;
  fill: none;
}
.map-edge-g:hover .map-edge {
  stroke: #2563eb;
  stroke-width: 3;
}
.map-edge-rm {
  opacity: 0;
  transition: opacity 0.1s;
}
.map-edge-g:hover .map-edge-rm {
  opacity: 1;
}
.map-edge-rm circle {
  fill: #fff;
  stroke: #dc2626;
}
.map-edge-rm text {
  fill: #dc2626;
}
.map-temp-edge {
  fill: none;
  stroke: #2563eb;
  stroke-width: 2.6;
  stroke-dasharray: 6 4;
  pointer-events: none;
}

.map-node {
  @apply absolute rounded-xl border border-slate-300 bg-white select-none;
  width: 250px;
  height: 116px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 2px 8px rgba(15, 23, 42, 0.06);
  cursor: grab;
  transition:
    box-shadow 0.12s,
    border-color 0.12s;
}
.map-node:hover {
  @apply border-blue-400;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
}
.map-node.is-selected {
  @apply border-blue-500;
  box-shadow:
    0 0 0 2px #2563eb,
    0 12px 40px rgba(15, 23, 42, 0.16);
}
.map-node.is-dragging {
  opacity: 0.95;
  z-index: 50;
  cursor: grabbing;
  transition: none;
  pointer-events: none;
  transform: rotate(-1deg);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
}
.map-node.is-link-ok {
  @apply border-green-500;
  box-shadow: 0 0 0 2px #16a34a;
}
.map-node.is-link-bad {
  @apply border-red-500;
  box-shadow: 0 0 0 2px #dc2626;
}
.map-node-top {
  @apply rounded-t-xl;
  height: 5px;
}
.map-node-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.map-port-in {
  @apply absolute rounded-full bg-white;
  left: -6px;
  top: calc(50% - 5px);
  width: 11px;
  height: 11px;
  border: 2px solid #60a5fa;
  z-index: 4;
}
.map-port-out {
  @apply absolute grid place-items-center rounded-full bg-blue-600 text-white font-black;
  right: -9px;
  top: calc(50% - 8px);
  width: 17px;
  height: 17px;
  font-size: 9px;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  cursor: crosshair;
  z-index: 5;
  transition: transform 0.1s;
}
.map-port-out:hover {
  transform: scale(1.28);
}
.map-port-out::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
}

.map-selbar {
  @apply fixed left-1/2 bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5;
  transform: translateX(-50%);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
  z-index: 40;
  max-width: calc(100% - 40px);
}
.map-selbar-div {
  @apply bg-slate-200;
  width: 1px;
  height: 26px;
}

.map-selbar-enter-active,
.map-selbar-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s;
}
.map-selbar-enter-from,
.map-selbar-leave-to {
  transform: translateX(-50%) translateY(140%);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .map-node,
  .map-selbar-enter-active,
  .map-selbar-leave-active {
    transition: none;
  }
  .map-node.is-dragging {
    transform: none;
  }
}
</style>
