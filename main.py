#!/usr/bin/env python3

import datetime
import os
import socket
import sys
from typing import Any, Dict, Union
from pathlib import Path
import json
import traceback
from urllib.parse import urljoin
import uuid
import importlib.util
import sys
import requests
import jsonschema
from jsonschema import validate

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import config

from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

EXERCISE_DIR = Path(os.getenv("EXERCISE_FOLDER", config.exercise_directory))
CEXF_SCHEMA_PATH = Path(__file__).parent / 'schema_cexf.json'
CEXF_SCHEMA = {}
INJECT_EVAL_SUCCESS = 1
INJECT_EVAL_FAIL = 2

# The `python` evaluation strategy runs submitted code in a separate sandbox
# agent (epicbox/Docker) reached over HTTP on this host/port. Kept in sync with
# tools/SkillAegis-Dashboard/backend/sandboxClient.py.
SANDBOX_AGENT_HOST = 'localhost'
SANDBOX_AGENT_PORT = 9573

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins='*',
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scenarios = []
scenarioByUUID = {}
scenarioValidatedByUUID = {}
scenarioFilenameByUUID = {}
readErrors = {}


def load_schema(schema_path):
    with open(schema_path, 'r') as schema_file:
        schema = json.load(schema_file)
    return schema

CEXF_SCHEMA = load_schema(CEXF_SCHEMA_PATH)


