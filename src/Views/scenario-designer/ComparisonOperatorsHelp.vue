<script setup>
// In-app reference for the comparison operators, mirroring
// docs/comparison-operators.md. Content is derived from the shared evaluation
// engine (SkillAegis-Dashboard/backend/utils.py) — the behaviour described here
// is what actually runs, not just the short per-operator hints.
import { faDatabase, faTriangleExclamation, faLayerGroup } from '@fortawesome/free-solid-svg-icons'

defineProps({
  show: { type: Boolean, default: false },
})
defineEmits(['close'])

const STRING_OPS = [
  { op: 'contains', desc: 'Every value must appear as a whole, whitespace-separated word (case-insensitive). Not a substring match.', ex: '"Phishing seen" · contains phishing ✓ · contains phish ✗' },
  { op: 'equals', desc: 'Exact full-string match (case-sensitive). Uses the first value only.', ex: 'equals "TLP:RED"' },
  { op: 'equals_any', desc: 'Exact match against any one of the values (case-sensitive).', ex: 'equals_any ["phishing", "malware"]' },
  { op: 'regex', desc: 'The whole string must match the pattern (full match). First value only.', ex: 'regex "TLP:.*"' },
  { op: 'count', desc: 'Compare the length of the string (see count format below).', ex: 'count ">3"' },
]

const LIST_OPS = [
  { op: 'contains', desc: 'Every value must be present in the list (case-sensitive).', ex: 'contains ["ip-src", "domain"]' },
  { op: 'equals', desc: 'The list must be the same set of values — order and duplicates ignored.', ex: 'equals ["a", "b"]' },
  { op: 'contains-regex', desc: 'At least one item matches the pattern, matched from the start of the item.', ex: 'contains-regex "10\\\\..*"' },
  { op: 'equals-regex', desc: 'Only the first item of the list is tested (from its start).', ex: 'equals-regex "sha256:.*"', warn: true },
  { op: 'count', desc: 'Compare the number of items in the list.', ex: 'count ">=2"' },
]

const OBJECT_OPS = [
  { op: 'count', desc: 'Compare the number of keys in the object.', ex: 'count "=4"' },
]
</script>

