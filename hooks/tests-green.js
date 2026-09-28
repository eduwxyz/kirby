#!/usr/bin/env node
// kirby · tests-green
//
// Não deixa o agente encerrar a resposta com testes que ele quebrou.
//   baseline  PreToolUse na 1ª edição da sessão: roda os testes e anota se já
//             estavam vermelhos antes de o agente mexer em qualquer coisa.
//   mark      PostToolUse em edições: marca que a sessão mexeu em arquivos.
//   check     Stop: se houve edição, roda os testes; falhou → bloqueia com a saída.
//             Se a suíte já estava vermelha no baseline, não bloqueia: só avisa.
//   detect    Manual: imprime o comando de teste que seria usado no diretório atual.
//
// Comando: primeira linha de .claude/kirby-test ("off" desliga) ou detecção automática.
// Depois de MAX_BLOCKS bloqueios seguidos, libera e avisa o usuário (sem loop infinito).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILE = '.claude/kirby-test';
const MAX_BLOCKS = 3;
const TIMEOUT_SECONDS = Number(process.env.KIRBY_TEST_TIMEOUT) || 540;
const OUTPUT_LINES = 60;
const OUTPUT_CHARS = 6000;
const STATE_DIR = process.env.KIRBY_STATE_DIR || path.join(os.tmpdir(), 'kirby');

// ─── Comando de teste ───────────────────────────────────────────────────────

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

const has = (root, rel) => fs.existsSync(path.join(root, rel));

function npmTestCommand(root) {
  let script;
  try {
    script = JSON.parse(read(root, 'package.json')).scripts?.test;
  } catch {
    return null;
  }
  if (!script || /no test specified/.test(script)) return null;
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm test';
  if (has(root, 'yarn.lock')) return 'yarn test';
  if (has(root, 'bun.lock') || has(root, 'bun.lockb')) return 'bun run test';
  return 'npm test';
}

function pytestCommand(root) {
  const usesPytest = has(root, 'pytest.ini') || has(root, 'conftest.py') ||
    /pytest/.test(read(root, 'pyproject.toml') ?? '');
  if (!usesPytest) return null;
  if (has(root, 'uv.lock')) return 'uv run pytest -q';
  if (has(root, 'poetry.lock')) return 'poetry run pytest -q';
  return 'pytest -q';
}

function detectCommand(root) {
  const config = read(root, CONFIG_FILE);
  if (config !== null) {
    const line = config.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    return line && line !== 'off' ? line : null;
  }
  if (/^test:/m.test(read(root, 'Makefile') ?? '')) return 'make test';
  return npmTestCommand(root) ??
    pytestCommand(root) ??
    (has(root, 'mix.exs') ? 'mix test' : null) ??
    (has(root, 'go.mod') ? 'go test ./...' : null) ??
    (has(root, 'Cargo.toml') ? 'cargo test' : null);
}

// ─── Estado por sessão ──────────────────────────────────────────────────────

function stateFile(sessionId) {
  const safe = String(sessionId || 'sem-sessao').replace(/[^\w.-]/g, '_');
  return path.join(STATE_DIR, `${safe}.json`);
}

function loadState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
  } catch {
    return { dirty: false, blocks: 0 };
  }
}

function saveState(sessionId, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(sessionId), JSON.stringify(state));
}

// ─── Modos ──────────────────────────────────────────────────────────────────

function tail(text) {
  const lines = text.trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');
  return lines.length > OUTPUT_CHARS ? '…' + lines.slice(-OUTPUT_CHARS) : lines;
}

// Libera o encerramento, mas mostra um aviso pro usuário.
function notify(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
  process.exit(0);
}

function runTests(command, root) {
  return spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: TIMEOUT_SECONDS * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1' }, // evita modo watch de test runners
  });
}

// Uma vez por sessão, antes da primeira edição: a suíte já estava vermelha?
// Nunca bloqueia a edição, só registra.
function baseline(input, root) {
  const id = input.session_id;
  const state = loadState(id);
  if (state.baseline) return;

  const command = detectCommand(root);
  let result = 'unknown';
  if (command) {
    const run = runTests(command, root);
    if (run.status === 0) result = 'green';
    else if (!run.error && run.status !== 127) result = 'red';
  }
  saveState(id, { ...state, baseline: result });
}

function mark(input) {
  const state = loadState(input.session_id);
  saveState(input.session_id, { ...state, dirty: true });
}

function check(input, root) {
  const id = input.session_id;
  const state = loadState(id);
  if (!state.dirty) return;

  const reset = () => saveState(id, { ...loadState(id), dirty: false, blocks: 0 });
  const command = detectCommand(root);
  if (!command) return reset();

  const run = runTests(command, root);

  if (run.error?.code === 'ETIMEDOUT') {
    reset();
    notify(`kirby: \`${command}\` passou de ${TIMEOUT_SECONDS}s e foi interrompido. ` +
      `Aponte um subconjunto rápido em ${CONFIG_FILE}.`);
  }
  if (run.status === 0) return reset();
  if (run.status === 127) {
    reset();
    notify(`kirby: comando de teste não encontrado (\`${command}\`). Ajuste ${CONFIG_FILE}.`);
  }

  // Suíte que já estava vermelha não é culpa desta sessão: cobrar o conserto
  // levaria o agente a mexer no que ninguém pediu.
  if (state.baseline === 'red') {
    reset();
    notify(`kirby: \`${command}\` está falhando, mas já falhava antes das edições desta sessão; ` +
      'não bloqueei. Vale conferir se as mudanças não adicionaram falhas novas.');
  }

  const blocks = state.blocks + 1;
  if (blocks > MAX_BLOCKS) {
    reset();
    notify(`kirby: testes seguem falhando depois de ${MAX_BLOCKS} tentativas; liberei pra você decidir.`);
  }
  saveState(id, { ...state, dirty: true, blocks });

  const exit = run.status ?? run.signal;
  process.stderr.write(
    `kirby: testes falhando (\`${command}\`, saída ${exit}), tentativa ${blocks}/${MAX_BLOCKS}.\n` +
    'Corrija o código antes de encerrar; não pule nem afrouxe testes.\n\n' +
    tail(`${run.stdout ?? ''}${run.stderr ?? ''}`) + '\n'
  );
  process.exit(2);
}

function main() {
  const mode = process.argv[2];
  if (mode === 'detect') {
    console.log(detectCommand(process.cwd()) ?? '(nenhum comando de teste detectado)');
    return;
  }

  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return; // entrada ilegível: não trava a sessão
  }
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  if (mode === 'baseline') baseline(input, root);
  else if (mode === 'mark') mark(input);
  else if (mode === 'check') check(input, root);
}

main();