def register_exception(app: FastAPI):
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):

        exc_str = f'{exc}'.replace('\n', ' ').replace('   ', ' ')
        content = {'status_code': 10422, 'message': exc_str, 'data': None}
        return JSONResponse(content=content, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        # Unhandled exceptions are turned into a 500 by Starlette's
        # ServerErrorMiddleware, which sits OUTSIDE the CORS middleware — so the
        # error response carries no `Access-Control-Allow-Origin` header, the
        # browser blocks it, and fetch() only reports an opaque "Failed to
        # fetch". Return the 500 ourselves with the CORS header attached (and log
        # the traceback server-side) so the real cause reaches the UI.
        traceback.print_exc()
        exc_str = f'{exc}'.replace('\n', ' ').replace('   ', ' ')
        content = {'status_code': 500, 'message': f'Internal Server Error: {exc_str}', 'data': None}
        return JSONResponse(
            content=content,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            headers={'Access-Control-Allow-Origin': '*'},
        )


register_exception(app)


def loadInjectEvaluator():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    subdir = "/tools/SkillAegis-Dashboard/backend/target_tools/misp/inject_eval.py"
    spec = importlib.util.spec_from_file_location("inject_eval", current_dir + subdir)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["inject_eval"] = mod
    # Include backend to allow import from other files
    backend_path = os.path.abspath(os.path.join(os.path.dirname(current_dir + subdir), '../../..'))
    sys.path.insert(0, backend_path)
    spec.loader.exec_module(mod)
    return mod


def loadExerciseModel():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    subdir = "/tools/SkillAegis-Dashboard/backend/target_tools/misp/exercise.py"
    spec = importlib.util.spec_from_file_location("exercise", current_dir + subdir)
    mod = importlib.util.module_from_spec(spec)
    # Include backend to allow import from other files
    backend_path = os.path.abspath(os.path.join(os.path.dirname(current_dir + subdir), '../../..'))
    sys.path.insert(0, backend_path)
    sys.modules["exercise"] = mod
    spec.loader.exec_module(mod)
    return mod


def read_exercise_dir():
    global scenarioFilenameByUUID, readErrors
    scenarioFilenameByUUID = {}
    readErrors = {}

    target_dir = EXERCISE_DIR
    json_files = target_dir.glob("*.json")
    exercises = []
    for json_file in list(json_files):
        with open(json_file) as f:
            try:
                parsed_exercise = json.load(f)
                exercises.append(parsed_exercise)
                uuid = parsed_exercise['exercise']['uuid']
                scenarioFilenameByUUID[uuid] = json_file.relative_to(EXERCISE_DIR)
            except json.JSONDecodeError as e:
                relative_file = str(json_file.relative_to(EXERCISE_DIR))
                errorStr = f"json.JSONDecodeError: {e.msg}"
                f.seek(0)
                text = f.read()
                readErrors[relative_file] = {
                    'error': errorStr,
                    'text': text,
                }
                print(relative_file + ' - ' + errorStr)
    return exercises


def validate_json(data, schema) -> Union[bool, str]:
    try:
        validate(instance=data, schema=schema)
        return True
    except jsonschema.exceptions.ValidationError as err:
        return str(err)


def reloadJsonFiles():
    global scenarios, scenarioByUUID, scenarioValidatedByUUID
    scenarios = read_exercise_dir()
    scenarioByUUID = { e['exercise']['uuid']: e for e in scenarios }
    scenarioValidatedByUUID = { e['exercise']['uuid']: validate_json(e, CEXF_SCHEMA) for e in scenarios }

reloadJsonFiles()


def success(title: str, message: str = '', payload: dict = {}) -> dict:
    return {
        'success': True,
        'title': title,
        'message': message,
        'data': payload,
    }

def error(title: str, errorMessage: str, payload: dict = {}) -> dict:
    return {
        'success': False,
        'title': title,
        'message': errorMessage,
        'data': payload,
    }


def marshallInjectFlow(injectF: dict) -> dict:
    injectF['inject_uuid'] = injectF.get('inject_uuid', '')
    injectF['description'] = injectF.get('description', '')
    injectF['requirements'] = injectF.get('requirements', {})
    if 'inject_uuid' in injectF['requirements'] and (injectF['requirements']['inject_uuid'] is None or len(injectF['requirements']['inject_uuid']) == 0):
        del injectF['requirements']['inject_uuid']
    injectF['sequence'] = injectF.get('sequence', {})
    injectF['sequence']['completion_trigger'] = injectF['sequence'].get('completion_trigger', [])
    injectF['sequence']['followed_by'] = injectF['sequence'].get('followed_by', [])
    injectF['sequence']['trigger'] = injectF['sequence'].get('trigger', [])
    injectF['timing'] = injectF.get('timing', {})
    injectF['timing']['triggered_at'] = injectF['timing'].get('triggered_at', None)
    injectF['timing']['periodic_run_every'] = injectF['timing'].get('periodic_run_every', None)
    return injectF


def createScenario(newExercise) -> Union[dict, str]:
    global scenarios, scenarioByUUID
    today = datetime.date.today()
    exercise = {
        'name': newExercise.name,
        'namespace': newExercise.namespace,
        'description': newExercise.description,
        'meta': {},
        'uuid': str(uuid.uuid4()),
        'version': f"{today.year}{today.month}{today.day}",
    }
    inject_flow = []
    inject_payloads = []
    injects = []
    scenario = {
        'exercise': exercise,
        'inject_flow': inject_flow,
        'inject_payloads': inject_payloads,
        'injects': injects,
    }

    filename = "".join( x for x in newExercise.name if (x.isalnum() or x in "._- "))
    filename = f"{filename}.json"
    try:
        with open(EXERCISE_DIR / filename, 'w') as f:
            json.dump(scenario, f, indent=4)
    except Exception as e:
        print(e)
        return e
    
    scenarios.append(scenario)
    scenarioByUUID[exercise['uuid']] = scenario
    scenarioFilenameByUUID[exercise['uuid']] = filename
    return scenario


def editScenario(updatedScenario) -> Union[dict, str]:
    global scenarios, scenarioByUUID, scenarioFilenameByUUID
    today = datetime.date.today()
    try:
        theUUID = updatedScenario.uuid
    except Exception:
        return 'Could not get UUID'
    scenario = scenarioByUUID[theUUID]
    scenario['exercise']['name'] = updatedScenario.name
    scenario['exercise']['namespace'] = updatedScenario.namespace
    scenario['exercise']['description'] = updatedScenario.description
    scenario['exercise']['version'] = f"{today.year}{today.month}{today.day}"
    scenario['exercise']['meta'] = updatedScenario.meta
    scenario['inject_flow'] = [marshallInjectFlow(injectF) for injectF in scenario['inject_flow']]
    filename = scenarioFilenameByUUID[theUUID]
    try:
        with open(EXERCISE_DIR / filename, 'w') as f:
            json.dump(scenario, f, indent=4)
    except Exception as e:
        print(e)
        return e
    for i, sce in enumerate(scenarios):
        if sce['exercise']['uuid'] == scenario['exercise']['uuid']:
            scenarios[i] = scenario
    scenarioByUUID[theUUID] = scenario
    return scenario


def deleteScenario(uuid: str) -> Union[bool, str]:
    global scenarios, scenarioByUUID

    if uuid in scenarioFilenameByUUID:
        try:
            os.remove(EXERCISE_DIR / scenarioFilenameByUUID[uuid])
        except Exception as e:
            print(e)
            return e
        del scenarioByUUID[uuid]
        scenarios = [s for s in scenarios if s['exercise']['uuid'] != uuid]
        return True
    return 'Scenario not found'


def saveInject(scenario_uuid: str, injectToSave, injectFlowToSave) -> Union[dict, str]:
    global scenarios, scenarioByUUID

    if scenario_uuid not in scenarioByUUID:
        return 'Invalid scenario'
    scenario = scenarioByUUID[scenario_uuid]

    # Search inject in scenario and create/update it
    injectToSave = injectToSave.dict()
    found = False
    for i, inject in enumerate(scenario['injects']):
        if inject['uuid'] == injectToSave['uuid']:
            scenario['injects'][i] = injectToSave
            found = True
    if not found:
        scenario['injects'].append(injectToSave)

    injectFlowToSave = injectFlowToSave.dict()
    for i, injectF in enumerate(scenario['inject_flow']):
        if injectF['inject_uuid'] == injectFlowToSave['inject_uuid']:
            scenario['inject_flow'][i] = marshallInjectFlow(injectFlowToSave)
            found = True
    if not found:
        scenario['inject_flow'].append(marshallInjectFlow(injectFlowToSave))

    saveResult = saveScenario(scenario_uuid, scenario)
    return saveResult


def saveScenario(scenario_uuid: str, scenario: dict) -> Union[bool, str]:
    global scenarioFilenameByUUID
    filename = scenarioFilenameByUUID[scenario_uuid]
    try:
        with open(EXERCISE_DIR / filename, 'w') as f:
            json.dump(scenario, f, indent=4)
    except Exception as e:
        print(e)
        return e
    return True


def saveJSON(filename: str, content: str) -> Union[bool, str]:
    try:
        with open(EXERCISE_DIR / filename, 'w') as f:
            f.write(content)
    except Exception as e:
        print(e)
        return e
    reloadJsonFiles()
    return True


def removeInject(scenario_uuid: str, inject_uuid: str) -> Union[bool, str]:
    global scenarios, scenarioByUUID

    if scenario_uuid not in scenarioByUUID:
        return 'Invalid scenario'
    scenario = scenarioByUUID[scenario_uuid]

    for i, inject in enumerate(scenario['injects']):
        if inject['uuid'] == inject_uuid:
            scenario['injects'].pop(i)
    
    for i, injectF in enumerate(scenario['inject_flow']):
        if injectF['requirements'].get('inject_uuid', None) == inject_uuid:
            scenario['inject_flow'][i]['requirements'] = {}

        if injectF['inject_uuid'] == inject_uuid:
            scenario['inject_flow'].pop(i)

    saveResult = saveScenario(scenario_uuid, scenario)
    return saveResult


def orderInjects(scenario_uuid, inject_uuids) -> Union[bool, str]:
    global scenarios, scenarioByUUID

    if scenario_uuid not in scenarioByUUID:
        return 'Invalid scenario'
    scenario = scenarioByUUID[scenario_uuid]

    orderedInjects = []
    orderedInjectFlows = []
    for inject_uuid in inject_uuids:
        inject = [i for i in scenario['injects'] if i['uuid'] == inject_uuid][0]
        injectFlow = [i for i in scenario['inject_flow'] if i['inject_uuid'] == inject_uuid][0]
        orderedInjects.append(inject)
        orderedInjectFlows.append(injectFlow)
    
    scenario['injects'] = orderedInjects
    scenario['inject_flow'] = orderedInjectFlows

    saveResult = saveScenario(scenario_uuid, scenario)
    return saveResult


def testInject(injectToTest) -> dict:
    inject_evaluator = loadInjectEvaluator()

    user_id = 0
    misp_url = injectToTest.query_search_misp_url
    authkey = injectToTest.query_search_misp_apikey
    inject_evaluation = {
        'parameters': injectToTest.eval_params,
        'evaluation_strategy': injectToTest.evaluation_strategy,
        'evaluation_context': {
            'query_context': {
                'url': injectToTest.query_search_url if (injectToTest.evaluation_strategy == 'query_search' or injectToTest.evaluation_strategy == 'python') else injectToTest.query_mirror_url,
                'request_method': injectToTest.query_search_method if (injectToTest.evaluation_strategy == 'query_search' or injectToTest.evaluation_strategy == 'python') else injectToTest.query_mirror_method,
                'payload': injectToTest.query_search_payload if (injectToTest.evaluation_strategy == 'query_search' or injectToTest.evaluation_strategy == 'python') else injectToTest.query_mirror_payload,
            }
        },
        'score_range': [0, 10],
    }
    context = {}
    context.update(inject_evaluation['evaluation_context'])
    context.update(injectToTest.evaluation_context)

    test_result = {
        'outcome': 1,
        'debug': {},
    }
    success = False
    debug = []
    if inject_evaluation['evaluation_strategy'] == 'data_filtering':
        data_to_validate = injectToTest.test_data
        (success, inject_debug) = inject_evaluator.eval_data_filtering(authkey, inject_evaluation, data_to_validate, context, debug=True)
        debug = debug + inject_debug
    elif inject_evaluation['evaluation_strategy'] == 'query_mirror':
        pass  # Not implemented
    elif inject_evaluation['evaluation_strategy'] == 'query_search':
        data_to_validate, error = fetch_data_for_query_search(misp_url, authkey, inject_evaluation)
        if data_to_validate is not False:
            data_length = len(data_to_validate['response']) if type(data_to_validate) is dict else len(data_to_validate)
            debug.append([{'message': f'Fetched entries', 'data': data_length}])
            (success, inject_debug) = inject_evaluator.eval_query_search(user_id, inject_evaluation, data_to_validate, context, debug=True)
            debug = debug + inject_debug
        else:
            debug.append([{'message': f'Error while fetching data', 'data': error}])
    elif inject_evaluation['evaluation_strategy'] == 'python':
        # Tries to fetch data based on provided auth. Fallback to test_data
        data_to_validate = injectToTest.test_data
        if misp_url and authkey:
            data_to_validate, error = fetch_data_for_query_search(misp_url, authkey, inject_evaluation)
        if data_to_validate is False:
            data_to_validate = injectToTest.test_data

        try:
            (success, inject_debug) = inject_evaluator.eval_python(authkey, inject_evaluation, data_to_validate, context, debug=True)
        except OSError as e:
            # The python strategy runs the submitted code in a separate sandbox
            # agent (epicbox/Docker) reached over HTTP on localhost:9573. When it
            # is not running the socket call raises ConnectionRefusedError (an
            # OSError) — surface an actionable message rather than a bare 500.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    'Python sandbox agent not reachable on localhost:9573. Start it with: '
                    '(cd tools/SkillAegis-Dashboard/backend && python sandboxAgent.py) — requires Docker.'
                ),
            ) from e
        debug = debug + inject_debug
    test_result['outcome'] = INJECT_EVAL_SUCCESS if success else INJECT_EVAL_FAIL
    test_result['debug'] = debug
    return test_result


