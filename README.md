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

## Hooks

### `protect-paths` — não mexa na régua

O atalho mais curto pra uma eval passar é mudar o gabarito ou o juiz. Este hook
bloqueia alterar ou apagar arquivos que definem o que é "pronto"; **criar**
arquivos novos ali continua permitido.

Cada repo declara o que é régua em `.claude/kirby-protected`, com a semântica
do `.gitignore`:

```gitignore
# datasets de eval: um arquivo por caso, só cresce
evals/datasets/
# prompts dos juízes
judges/**
# vale em qualquer profundidade
thresholds.yaml
.eslintrc.json
```

- Vigia `Write`, `Edit`, `MultiEdit`, `NotebookEdit` e comandos de escrita no
  `Bash` (`>`/`>>`, `sed -i`, `rm`, `mv`, `cp`, `tee`, `git checkout/restore`,
  `find -delete`, `bash -c`…).
- A própria lista é sempre protegida.
- **Datasets append-only:** guarde um caso por arquivo. Adicionar caso = criar
  arquivo (permitido); mudar caso existente = bloqueado.
- **Liberar:** inicie o Claude com `KIRBY_ALLOW_PROTECTED=1 claude`. O agente não
  consegue setar isso pro hook.

É um quebra-molas, não um cofre: um script Python que abre o arquivo pra escrita
passa. A garantia final é o review do MR.

### `tests-green` — não encerra com teste vermelho

Se a sessão editou arquivos, o agente só consegue encerrar a resposta com os
testes passando. Falhou → a resposta é bloqueada e a saída da suíte volta pro
agente corrigir. Depois de 3 bloqueios seguidos, libera e avisa você (sem loop
infinito).

**Só cobra o que a sessão quebrou.** Antes da primeira edição, o hook roda a
suíte uma vez e anota se ela já estava vermelha. Se estava, ele não bloqueia no
fim, só avisa você; senão o agente sairia consertando o que ninguém pediu. Custo:
uma rodada da suíte rápida por sessão, na primeira edição.

**Qual comando roda:** primeira linha de `.claude/kirby-test`, se existir;
senão, detecção automática nesta ordem: alvo `test` no `Makefile`, script
`test` do `package.json` (npm/pnpm/yarn/bun), `pytest` (via uv/poetry se
houver lock), `mix test`, `go test ./...`, `cargo test`.

```bash
node hooks/tests-green.js detect   # mostra o comando que seria usado aqui
```

- Suíte lenta? Aponte um subconjunto rápido: `echo "pytest -q -m fast" > .claude/kirby-test`.
- Pra desligar num repo: `echo off > .claude/kirby-test`.
- Timeout de 540s (`KIRBY_TEST_TIMEOUT`); estourou → libera e avisa.
- Edições feitas só via `Bash` (ex.: `sed -i`) não marcam a sessão.

## Desenvolvimento

```
npm test
```
