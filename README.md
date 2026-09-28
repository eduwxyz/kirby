# kirby

Harness pessoal pro Claude Code. Como o Kirby: engole um problema e fica com a habilidade.

## Princípios

- **Cada peça entra por uma falha observada.** Nada é adicionado "por via das dúvidas".
- **O que precisa acontecer vira hook; o que deveria acontecer vira texto** (CLAUDE.md ou skill).
- **"Pronto" é um comando que responde sim/não** — teste ou eval, nunca "parece certo".
- **Regra de evolução:** corrigiu o agente 2x na mesma coisa → vira linha no CLAUDE.md. Ignorou a linha → vira hook.

## Instalação

```
/plugin marketplace add ~/Documents/projects/kirby
/plugin install kirby@kirby
```

## Desenvolvimento

```
npm test
```
