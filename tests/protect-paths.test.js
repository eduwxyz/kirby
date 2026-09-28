'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'hooks', 'protect-paths.js');

const FIXTURE = {
  '.claude/kirby-protected': '# régua do projeto\nevals/datasets/\njudges/**\nthresholds.yaml\n',
  'evals/datasets/case-1.json': '{}',
  'judges/prompt.md': 'Você é um juiz.',
  'config/thresholds.yaml': 'min_score: 0.9',
  'src/agent.py': 'pass',
};

function makeProject(files = FIXTURE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kirby-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function hook(root, tool, toolInput, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv };
  if (!('KIRBY_ALLOW_PROTECTED' in extraEnv)) delete env.KIRBY_ALLOW_PROTECTED;
  const input = typeof toolInput === 'string' && tool === null
    ? toolInput
    : JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd: root });
  const r = spawnSync('node', [HOOK], { input, env, encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr };
}

const edit = (root, rel) => hook(root, 'Edit', { file_path: path.join(root, rel) }).code;
const write = (root, rel) => hook(root, 'Write', { file_path: path.join(root, rel) }).code;
const bash = (root, command) => hook(root, 'Bash', { command }).code;

const BLOCK = 2;
const ALLOW = 0;

test('ferramentas de edição', async t => {
  const root = makeProject();
  await t.test('bloqueia editar arquivo protegido existente', () => assert.equal(edit(root, 'evals/datasets/case-1.json'), BLOCK));
  await t.test('permite criar arquivo novo em diretório protegido', () => assert.equal(write(root, 'evals/datasets/case-2.json'), ALLOW));
  await t.test('permite editar arquivo fora da lista', () => assert.equal(edit(root, 'src/agent.py'), ALLOW));
  await t.test('padrão sem barra vale em qualquer profundidade', () => assert.equal(edit(root, 'config/thresholds.yaml'), BLOCK));
  await t.test('a própria lista é sempre protegida', () => assert.equal(edit(root, '.claude/kirby-protected'), BLOCK));
  await t.test('arquivo fora do projeto não é afetado', () => assert.equal(edit(root, '../outro/arquivo.json'), ALLOW));
  await t.test('NotebookEdit usa notebook_path', () => {
    assert.equal(hook(root, 'NotebookEdit', { notebook_path: path.join(root, 'judges/prompt.md') }).code, BLOCK);
  });
});

test('sem lista, nada além da própria lista é protegido', () => {
  const root = makeProject({ 'evals/datasets/case-1.json': '{}' });
  assert.equal(edit(root, 'evals/datasets/case-1.json'), ALLOW);
  assert.equal(write(root, '.claude/kirby-protected'), ALLOW); // criar a lista é permitido
});

test('bash', async t => {
  const root = makeProject();
  const cases = [
    ['sed -i em arquivo protegido', "sed -i '' 's/a/b/' evals/datasets/case-1.json", BLOCK],
    ['perl -pi em arquivo protegido', "perl -pi -e 's/x/y/' judges/prompt.md", BLOCK],
    ['>> em arquivo protegido', 'echo "{}" >> evals/datasets/case-1.json', BLOCK],
    ['> criando arquivo novo', 'echo "{}" > evals/datasets/case-9.json', ALLOW],
    ['rm -rf no diretório pai', 'rm -rf evals', BLOCK],
    ['rm com curinga', 'rm evals/datasets/*', BLOCK],
    ['cp sobrescrevendo protegido', 'cp /tmp/x judges/prompt.md', BLOCK],
    ['cp lendo protegido', 'cp judges/prompt.md /tmp/copia.md', ALLOW],
    ['cp pra dentro de diretório protegido (arquivo novo)', 'cp src/agent.py evals/datasets/', ALLOW],
    ['mv tirando arquivo protegido', 'mv evals/datasets/case-1.json /tmp/', BLOCK],
    ['git checkout em protegido', 'git checkout -- evals/datasets/case-1.json', BLOCK],
    ['bash -c aninhado', 'bash -c "rm evals/datasets/case-1.json"', BLOCK],
    ['depois de &&', 'npm test && mv judges/prompt.md /tmp/p.md', BLOCK],
    ['cd antes do rm', 'cd evals/datasets && rm case-1.json', BLOCK],
    ['rm -rf em diretório comum', 'rm -rf src', ALLOW],
    ['find -delete', 'find judges -name "*.md" -delete', BLOCK],
    ['tee em protegido', 'echo x | tee config/thresholds.yaml', BLOCK],
    ['leitura com redirect pra fora', 'cat evals/datasets/case-1.json > /tmp/out.txt', ALLOW],
    ['grep em protegido', 'grep -r min_score config/', ALLOW],
    ['find sem mutação', 'find judges -name "*.md" -exec cat {} \\;', ALLOW],
    ['sed -i em arquivo comum', "sed -i '' 's/a/b/' src/agent.py", ALLOW],
    ['2>&1 não é arquivo', 'npm test 2>&1', ALLOW],
    ['texto entre aspas não é comando', 'echo "rm evals/datasets/case-1.json"', ALLOW],
  ];
  for (const [name, command, expected] of cases) {
    await t.test(name, () => assert.equal(bash(root, command), expected, command));
  }
});

test('KIRBY_ALLOW_PROTECTED=1 libera', () => {
  const root = makeProject();
  const r = hook(root, 'Edit', { file_path: path.join(root, 'judges/prompt.md') }, { KIRBY_ALLOW_PROTECTED: '1' });
  assert.equal(r.code, ALLOW);
});

test('mensagem de bloqueio explica regra e saída', () => {
  const root = makeProject();
  const { stderr } = hook(root, 'Edit', { file_path: path.join(root, 'evals/datasets/case-1.json') });
  assert.match(stderr, /evals\/datasets\/case-1\.json/);
  assert.match(stderr, /evals\/datasets\//);
  assert.match(stderr, /KIRBY_ALLOW_PROTECTED/);
});

test('entrada ilegível bloqueia', () => {
  const root = makeProject();
  assert.equal(hook(root, null, 'isso não é json').code, BLOCK);
});
