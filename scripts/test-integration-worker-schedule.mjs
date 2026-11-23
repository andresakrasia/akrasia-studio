import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workflow=YAML.parse(readFileSync(path.join(root,'.github/workflows/integration-worker.yml'),'utf8'));
let checks=0;const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};const ok=v=>{checks++;assert.ok(v);};
equal(workflow.on.schedule,[{cron:'*/5 * * * *'}]);ok('workflow_dispatch' in workflow.on);equal(workflow.permissions,{contents:'read'});equal(workflow.concurrency['cancel-in-progress'],false);
const step=workflow.jobs.process.steps[0];equal(step.env.AKRASIA_APP_URL,'${{ vars.AKRASIA_APP_URL }}');equal(step.env.INTEGRATION_WORKER_SECRET,'${{ secrets.INTEGRATION_WORKER_SECRET }}');
const script=step.run.match(/^python3 - <<'PY'\n([\s\S]+)\nPY\n?$/)?.[1];ok(script);
const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const executable=process.env.AKRASIA_TEST_PYTHON || (existsSync(bundled)?bundled:'python3');
// Execute the actual saved scheduler script with urllib replaced BEFORE execution.
// No test is allowed to use a real socket or inspect local application credentials.
const stub=`import os, json, urllib.request, urllib.error, socket
def forbidden_socket(*args, **kwargs):
    raise AssertionError('Network is forbidden')
socket.socket = forbidden_socket
class FakeResponse:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, maximum): return os.environ['TEST_RESULT'].encode()
class FakeOpener:
    def open(self, request, timeout):
        assert os.environ.get('TEST_EXPECT_REQUEST') == 'yes'
        assert request.method == 'POST' and request.data is None
        assert request.full_url == 'https://app.example.invalid/api/integrations/process'
        assert request.get_header('Authorization') == 'Bearer ' + os.environ['INTEGRATION_WORKER_SECRET']
        assert timeout == 58
        if os.environ.get('TEST_HTTP_FAILURE'):
            raise urllib.error.HTTPError(request.full_url, 401, 'synthetic', {}, None)
        return FakeResponse()
urllib.request.build_opener = lambda *args: FakeOpener()
`;
function run(env={}){
 const result=spawnSync(executable,['-c',stub+'\n'+script],{encoding:'utf8',windowsHide:true,
   env:{SYSTEMROOT:process.env.SYSTEMROOT||'',TEMP:os.tmpdir(),AKRASIA_APP_URL:'',INTEGRATION_WORKER_SECRET:'',...env}});
 if(result.error)throw result.error;return result;
}
let result=run();equal(result.status,0);ok(result.stdout.includes('pendiente de configurar'));
const key='de'.repeat(32);for(const origin of ['http://app.example.invalid','https://user:password@app.example.invalid','https://app.example.invalid/path','https://app.example.invalid?secret=canary','https://app.example.invalid#private']){
 result=run({AKRASIA_APP_URL:origin,INTEGRATION_WORKER_SECRET:key});equal(result.status,1);ok(!result.stdout.includes('canary'));ok(!result.stdout.includes(key));
}
result=run({AKRASIA_APP_URL:'https://app.example.invalid',INTEGRATION_WORKER_SECRET:'bad'});equal(result.status,1);
const valid={AKRASIA_APP_URL:'https://app.example.invalid',INTEGRATION_WORKER_SECRET:key,TEST_EXPECT_REQUEST:'yes',TEST_RESULT:JSON.stringify({processed:2,accepted:2,retry:0,failed:0,uncertain:0,disabled:0,cleaned:0})};
result=run(valid);equal(result.status,0);ok(result.stdout.includes('processed=2'));ok(!result.stdout.includes(key));
result=run({...valid,TEST_RESULT:JSON.stringify({privateEmail:'person@example.invalid'})});equal(result.status,1);ok(!result.stdout.includes('person@example.invalid'));
result=run({...valid,TEST_HTTP_FAILURE:'yes'});equal(result.status,1);ok(result.stdout.includes('HTTP 401'));ok(!result.stdout.includes(key));
console.log(`Integration scheduling: ${checks} offline checks passed; actual workflow, synthetic HTTP only.`);
