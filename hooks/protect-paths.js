#!/usr/bin/env node
// kirby · protect-paths
//
// PreToolUse hook. Protege os arquivos que definem o que é "pronto"
// (datasets de eval, prompts de judge, thresholds, config de lint): o agente
// pode criar arquivos novos ali, mas não alterar nem apagar os existentes.
//
// Lista por repo: <projeto>/.claude/kirby-protected, um glob por linha.
// Liberação: iniciar o Claude com KIRBY_ALLOW_PROTECTED=1.

'use strict';

const fs = require('fs');
const path = require('path');
const { parse, resolve } = require('./lib/shell');

const LIST_FILE = '.claude/kirby-protected';
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const IGNORE_CASE = process.platform === 'darwin' || process.platform === 'win32';

const OVERWRITERS = new Set(['rm', 'unlink', 'shred', 'truncate', 'tee']);
const IN_PLACE_EDITORS = new Set(['sed', 'gsed', 'perl', 'ruby']);
const COPIERS = new Set(['cp', 'install', 'ln', 'rsync']);
const GIT_WRITES = new Set(['checkout', 'restore', 'rm', 'mv', 'clean']);
const FIND_MUTATORS = new Set(['rm', 'unlink', 'shred', 'truncate', 'mv', 'sed', 'perl', 'tee']);

// ─── Padrões ────────────────────────────────────────────────────────────────

// Semântica de .gitignore: "dir/" protege tudo dentro; padrão sem "/" vale em
// qualquer profundidade; "/" no início ancora na raiz do projeto.
function compile(glob) {
  const anchored = glob.startsWith('/');
  let g = glob.replace(/^\/+/, '');
  if (g.endsWith('/')) g += '**';
  if (!anchored && !g.replace(/\/\*\*$/, '').includes('/')) g = '**/' + g;

  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  // Parte fixa antes do primeiro curinga: apagar um diretório que a contém
  // (ex.: `rm -rf evals`) também atinge os arquivos protegidos.
  const segments = g.split('/');
  const firstWild = segments.findIndex(s => /[*?]/.test(s));
  const prefix = segments.slice(0, firstWild === -1 ? undefined : firstWild).join('/');

  return { glob, regex: new RegExp(`^${re}$`, IGNORE_CASE ? 'i' : ''), prefix };
}

function loadPatterns(root) {
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(root, LIST_FILE), 'utf8').split('\n');
  } catch {
    // Sem lista: só a própria lista fica protegida.
  }
  const globs = lines.map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  return [LIST_FILE, ...globs].map(compile);
}

function matchPattern(rel, patterns) {
  const norm = s => (IGNORE_CASE ? s.toLowerCase() : s);
  for (const p of patterns) {
    if (p.regex.test(rel)) return p;
    const containsPrefix = rel === '' || norm(p.prefix).startsWith(norm(rel) + '/');
    if (p.prefix && containsPrefix) return p;
  }
  return null;
}

// ─── Alvos ──────────────────────────────────────────────────────────────────

function exists(abs) {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (err) {
    return err.code !== 'ENOENT'; // qualquer erro que não seja "não existe" conta como existente
  }
}

function isDirectory(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

// Retorna { rel, glob } se o alvo é protegido e já existe; criar arquivo novo é permitido.
function protectedHit({ token, cwd, shell }, root, patterns) {
  if (!token) return null;
  const abs = shell ? resolve(token, cwd) : path.resolve(cwd, token);
  if (abs === null) return null;
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const isGlob = shell && /[*?[]/.test(rel);
  const probe = isGlob ? rel.replace(/\[[^\]]*\]|[*?]+/g, 'x') : rel;
  // Um diretório é protegido se algo dentro dele casaria com a lista (ex.: `judges/**`).
  const hit = matchPattern(probe, patterns) ||
    (isDirectory(abs) && matchPattern(probe ? `${probe}/x` : 'x', patterns));
  if (!hit) return null;
  if (!isGlob && !exists(abs)) return null;
  return { rel, glob: hit.glob };
}

// Para cp/mv: se o destino é um diretório, o alvo real é destino/nome-da-origem.
function intoDestination(operands, cwd) {
  if (operands.length < 2) return [];
  const dest = operands.at(-1);
  const sources = operands.slice(0, -1);
  const destAbs = resolve(dest, cwd);
  return destAbs && isDirectory(destAbs) ? sources.map(s => path.join(dest, path.basename(s))) : [dest];
}

function commandTargets(cmd, args, cwd) {
  const operands = args.filter(a => a !== '' && !a.startsWith('-'));

  if (OVERWRITERS.has(cmd)) return operands;
  if (IN_PLACE_EDITORS.has(cmd)) {
    const inPlace = args.some(a => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'));
    return inPlace ? operands : [];
  }
  if (cmd === 'mv') return [...operands.slice(0, -1), ...intoDestination(operands, cwd)];
  if (COPIERS.has(cmd)) return intoDestination(operands, cwd);
  if (cmd === 'dd') return args.filter(a => a.startsWith('of=')).map(a => a.slice(3));
  if (cmd === 'git') return GIT_WRITES.has(operands[0]) ? operands.slice(1) : [];
  if (cmd === 'find') {
    const execAt = args.findIndex(a => a === '-exec' || a === '-execdir' || a === '-ok');
    const mutates = args.includes('-delete') || (execAt >= 0 && FIND_MUTATORS.has(path.basename(args[execAt + 1] ?? '')));
    if (!mutates) return [];
    const roots = [];
    for (const a of args) {
      if (a.startsWith('-') || a === '(' || a === '!') break;
      roots.push(a);
    }
    return roots;
  }
  return [];
}

function bashTargets(command, cwd) {
  const targets = [];
  for (const c of parse(command, cwd)) {
    for (const token of c.writes) targets.push({ token, cwd: c.cwd, shell: true });
    if (c.cmd) {
      for (const token of commandTargets(c.cmd, c.args, c.cwd)) targets.push({ token, cwd: c.cwd, shell: true });
    }
  }
  return targets;
}

// ─── Entrada ────────────────────────────────────────────────────────────────

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

function main() {
  if (process.env.KIRBY_ALLOW_PROTECTED === '1') process.exit(0);

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    block('kirby: entrada do hook ilegível; bloqueando por segurança.');
  }

  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  const cwd = input.cwd || process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR || cwd;
  const patterns = loadPatterns(root);

  let targets = [];
  if (EDIT_TOOLS.has(tool)) targets = [{ token: toolInput.file_path || toolInput.notebook_path, cwd, shell: false }];
  else if (tool === 'Bash') targets = bashTargets(toolInput.command ?? '', cwd);

  for (const target of targets) {
    const hit = protectedHit(target, root, patterns);
    if (!hit) continue;
    block(
      `kirby: \`${hit.rel}\` é protegido (regra \`${hit.glob}\` em ${LIST_FILE}).\n` +
      'Esse arquivo define o critério de "pronto": não mude a régua pra passar, corrija o código.\n' +
      'Criar arquivos novos ali é permitido. Se alterar este for legítimo, explique ao usuário o ' +
      'porquê; só ele pode liberar (KIRBY_ALLOW_PROTECTED=1).'
    );
  }
  process.exit(0);
}

main();
