#!/usr/bin/env node
// kirby · block-destructive
//
// PreToolUse hook em Bash. Bloqueia o que não tem volta: apagar fora do
// projeto, descartar trabalho não commitado, reescrever histórico remoto,
// pular os hooks do git e operações destrutivas em banco e infra.
//
// Liberação: iniciar o Claude com KIRBY_ALLOW_DESTRUCTIVE=1, ou o usuário
// roda o comando ele mesmo.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse, resolve } = require('./lib/shell');

const PROTECTED_BRANCH = /^(main|master|develop|production|prod|release\/.+)$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'duckdb', 'clickhouse', 'clickhouse-client']);

const realpath = p => { try { return fs.realpathSync(p); } catch { return p; } };
const TMP_DIRS = [...new Set(
  [os.tmpdir(), '/tmp', '/var/folders'].flatMap(p => [p, realpath(p)])
)];

// ─── Utilidades ─────────────────────────────────────────────────────────────

const shortFlag = (args, letter) => args.some(a => /^-[A-Za-z]+$/.test(a) && a.includes(letter));
const operandsOf = args => args.filter(a => a !== '' && !a.startsWith('-'));

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Há mudanças em arquivos rastreados que um reset/checkout jogaria fora?
const hasUncommitted = cwd => !!git(cwd, 'status', '--porcelain', '--untracked-files=no');

// ─── git ────────────────────────────────────────────────────────────────────

// Pula as opções globais (`git -C dir -c k=v push ...`) até o subcomando.
function gitSubcommand(args, cwd) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') { cwd = resolve(args[i + 1] ?? '.', cwd) ?? cwd; i += 2; }
    else if (args[i] === '-c') i += 2;
    else i += 1;
  }
  return { sub: args[i], rest: args.slice(i + 1), cwd };
}