<template>
  <Modal :showModal="show" @modal-close="$emit('close')">
    <template #header>Comparison operators reference</template>
    <template #body>
      <div class="text-sm text-slate-700 max-h-[70vh] overflow-y-auto pr-1">
        <p class="mb-3">
          Which operator runs depends on the <strong>type of value your jq path extracts</strong> —
          a string, a list, or an object. The same operator name can behave differently per type.
          All conditions in an evaluation must hold (<strong>AND</strong>).
        </p>

        <!-- matching scope (extract_type) -->
        <div class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 mb-3 text-xs text-slate-700">
          <p class="font-semibold text-blue-800 mb-1">
            <FontAwesomeIcon :icon="faLayerGroup" class="mr-1"></FontAwesomeIcon>Matching scope — first vs. all
            (<code class="font-mono">extract_type</code>)
          </p>
          <p class="mb-1">
            A path can match many values. Before the operator runs, that result is reduced to either
            the <strong>first</strong> match (a single string or object) or <strong>all</strong> of them
            (a list) — which is exactly what decides <em>which table below applies</em>.
          </p>
          <ul class="list-disc ml-4 flex flex-col gap-1">
            <li><code class="font-mono">first</code> (default) — the first value the path finds. Right for a single-value check like <code>.Event.info</code>.</li>
            <li><code class="font-mono">all</code> — every match, as a list. Needed whenever the check should consider the whole set.</li>
            <li>
              <strong><code class="font-mono">count</code> always uses <code class="font-mono">all</code></strong> — with
              <code class="font-mono">first</code> it would count one item's fields (the "object" row below), not the number of matches.
              The builder sets this for you; the <em>“check every match”</em> toggle controls it for the other operators.
            </li>
          </ul>
        </div>

        <!-- String -->
        <h4 class="flex items-center gap-1.5 font-bold text-slate-800 mt-4 mb-1">
          <FontAwesomeIcon :icon="faDatabase" class="fa-fw text-slate-400"></FontAwesomeIcon>
          Extracted value is a <code class="font-mono text-red-700">string</code>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-left text-slate-500 border-b border-slate-200">
                <th class="py-1 pr-2 font-semibold w-28">Operator</th>
                <th class="py-1 pr-2 font-semibold">Behaviour</th>
                <th class="py-1 font-semibold">Example</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in STRING_OPS" :key="row.op" class="border-b border-slate-100 align-top">
                <td class="py-1 pr-2 font-mono text-red-700 whitespace-nowrap">{{ row.op }}</td>
                <td class="py-1 pr-2">{{ row.desc }}</td>
                <td class="py-1 font-mono text-2xs text-slate-500">{{ row.ex }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- List -->
        <h4 class="flex items-center gap-1.5 font-bold text-slate-800 mt-4 mb-1">
          <FontAwesomeIcon :icon="faDatabase" class="fa-fw text-slate-400"></FontAwesomeIcon>
          Extracted value is a <code class="font-mono text-red-700">list</code>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-left text-slate-500 border-b border-slate-200">
                <th class="py-1 pr-2 font-semibold w-28">Operator</th>
                <th class="py-1 pr-2 font-semibold">Behaviour</th>
                <th class="py-1 font-semibold">Example</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in LIST_OPS" :key="row.op" class="border-b border-slate-100 align-top">
                <td class="py-1 pr-2 font-mono whitespace-nowrap" :class="row.warn ? 'text-amber-700' : 'text-red-700'">
                  <FontAwesomeIcon v-if="row.warn" :icon="faTriangleExclamation" class="mr-1"></FontAwesomeIcon>{{ row.op }}
                </td>
                <td class="py-1 pr-2">{{ row.desc }}</td>
                <td class="py-1 font-mono text-2xs text-slate-500">{{ row.ex }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-slate-500 mt-1">List <code>contains</code>/<code>equals</code> are case-sensitive.</p>

        <!-- Object -->
        <h4 class="flex items-center gap-1.5 font-bold text-slate-800 mt-4 mb-1">
          <FontAwesomeIcon :icon="faDatabase" class="fa-fw text-slate-400"></FontAwesomeIcon>
          Extracted value is an <code class="font-mono text-red-700">object</code>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <tbody>
              <tr v-for="row in OBJECT_OPS" :key="row.op" class="border-b border-slate-100 align-top">
                <td class="py-1 pr-2 font-mono text-red-700 whitespace-nowrap w-28">{{ row.op }}</td>
                <td class="py-1 pr-2">{{ row.desc }}</td>
                <td class="py-1 font-mono text-2xs text-slate-500">{{ row.ex }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-slate-500 mt-1"><code>contains</code> and <code>equals</code> are not supported for objects.</p>

        <!-- count format -->
        <h4 class="font-bold text-slate-800 mt-4 mb-1">The <code class="font-mono text-red-700">count</code> format</h4>
        <p>
          Compares a <strong>size</strong> — string length, number of list items, or number of object
          keys — against your value:
        </p>
        <ul class="list-disc ml-5 mt-1 text-xs">
          <li><code class="font-mono">12</code> — size equals 12</li>
          <li><code class="font-mono">&gt;3</code> <code class="font-mono">&lt;10</code> <code class="font-mono">=4</code> — greater / less / equal</li>
          <li><code class="font-mono">&gt;=5</code> <code class="font-mono">&lt;=2</code> — at least / at most</li>
        </ul>

        <!-- gotchas -->
        <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 mt-4 text-xs text-slate-700">
          <p class="font-semibold text-amber-800 mb-1">
            <FontAwesomeIcon :icon="faTriangleExclamation" class="mr-1"></FontAwesomeIcon>Easy to get wrong
          </p>
          <ul class="list-disc ml-4 flex flex-col gap-1">
            <li><code>contains</code> (string) is <strong>whole-word</strong>: <code>"phishingcampaign"</code> does not contain <code>phishing</code>, and <code>"phishing"</code> does not contain <code>phish</code>.</li>
            <li><code>equals_any</code> is an <strong>exact</strong> match, not "appears in".</li>
            <li><code>regex</code> on a string is a <strong>full</strong> match (the whole value must match).</li>
            <li>On lists, the regex operators match from the <strong>start</strong> of each item (not a full match), and <code>equals-regex</code> only checks the <strong>first</strong> item.</li>
            <li>A boolean is treated as the string <code>"1"</code>/<code>"0"</code>. An empty value list never matches.</li>
          </ul>
        </div>
      </div>
    </template>
  </Modal>
</template>