def probe_sandbox_agent(timeout: float = 0.5) -> dict:
    """Cheaply check whether the python sandbox agent is accepting connections.

    Does a TCP connect only (no container spin-up), so it is safe to poll from
    the UI. A successful connect means the agent on localhost:9573 is listening;
    it does not by itself prove the Docker engine behind it is healthy.
    """
    result = {'reachable': False, 'host': SANDBOX_AGENT_HOST, 'port': SANDBOX_AGENT_PORT}
    try:
        with socket.create_connection((SANDBOX_AGENT_HOST, SANDBOX_AGENT_PORT), timeout=timeout):
            result['reachable'] = True
    except OSError as e:
        result['reason'] = str(e)
        result['hint'] = (
            'Start it with: (cd tools/SkillAegis-Dashboard/backend && python sandboxAgent.py) '
            '— requires Docker.'
        )
    return result


def testJqPath(path: str, data: dict, extract_type: str) -> tuple:
    inject_evaluator = loadInjectEvaluator()
    success = True
    result = False
    try:
        result = inject_evaluator.jq_extract(path, data, extract_type)
    except ValueError as e:
        success = False
        result = str(e)
    return (success, result,)


def fetch_data_for_query_search(misp_url, authkey, inject_evaluation):
    query_context = inject_evaluation['evaluation_context']['query_context']
    search_method = query_context['request_method']
    search_url = query_context['url']
    search_payload = query_context['payload']
    search_data, success  = doRestQuery(misp_url ,authkey, search_method, search_url, search_payload)
    return (search_data, None,) if success else (False, search_data,)