function checkPush(rest, cwd) {
  if (rest.includes('--no-verify')) return 'pular os hooks do git (--no-verify)';
  if (rest.includes('--mirror')) return 'git push --mirror sobrescreve o remoto inteiro';

  const refspecs = operandsOf(rest).slice(1); // o primeiro operando é o remoto
  const plainForce = rest.includes('--force') || shortFlag(rest, 'f') || refspecs.some(r => r.startsWith('+'));
  if (plainForce) return 'force push sem lease reescreve o histórico remoto (use --force-with-lease)';

  const branches = refspecs.length
    ? refspecs.map(r => r.split(':').pop().replace(/^refs\/heads\//, ''))
    : [git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD') ?? ''];
  const target = branches.find(b => PROTECTED_BRANCH.test(b));
  if (!target) return null;

  if (rest.some(a => a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes'))) {
    return `force push na branch protegida \`${target}\``;
  }
  if (rest.includes('--delete') || shortFlag(rest, 'd') || refspecs.some(r => r.startsWith(':'))) {
    return `apagar a branch protegida \`${target}\` no remoto`;
  }
  return null;
}

function checkGit(args, cwd) {
  const { sub, rest, cwd: dir } = gitSubcommand(args, cwd);
  const operands = operandsOf(rest);
  const discards = what => (hasUncommitted(dir) ? `${what} descarta mudanças não commitadas` : null);

  switch (sub) {
    case 'push':
      return checkPush(rest, dir);
    case 'reset':
      return rest.includes('--hard') ? discards('git reset --hard') : null;
    case 'checkout':
    case 'restore': {
      const onlyStaged = sub === 'restore' && (rest.includes('--staged') || shortFlag(rest, 'S')) &&
        !(rest.includes('--worktree') || shortFlag(rest, 'W'));
      const everything = operands.some(o => ['.', ':/', '*'].includes(o));
      const force = sub === 'checkout' && (rest.includes('--force') || shortFlag(rest, 'f'));
      return !onlyStaged && (everything || force) ? discards(`git ${sub} ${everything ? '.' : '-f'}`) : null;
    }
    case 'switch':
      return rest.includes('--discard-changes') || rest.includes('--force') || shortFlag(rest, 'f')
        ? discards('git switch -f') : null;
    case 'clean': {
      const force = rest.includes('--force') || shortFlag(rest, 'f');
      const dryRun = rest.includes('--dry-run') || shortFlag(rest, 'n');
      return force && !dryRun ? 'git clean -f apaga arquivos não rastreados' : null;
    }
    case 'stash':
      return operands[0] === 'clear' ? 'git stash clear apaga todos os stashes' : null;
    case 'commit':
    case 'merge':
      return rest.includes('--no-verify') || (sub === 'commit' && shortFlag(rest, 'n'))
        ? 'pular os hooks do git (--no-verify)' : null;
    default:
      return null;
  }
}

// ─── rm ─────────────────────────────────────────────────────────────────────

// rm só dentro do projeto (nunca o projeto em si nem o .git) ou em diretório temporário.
function checkRm(args, cwd, root) {
  const recursive = args.includes('--recursive') || shortFlag(args, 'r') || shortFlag(args, 'R');

  for (const op of operandsOf(args)) {
    const abs = resolve(op, cwd);
    if (abs === null) return `rm com alvo que não dá pra resolver (\`${op}\`)`;

    const parts = abs.split(path.sep);
    const wild = parts.findIndex(p => /[*?[]/.test(p));
    const target = wild === -1 ? abs : parts.slice(0, wild).join(path.sep) || path.sep;

    if (target === root || isInside(root, target)) {
      if (wild !== -1 && target === root && !recursive) continue; // `rm *.log` na raiz: só arquivos
      return `rm \`${op}\` apagaria o projeto inteiro`;
    }
    if (isInside(target, root)) {
      if (path.relative(root, target).split(path.sep).includes('.git')) return `rm \`${op}\` apaga o histórico do git`;
      continue;
    }
    if (TMP_DIRS.some(tmp => isInside(target, tmp))) continue;
    return `rm \`${op}\` está fora do projeto`;
  }
  return null;
}

// ─── Banco e infra ──────────────────────────────────────────────────────────

function checkSql(args) {
  const text = args.join(' ');
  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i.test(text)) return 'DROP em banco de dados';
  if (/\bTRUNCATE\b/i.test(text)) return 'TRUNCATE em banco de dados';
  for (const statement of text.split(';')) {
    const massive = /\b(DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b/i.test(statement) && !/\bWHERE\b/i.test(statement);
    if (massive) return 'DELETE/UPDATE sem WHERE';
  }
  return null;
}

function checkCurl(args) {
  let method = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--request') method = args[i + 1];
    else if (a.startsWith('--request=')) method = a.slice('--request='.length);
    else if (/^-X\w+$/.test(a)) method = a.slice(2);
  }
  if (method?.toUpperCase() !== 'DELETE') return null;

  let host = '';
  try {
    host = new URL(args.find(a => /^https?:\/\//.test(a))).hostname;
  } catch {
    // sem URL legível: trata como externo
  }
  return LOCAL_HOSTS.has(host) ? null : `DELETE em \`${host || 'host externo'}\``;
}

function checkInfra(cmd, args) {
  const ops = operandsOf(args);
  const has = (...words) => words.some(w => ops.includes(w));

  if (cmd === 'kubectl' && has('delete', 'drain')) return `kubectl ${ops.find(o => o === 'delete' || o === 'drain')}`;
  if (cmd === 'helm' && has('uninstall', 'delete')) return 'helm uninstall';
  if (cmd === 'terraform' || cmd === 'tofu') {
    if (ops[0] === 'destroy') return `${cmd} destroy`;
    if (ops[0] === 'apply' && args.some(a => /^--?auto-approve/.test(a))) return `${cmd} apply sem revisão (-auto-approve)`;
    if (ops[0] === 'state' && ops[1] === 'rm') return `${cmd} state rm`;
  }
  if (cmd === 'aws') {
    if (ops[0] === 's3' && (ops[1] === 'rb' || (ops[1] === 'rm' && args.includes('--recursive')))) return `aws s3 ${ops[1]}`;
    const op = ops.find(o => /^(delete|terminate)-/.test(o));
    if (op) return `aws ${ops[0]} ${op}`;
  }
  if (cmd === 'gcloud' && has('delete')) return 'gcloud delete';
  if (cmd === 'gsutil' && (ops[0] === 'rb' || (ops[0] === 'rm' && (shortFlag(args, 'r') || shortFlag(args, 'R'))))) return `gsutil ${ops[0]}`;
  if (cmd === 'docker') {
    if (ops[0] === 'system' && ops[1] === 'prune') return 'docker system prune';
    if (ops[0] === 'volume' && (ops[1] === 'rm' || ops[1] === 'prune')) return `docker volume ${ops[1]}`;
  }
  return null;
}

// ─── Entrada ────────────────────────────────────────────────────────────────

function check({ cmd, args, cwd }, root) {
  if (cmd === 'git') return checkGit(args, cwd);
  if (cmd === 'rm') return checkRm(args, cwd, root);
  if (cmd === 'curl') return checkCurl(args);
  if (SQL_CLIENTS.has(cmd)) return checkSql(args);
  return checkInfra(cmd, args);
}

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

function main() {
  if (process.env.KIRBY_ALLOW_DESTRUCTIVE === '1') process.exit(0);

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    block('kirby: entrada do hook ilegível; bloqueando por segurança.');
  }
  if (input.tool_name !== 'Bash') process.exit(0);

  const cwd = input.cwd || process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR || cwd;

  for (const command of parse(input.tool_input?.command ?? '', cwd)) {
    if (!command.cmd) continue;
    const reason = check(command, root);
    if (!reason) continue;
    block(
      `kirby: comando bloqueado: ${reason}.\n` +
      'Isso não tem volta. Procure um caminho reversível; se for mesmo necessário, explique ao ' +
      'usuário e peça pra ele rodar o comando (ou liberar com KIRBY_ALLOW_DESTRUCTIVE=1).'
    );
  }
  process.exit(0);
}

main();
