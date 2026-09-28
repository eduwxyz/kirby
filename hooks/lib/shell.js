// kirby · leitura mínima de comandos bash, compartilhada pelos hooks.
//
// Não é um parser de shell completo: cobre aspas, escapes, separadores
// (; && || | & e quebra de linha), redirecionamentos, subshells, `cd` e
// `bash -c "..."`. O suficiente pra enxergar o que um comando vai tocar.

'use strict';

const os = require('os');
const path = require('path');

const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nice', 'nohup', 'time']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

// Quebra o comando em segmentos; cada token é { word } ou { op } (redirecionamento).
// Subshells `$(...)` e crases viram segmentos próprios.
function lex(src) {
  const segments = [[]];
  let word = null;
  let quote = null;
  const pushWord = () => {
    if (word !== null) segments.at(-1).push({ word });
    word = null;
  };
  const split = () => {
    pushWord();
    if (segments.at(-1).length) segments.push([]);
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < src.length) word += src[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word = word ?? '';
    } else if (c === '\\' && i + 1 < src.length) {
      word = (word ?? '') + src[++i];
    } else if (c === '>' || c === '<' || (c === '&' && src[i + 1] === '>')) {
      let op = '';
      if (word !== null && /^\d+$/.test(word)) { op = word; word = null; } else pushWord();
      if (c === '&') { op += '&'; i++; }
      op += src[i];
      while ('>|&'.includes(src[i + 1] ?? 'x')) op += src[++i];
      segments.at(-1).push({ op });
    } else if ('\n;|&()`'.includes(c)) {
      split();
    } else if (/\s/.test(c)) {
      pushWord();
    } else {
      word = (word ?? '') + c;
    }
  }
  pushWord();
  return segments.filter(s => s.length);
}

// Lista os comandos simples: { cmd, args, writes, cwd }.
// `writes` são os alvos de redirecionamento de saída; `cwd` acompanha os `cd`.
function parse(command, startCwd) {
  const commands = [];
  let cwd = startCwd;

  for (const segment of lex(command)) {
    const words = [];
    const writes = [];
    for (let i = 0; i < segment.length; i++) {
      const t = segment[i];
      if (t.op === undefined) {
        words.push(t.word);
        continue;
      }
      const next = segment[i + 1];
      if (next?.word === undefined) continue;
      i++;
      if (t.op.includes('>') && !t.op.endsWith('&')) writes.push(next.word); // `>&2` duplica fd, não é arquivo
    }

    while (words.length && (/^[A-Za-z_]\w*=/.test(words[0]) || WRAPPERS.has(words[0]))) words.shift();
    const cmd = words.length ? path.basename(words[0]) : null;
    const args = words.slice(1);

    if (cmd === 'cd') {
      if (!args[0]) cwd = os.homedir();
      else if (args[0] !== '-') cwd = resolve(args[0], cwd) ?? cwd;
      continue;
    }
    if (cmd && SHELLS.has(cmd)) {
      const flag = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a));
      if (flag >= 0 && args[flag + 1]) commands.push(...parse(args[flag + 1], cwd));
      if (writes.length) commands.push({ cmd: null, args: [], writes, cwd });
      continue;
    }
    commands.push({ cmd, args, writes, cwd });
  }
  return commands;
}

// Expande $VAR e ${VAR} com o ambiente atual; null se algo não dá pra resolver.
function expand(token, env = process.env) {
  let unresolved = false;
  const out = token.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced, bare) => {
    const value = env[braced || bare];
    if (value === undefined) unresolved = true;
    return value ?? '';
  });
  return unresolved || out.includes('$') ? null : out;
}

// Caminho absoluto de um token (com ~ e variáveis); null se não dá pra saber.
function resolve(token, cwd) {
  const expanded = expand(token);
  if (expanded === null) return null;
  const withHome = expanded === '~' || expanded.startsWith('~/')
    ? path.join(os.homedir(), expanded.slice(1))
    : expanded;
  return path.resolve(cwd, withHome);
}

module.exports = { lex, parse, expand, resolve };
