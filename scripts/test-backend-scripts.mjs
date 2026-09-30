import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('This test exercises Windows PowerShell launch scripts; run it on Windows.');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toUpperCase().startsWith('DB_')) delete env[key];
}
Object.assign(env, {
  DB_ENABLED: 'true', DB_HOST: '127.0.0.1', DB_PORT: '3306',
  DB_NAME: 'synthetic_script_test', DB_USER: 'synthetic', DB_PASSWORD: 'test-only',
});

// Stub network/Maven only in child processes: no database connection or server is started.
const cases = [
  ['disabled DB', '$env:DB_ENABLED="false"', 'run-dev', false, /DB_ENABLED must be set/],
  ['missing DB name', 'Remove-Item Env:DB_NAME', 'run-dev', false, /Missing required environment variable: DB_NAME/],
  ['TCP refused', 'function Test-NetConnection { return $false }', 'run-dev', false, /Database TCP check failed/],
  ['TCP exception', 'function Test-NetConnection { throw "test network failure" }', 'run-dev', false, /Database TCP check failed/],
  ['startup Maven failure', 'function Test-NetConnection { return $true }; function mvn { $global:LASTEXITCODE=7 }', 'run-dev', false, /Maven backend startup failed/],
  ['startup success', 'function Test-NetConnection { return $true }; function mvn { $global:LASTEXITCODE=0 }', 'run-dev', true, /preflight check passed/],
  ['build Maven failure', 'function mvn { $global:LASTEXITCODE=9 }', 'build', false, /Maven backend build failed/],
  ['build success', 'function mvn { $global:LASTEXITCODE=0 }', 'build', true, null],
];

for (const [name, setup, script, success, expectedOutput] of cases) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `${setup}; & './services/backend/${script}.ps1'`,
  ], { cwd: root, env, encoding: 'utf8', timeout: 15_000, windowsHide: true });
  assert.ifError(result.error);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status === 0, success, `${name}: exit=${result.status}\n${output}`);
  if (expectedOutput) assert.match(output, expectedOutput, name);
  console.log(`PASS ${name}`);
}
