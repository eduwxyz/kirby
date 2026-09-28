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

## Skills

### `/kirby:task`: um fluxo pra toda mudança de código

Classifica a tarefa por **tipo** (`feature`, `change`, `fix`, `refactor`) e
**tamanho** (`trivial` → `large`). O tipo define o primeiro movimento; o
tamanho, quanta cerimônia roda. Duas paradas com você: aprovar o plano (a partir
de `standard`) e confirmar o commit.

| Tipo | Primeiro movimento | Testes existentes |
|---|---|---|
| `feature` | teste do comportamento novo | intocados |
| `change` | atualizar os testes do comportamento antigo | só os do comportamento que muda |
| `fix` | teste que falha reproduzindo o bug | intocados |
| `refactor` | confirmar tudo verde | intocados |

Antes de planejar, o agente ancora nos padrões do repo (nomes, erros, log, acesso
a dados, testes), com exemplo real `arquivo:linha`, ou diz que não existe.

### `/kirby:onboard`: prepara um repo

Rode uma vez por repo. Lê o código (CI primeiro: é a fonte de verdade sobre como
se testa), **roda os comandos pra verificar** e gera:

- `CLAUDE.md`: até ~60 linhas; comandos verificados, mapa, convenções que fogem
  do padrão, o que não mexer, armadilhas. Se já existe, propõe mudanças em vez de
  reescrever.
- `.claude/kirby-test`: o comando rápido que o `tests-green` roda (<30s de preferência).
- `.claude/kirby-protected`: a régua do repo (datasets, judges, thresholds, lint, CI).

Não instala nem baixa nada, não sobe serviços, não chama APIs externas e não commita.

### `/kirby:handoff`: salvar e retomar sessão

- **Salvar** (`/kirby:handoff`): grava `.claude/handoffs/AAAA-MM-DD-HHMM-<tarefa>.md` com
  objetivo, onde parou, o que funcionou (com evidência), o que **não** funcionou e por
  quê, o que falta tentar, decisões e o próximo passo. Um arquivo por handoff; o
  diretório entra no `.git/info/exclude` (ignore local, fora do repo).
- **Retomar** (`/kirby:handoff retomar`): lê o handoff como registro histórico, não
  como instrução; confere com o git o que mudou desde então; propõe o próximo passo
  e espera você confirmar.

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

### `block-destructive` — nada sem volta

Bloqueia no `Bash` o que não dá pra desfazer. Não precisa de configuração.

| Área | Bloqueia | Permite |
|---|---|---|
| git push | `-f`/`--force`/`+ref`, `--mirror`, `--no-verify`; force (mesmo com lease) ou delete em `main`, `master`, `develop`, `prod(uction)`, `release/*` | push normal; `--force-with-lease` em branch sua |
| git local | `reset --hard`, `checkout .`, `checkout -f`, `restore .`, `switch -f` **se houver mudança não commitada**; `clean -f`; `stash clear`; `commit/merge --no-verify` | tudo isso com a árvore limpa; `clean -n`; descartar um arquivo específico |
| rm | fora do projeto (exceto temporários), o projeto em si ou um diretório acima, `.git`, `rm -rf *` na raiz, alvo com variável indefinida | qualquer coisa dentro do projeto; `/tmp/...` |
| banco | `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE`/`UPDATE` sem `WHERE` (psql, mysql, sqlite3, duckdb, clickhouse) | consultas e escritas com `WHERE` |
| infra | `kubectl delete/drain`, `helm uninstall`, `terraform destroy`, `apply -auto-approve`, `state rm`, `aws … delete-*/terminate-*`, `aws s3 rm --recursive/rb`, `gcloud … delete`, `docker system prune`, `docker volume rm/prune` | leitura, `plan`, `apply` com revisão |
| HTTP | `curl -X DELETE` em host externo | `DELETE` em `localhost` |

- **Liberar:** `KIRBY_ALLOW_DESTRUCTIVE=1 claude`, ou você mesmo roda o comando.
- SQL passado por arquivo (`psql -f`) ou por stdin não é inspecionado.

## Desenvolvimento

```
npm test
```
