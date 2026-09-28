'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'hooks', 'tests-green.js');
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kirby-state-'));

// Suíte falsa: registra cada execução em runs.log e sai com o código em ./code.
const FAKE_SUITE = `
const fs = require('fs');
fs.appendFileSync('runs.log', 'x');
const sleep = Number(fs.existsSync('sleep') ? fs.readFileSync('sleep', 'utf8') : 0);
if (sleep) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep * 1000);
console.log('SAIDA-DA-SUITE');
process.exit(Number(fs.readFileSync('code', 'utf8')));
`;

let sessionCounter = 0;

function makeProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kirby-'));
  const all = { 'suite.js': FAKE_SUITE, code: '0', '.claude/kirby-test': 'node suite.js', ...files };
  for (const [rel, content] of Object.entries(all)) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return { root, session: `sessao-${process.pid}-${++sessionCounter}` };
}

function hook(project, mode, extraEnv = {}) {
  const r = spawnSync('node', [HOOK, mode], {
    input: JSON.stringify({ session_id: project.session, cwd: project.root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project.root, KIRBY_STATE_DIR: STATE_DIR, ...extraEnv },
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const runs = p => (fs.existsSync(path.join(p.root, 'runs.log')) ? fs.readFileSync(path.join(p.root, 'runs.log'), 'utf8').length : 0);
const setCode = (p, code) => fs.writeFileSync(path.join(p.root, 'code'), String(code));

test('sem edição na sessão, não roda os testes', () => {
  const p = makeProject();
  assert.equal(hook(p, 'check').code, 0);
  assert.equal(runs(p), 0);
});

test('edição + testes verdes libera e limpa a marca', () => {
  const p = makeProject();
  hook(p, 'mark');
  assert.equal(hook(p, 'check').code, 0);
  assert.equal(hook(p, 'check').code, 0);
  assert.equal(runs(p), 1);
});

test('edição + testes vermelhos bloqueia com a saída da suíte', () => {
  const p = makeProject({ code: '1' });
  hook(p, 'mark');
  const r = hook(p, 'check');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SAIDA-DA-SUITE/);
  assert.match(r.stderr, /tentativa 1\/3/);
});

test('depois de 3 bloqueios, libera e avisa o usuário', () => {
  const p = makeProject({ code: '1' });
  hook(p, 'mark');
  for (let i = 1; i <= 3; i++) assert.equal(hook(p, 'check').code, 2, `bloqueio ${i}`);
  const released = hook(p, 'check');
  assert.equal(released.code, 0);
  assert.match(JSON.parse(released.stdout).systemMessage, /3 tentativas/);
  assert.equal(hook(p, 'check').code, 0);
  assert.equal(runs(p), 4);
});

test('verde depois de vermelho zera o contador', () => {
  const p = makeProject({ code: '1' });
  hook(p, 'mark');
  hook(p, 'check');
  setCode(p, 0);
  assert.equal(hook(p, 'check').code, 0);
  setCode(p, 1);
  hook(p, 'mark');
  assert.match(hook(p, 'check').stderr, /tentativa 1\/3/);
});

test('"off" em .claude/kirby-test desliga', () => {
  const p = makeProject({ code: '1', '.claude/kirby-test': '# desligado neste repo\noff\n' });
  hook(p, 'mark');
  assert.equal(hook(p, 'check').code, 0);
  assert.equal(runs(p), 0);
});

test('comando inexistente libera e avisa', () => {
  const p = makeProject({ '.claude/kirby-test': 'comando-que-nao-existe-kirby' });
  hook(p, 'mark');
  const r = hook(p, 'check');
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /não encontrado/);
});

test('timeout libera e sugere subconjunto rápido', () => {
  const p = makeProject({ sleep: '3' });
  hook(p, 'mark');
  const r = hook(p, 'check', { KIRBY_TEST_TIMEOUT: '1' });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /subconjunto rápido/);
});

test('sessões diferentes não se misturam', () => {
  const p = makeProject({ code: '1' });
  hook(p, 'mark');
  const other = { ...p, session: p.session + '-outra' };
  assert.equal(hook(other, 'check').code, 0);
  assert.equal(runs(p), 0);
});

test('detecção automática do comando', async t => {
  const detect = files => {
    const { root } = makeProject({ 'suite.js': null, code: null, '.claude/kirby-test': null, ...files });
    return spawnSync('node', [HOOK, 'detect'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  };
  const cases = [
    ['override em .claude/kirby-test', { '.claude/kirby-test': 'pytest -q -m fast', Makefile: 'test:\n\tpytest' }, 'pytest -q -m fast'],
    ['Makefile com alvo test', { Makefile: 'lint:\n\truff .\ntest:\n\tpytest\n', 'package.json': '{"scripts":{"test":"jest"}}' }, 'make test'],
    ['package.json', { 'package.json': '{"scripts":{"test":"vitest run"}}' }, 'npm test'],
    ['package.json com pnpm', { 'package.json': '{"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': '' }, 'pnpm test'],
    ['placeholder do npm é ignorado', { 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }, '(nenhum comando de teste detectado)'],
    ['pytest com uv', { 'pyproject.toml': '[tool.pytest.ini_options]\n', 'uv.lock': '' }, 'uv run pytest -q'],
    ['pytest com poetry', { 'conftest.py': '', 'poetry.lock': '' }, 'poetry run pytest -q'],
    ['elixir', { 'mix.exs': '' }, 'mix test'],
    ['go', { 'go.mod': '' }, 'go test ./...'],
    ['nada', {}, '(nenhum comando de teste detectado)'],
  ];
  for (const [name, files, expected] of cases) {
    await t.test(name, () => assert.equal(detect(files), expected));
  }
});

test('baseline: suíte já vermelha antes das edições não bloqueia, só avisa', () => {
  const p = makeProject({ code: '1' });
  assert.equal(hook(p, 'baseline').code, 0);
  hook(p, 'mark');
  const r = hook(p, 'check');
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /já falhava antes/);
});

test('baseline: suíte verde que o agente quebrou continua bloqueando', () => {
  const p = makeProject();
  hook(p, 'baseline');
  setCode(p, 1);
  hook(p, 'mark');
  assert.equal(hook(p, 'check').code, 2);
});

test('baseline roda uma vez só por sessão', () => {
  const p = makeProject();
  hook(p, 'baseline');
  hook(p, 'baseline');
  assert.equal(runs(p), 1);
});

test('baseline nunca bloqueia a edição', () => {
  const p = makeProject({ code: '1' });
  assert.equal(hook(p, 'baseline').code, 0);
});

test('baseline sobrevive ao fim de uma rodada', () => {
  const p = makeProject({ code: '1' });
  hook(p, 'baseline');
  hook(p, 'mark');
  hook(p, 'check');
  hook(p, 'mark');
  assert.equal(hook(p, 'check').code, 0);
});

test('baseline indefinido (timeout) não impede o bloqueio depois', () => {
  const p = makeProject({ sleep: '3' });
  hook(p, 'baseline', { KIRBY_TEST_TIMEOUT: '1' });
  fs.rmSync(path.join(p.root, 'sleep'));
  setCode(p, 1);
  hook(p, 'mark');
  assert.equal(hook(p, 'check').code, 2);
});