def doRestQuery(misp_url, authkey, method, url, payload) -> tuple:
    headers = {
        'User-Agent': 'SkillAegis',
        "Authorization": authkey,
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    full_url = urljoin(misp_url, url)
    try:
        if method == 'POST':
            response = requests.post(full_url, data=json.dumps(payload), headers=headers, verify=False)
        else:
            response = requests.get(full_url, data=json.dumps(payload), headers=headers, verify=False)
    except Exception as e:
        return (e, False)
    try:
        return (response.json(), True,) if response.headers['content-type'].startswith('application/json') else (response.text, True,)
    except requests.exceptions.JSONDecodeError:
        return (response.text, True,)


class Exercise(BaseModel):
    name: str
    namespace: str
    description: str | None = None
    uuid: str | None = None
    version: str | None = None
    meta: dict | None = {}


class Inject(BaseModel):
    name: str
    action: str
    target_tool: str | None = None
    uuid: str | None = None
    description: str | None = None
    inject_evaluation: list | None = []
    inject_evaluation_join_type: str | None = None


class InjectFlow(BaseModel):
    inject_uuid: str
    description: str | None = None
    requirements: dict | None = None
    sequence: dict | None = None
    timing: dict | None = None


class InjectOrder(BaseModel):
    inject_uuids: list


class InjectToTestPayload(BaseModel):
    target_tool: str
    evaluation_strategy: str
    eval_params: list | None = []

    test_data: dict | None = {}
    evaluation_context: dict | None = {}

    query_mirror_url: str | None = None
    query_mirror_method: str | None = None
    query_mirror_payload: list | None = []

    query_search_url: str | None = None
    query_search_method: str | None = None
    query_search_payload: dict | None = {}
    query_search_misp_url: str | None = None
    query_search_misp_apikey: str | None = None


class JqPathToTestPayload(BaseModel):
    path: str
    data: dict | None = {}
    extract_type: str = 'all'


class SaveJSONPayload(BaseModel):
    filename: str
    content: str


@app.get("/scenarios/index")
def scenarios_index():
    global scenarios, scenarioByUUID, readErrors, scenarioFilenameByUUID, scenarioValidatedByUUID, CEXF_SCHEMA
    return {
        'scenarios': scenarios,
        'scenario_by_uuid': scenarioByUUID,
        'read_errors': readErrors,
        'scenario_filename_by_uuid': scenarioFilenameByUUID,
        'scenario_validated_by_uuid': scenarioValidatedByUUID,
        'cexf_schema': CEXF_SCHEMA,
    }


@app.post("/scenarios/reload")
def scenarios_reload():
    global scenarios, scenarioByUUID, readErrors, scenarioFilenameByUUID, scenarioValidatedByUUID
    reloadJsonFiles()
    return {
        'scenarios': scenarios,
        'scenario_by_uuid': scenarioByUUID,
        'read_errors': readErrors,
        'scenario_filename_by_uuid': scenarioFilenameByUUID,
        'scenario_validated_by_uuid': scenarioValidatedByUUID,
    }


@app.get("/scenarios/view/{uuid}")
def scenarios_view(uuid: str):
    scenario = scenarioByUUID.get(uuid, None)
    if scenario is not None:
        return scenario
    return error('Scenario not found', uuid)


@app.post("/scenarios/add")
def scenarios_add(exercise: Exercise):
    scenario = createScenario(exercise)
    if type(scenario) is dict:
        return success('New scenario created', payload=scenario)
    return error('Could not create scenario', scenario)


@app.post("/scenarios/edit")
def scenarios_edit(exercise: Exercise):
    scenario = editScenario(exercise)
    if type(scenario) is dict:
        return success('Scenario Updated', payload=scenario)
    return error('Could not update scenario', scenario)


@app.post("/scenarios/delete/{uuid}")
def scenarios_delete(uuid: str):
    result = deleteScenario(uuid)
    if result is True:
        return success(f"Scenario deleted")
    return error('Could not delete scenario', result)


@app.post("/scenarios/save-json")
def save_json(saveJSONPayload: SaveJSONPayload):
    result = saveJSON(saveJSONPayload.filename, saveJSONPayload.content)
    if result is True:
        return success(f"JSON saved")
    return error('Could not save JSON', result)


@app.post("/scenarios/save-inject/{scenario_uuid}")
def save_inject(scenario_uuid: str, inject: Inject, injectFlow: InjectFlow):
    result = saveInject(scenario_uuid, inject, injectFlow)
    if result is True:
        return success(f"Inject saved")
    return error('Could not save inject', result)


@app.post("/scenarios/delete-inject/{scenario_uuid}/{inject_uuid}")
def save_inject(scenario_uuid: str, inject_uuid: str):
    result = removeInject(scenario_uuid, inject_uuid)
    if result is True:
        return success(f"Inject removed")
    return error('Could not remove inject', result)


@app.post("/scenarios/order-inject/{scenario_uuid}")
def save_inject(scenario_uuid: str, injectOrder: InjectOrder):
    result = orderInjects(scenario_uuid, injectOrder.inject_uuids)
    if result is True:
        return success(f"Injects reordered")
    return error('Could not reorder injects', result)


@app.post("/injects/test")
def save_inject(injectToTest: InjectToTestPayload):
    result = testInject(injectToTest)
    return success(f"Injects tested", "Result is attached", result)


@app.get("/injects/sandbox-status")
def sandbox_status():
    # Lets the UI tell whether the `python` strategy is testable *before* a user
    # writes/runs code, instead of only discovering it via a 503 after testing.
    status = probe_sandbox_agent()
    title = 'Python sandbox agent reachable' if status['reachable'] else 'Python sandbox agent not reachable'
    return success(title, status.get('hint', ''), status)


@app.post("/injects/jq-path-test")
def test_jq_path(jqPathToTest: JqPathToTestPayload):
    testSuccess, result = testJqPath(jqPathToTest.path, jqPathToTest.data, jqPathToTest.extract_type)
    if testSuccess:
        return success(f"JQ path tested", "Result is attached", result)
    else:
        return error(f"Error during testing", result)


app.mount('/', StaticFiles(directory='dist', html=True))
