// Pure layout / geometry / dependency helpers for the Scenario Map
// (ScenarioMap.vue). Kept framework-free so the tricky bits — auto-layout by
// dependency depth and cycle prevention — stay easy to reason about and reuse.
//
// CEXF reminder: flow is a forest. `inject_flow[].requirements.inject_uuid`
// holds AT MOST ONE prerequisite (each inject ≤ 1 parent, many children), so
// the board draws parent→child connectors and lays nodes out by depth. There
// are NO stored coordinates — positions are recomputed on every change, which
// makes "Auto-arrange" idempotent (PRD §5.1 / Q3).

// Node + grid geometry (px). Node height is FIXED in CSS so edge endpoints,
// computed at pos.y + NODE_H / 2, always meet the visual port centre.
export const NODE_W = 250
export const NODE_H = 116
export const COL_W = 300
export const ROW_H = 150
export const X0 = 66
export const Y0 = 26
export const START_RAIL_W = 34

// A flow is "timed" when it fires off a timer rather than the dependency graph;
// those nodes live in the dedicated lane instead of the depth columns.
export function isTimed(flow) {
  const triggers = flow?.sequence?.trigger || []
  return triggers.includes('periodic') || triggers.includes('triggered_at')
}

// Depth = length of the prerequisite chain. Roots (no prerequisite, or a
// prerequisite that is itself timed) sit at depth 0 off the start rail.
// `requiresOf(uuid) -> parentUuid | null`, `isTimedOf(uuid) -> bool`.
export function depthOf(uuid, requiresOf, isTimedOf, seen = new Set()) {
  const parent = requiresOf(uuid)
  if (!parent || seen.has(uuid)) {
    return 0
  }
  seen.add(uuid)
  if (isTimedOf(parent)) {
    return 0
  }
  return 1 + depthOf(parent, requiresOf, isTimedOf, seen)
}

// Would setting `child.requires = parent` be safe? Rejects self-links and any
// edge that would close a loop (parent already transitively requires child).
export function canDepend(child, parent, requiresOf) {
  if (!child || !parent || child === parent) {
    return false
  }
  let cur = parent
  const seen = new Set()
  while (cur) {
    if (cur === child) {
      return false
    }
    if (seen.has(cur)) {
      break // pre-existing cycle in the data — stop, don't hang
    }
    seen.add(cur)
    cur = requiresOf(cur)
  }
  return true
}

// Auto-layout: flow injects into depth columns (row = order within a column),
// timed injects into a lane below. Returns absolute positions plus the board
// size and the lane rectangle (null when there are no timed injects).
export function computeLayout(orderedUuids, requiresOf, isTimedOf) {
  const pos = {}
  const timed = orderedUuids.filter((u) => isTimedOf(u))
  const flow = orderedUuids.filter((u) => !isTimedOf(u))

  const columns = {}
  flow.forEach((u) => {
    const depth = depthOf(u, requiresOf, isTimedOf)
    ;(columns[depth] = columns[depth] || []).push(u)
  })

  let maxRow = 0
  Object.keys(columns).forEach((depth) => {
    columns[depth].forEach((u, row) => {
      pos[u] = { x: X0 + Number(depth) * COL_W, y: Y0 + row * ROW_H }
      maxRow = Math.max(maxRow, row)
    })
  })

  const flowBottom = Y0 + (flow.length ? maxRow + 1 : 0) * ROW_H
  const laneTop = flowBottom + 24
  timed.forEach((u, i) => {
    pos[u] = { x: X0 + i * COL_W, y: laneTop + 34 }
  })

  const maxDepth = flow.length
    ? Math.max(0, ...flow.map((u) => depthOf(u, requiresOf, isTimedOf)))
    : 0
  const columnsUsed = Math.max(maxDepth, timed.length - 1) + 1
  const width = X0 + columnsUsed * COL_W + 40
  const laneHeight = timed.length ? 150 : 0
  const height = (timed.length ? laneTop + laneHeight : flowBottom) + 20

  return {
    pos,
    width: Math.max(width, 320),
    height: Math.max(height, 200),
    lane: timed.length ? { top: laneTop, height: laneHeight, left: X0 - 14 } : null
  }
}

// Connector anchor points: 'in' = left edge centre, 'out' = right edge centre.
export function portCenter(pos, side) {
  return { x: pos.x + (side === 'out' ? NODE_W : 0), y: pos.y + NODE_H / 2 }
}

// Horizontal cubic bezier between two anchor points.
export function edgePath(x1, y1, x2, y2) {
  const dx = Math.max(38, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}
