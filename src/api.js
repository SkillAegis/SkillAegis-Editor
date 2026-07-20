import { reactive, computed } from "vue";
import { store } from '@/store.js'

const URL = process.env.NODE_ENV === "production" ? '' : "http://localhost:4002";

const endpoints = {
    'scenarios-reload': '/scenarios/reload',
    'scenarios-index': '/scenarios/index',
    'scenarios-view': '/scenarios/view',
    'scenarios-add': '/scenarios/add',
    'scenarios-edit': '/scenarios/edit',
    'scenarios-delete': '/scenarios/delete',
    'scenarios-save-json': '/scenarios/save-json',
    'inject-save': '/scenarios/save-inject',
    'inject-delete': '/scenarios/delete-inject',
    'inject-order': '/scenarios/order-inject',
    'inject-test': '/injects/test',
    'inject-jq-path-test': '/injects/jq-path-test',
    'sandbox-status': '/injects/sandbox-status',
}

async function get(url) {
    url = URL + url
    const options = {
        method: "GET",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json;charset=UTF-8",
        },
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(await errorMessage(response));
    }

    const json = await response.json();
    return json
}

// Extract a human-readable message from a non-OK response, falling back to the
// status. The backend returns { message } (custom handlers) or { detail }
// (HTTPException); reading it means real server errors reach the UI instead of
// a bare status code.
async function errorMessage(response) {
    try {
        const body = await response.json()
        return body.message || body.detail || `Response status: ${response.status}`
    } catch (e) {
        return `Response status: ${response.status}`
    }
}

async function post(url, payload) {
    url = URL + url
    const options = {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(payload),
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(await errorMessage(response));
    }

    const json = await response.json();
    return json
}

export async function fetchScenarios() {
    const data = await get(endpoints['scenarios-index'])
    store.scenarios = data.scenarios
    store.read_errors = data.read_errors
    store.scenario_validated_by_uuid = data.scenario_validated_by_uuid
    store.scenario_filename_by_uuid = data.scenario_filename_by_uuid
    store.cexf_schema = data.cexf_schema
}

export async function fetchScenario() {
    return await get(endpoints['scenarios-view'])
}

export async function forceReload() {
    const data = await post(endpoints['scenarios-reload'])
    store.scenarios = data.scenarios
    store.read_errors = data.read_errors
    store.scenario_filename_by_uuid = data.scenario_filename_by_uuid
    store.scenario_validated_by_uuid = data.scenario_validated_by_uuid
}

export async function addScenario(payload) {
    return await post(endpoints['scenarios-add'], payload)
}

export async function editScenario(payload) {
    const url = endpoints['scenarios-edit']
    return await post(url, payload)
}

export async function deleteScenario(uuid) {
    const url = endpoints['scenarios-delete'] + `/${uuid}`
    const data = await post(url)
    if (data.success) {
        store.scenarios = store.scenarios.filter((s) => s.exercise.uuid != uuid)
    }
    return data
}

export async function saveJSON(filename, content) {
    const url = endpoints['scenarios-save-json']
    const payload = {
        filename: filename,
        content: typeof content === 'object' ? JSON.stringify(content, undefined, 4) : content,
    }
    return await post(url, payload)
}

export async function saveInject(scenario_uuid, inject, injectFlow) {
    const url = endpoints['inject-save'] + `/${scenario_uuid}`
    const payload = {
        inject: inject,
        injectFlow: injectFlow,
    }
    return await post(url, payload)
}

export async function removeInject(scenario_uuid, inject_uuid) {
    const url = endpoints['inject-delete'] + `/${scenario_uuid}/${inject_uuid}`
    const payload = {
    }
    return await post(url, payload)
}

export async function saveInjectOrder(scenario_uuid, injectOrder) {
    const url = endpoints['inject-order'] + `/${scenario_uuid}`
    const payload = {
        inject_uuids: injectOrder
    }
    return await post(url, payload)
}

export async function testInject(payload) {
    const url = endpoints['inject-test']
    return await post(url, payload)
}

export async function testJqPath(payload) {
    const url = endpoints['inject-jq-path-test']
    return await post(url, payload)
}

// Cheap readiness probe for the python-evaluation sandbox agent. Returns the
// backend payload { reachable, host, port, reason?, hint? } so the python
// tester can warn upfront when the agent is not running.
export async function getSandboxStatus() {
    const data = await get(endpoints['sandbox-status'])
    return data.data
}
