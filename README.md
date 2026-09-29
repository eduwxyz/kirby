# kirby

Harness pessoal pro Claude Code. Como o Kirby: engole um problema e fica com a habilidade.

## Princípios

- **Cada peça entra por uma falha observada.** Nada é adicionado "por via das dúvidas".
- **O que precisa acontecer vira hook; o que deveria acontecer vira texto** (CLAUDE.md ou skill).
- **"Pronto" é um comando que responde sim/não** — teste ou eval, nunca "parece certo".
- **Regra de evolução:** corrigiu o agente 2x na mesma coisa → vira linha no CLAUDE.md. Ignorou a linha → vira hook.

## Instalação

Uma vez por máquina:

```
/plugin marketplace add eduwxyz/kirby
/plugin install kirby@kirby
```

O repo é privado: o git da máquina precisa ter acesso a ele. Pra desenvolver o
próprio kirby, use o caminho local (`/plugin marketplace add ~/Documents/projects/kirby`)
ou carregue direto da pasta com `claude --plugin-dir ~/Documents/projects/kirby`.

Pra atualizar: `claude plugin update kirby@kirby`.

## Como usar

### Uma vez por repo

1. Abra o Claude na **raiz** do repo (os hooks leem a configuração de lá).
2. Rode `/kirby:onboard`. Ele gera `CLAUDE.md`, `.claude/kirby-test` e `.claude/kirby-protected`.
3. Revise com `git diff`:
   - **A régua está certa?** Protege o que diz se o trabalho está bom (datasets
     rotulados, thresholds, lint, CI), não o que está sendo desenvolvido. Num repo
     de judge, os prompts dos judges são o produto; a régua são os exemplos
     rotulados.
   - **O teste é rápido?** Roda em toda resposta com edição: idealmente < 30s.
   - **O CLAUDE.md diz algo que o agente não descobriria sozinho?** Corte o genérico.
4. Decida o que vai pro repo do time: o `CLAUDE.md` vale commitar; os arquivos
   `kirby-*` só servem a quem usa o kirby. Pra deixá-los locais, acrescente
   `.claude/kirby-*` no `.git/info/exclude`.

### Toda tarefa

1. Abra a sessão na raiz do repo. Continuação? `/kirby:handoff retomar`.
2. Peça a mudança normalmente; a skill `task` entra sozinha (ou `/kirby:task <pedido>`).
3. Confira a classificação na primeira linha (ex.: `change · standard`); discorde na hora se for o caso.
4. **Parada 1, plano** (`standard`/`large`): olhe os padrões citados e o "como vamos saber que está pronto".
5. Implementação: os hooks vigiam sozinhos. Se um bloquear algo legítimo, rode
   você mesmo ou abra o Claude com `KIRBY_ALLOW_PROTECTED=1` /
   `KIRBY_ALLOW_DESTRUCTIVE=1` (vale pra sessão inteira; use só pra aquilo).
6. **Parada 2, entrega:** leia o "Verificado" e o "Ficou de fora"; confirme o commit.
7. Push e MR são com você: o kirby nunca faz push.

### Fim de sessão

- Tarefa não terminou → `/kirby:handoff`.
- Corrigiu o agente ou algo custou caro pra descobrir → `/kirby:learn`.

### De vez em quando

- `CLAUDE.md` passou de ~60 linhas → enxugue.
- Repo mudou bastante → `/kirby:onboard` de novo (com CLAUDE.md existente, ele propõe mudanças em vez de reescrever).
- O `learn` apontou problema no próprio kirby → vira uma `task` no repo do kirby.

### Cola

| Momento | Comando |
|---|---|
| Repo novo | `/kirby:onboard` |
| Começar ou continuar | `/kirby:handoff retomar` |
| Trabalhar | peça normalmente (ou `/kirby:task`) |
| Parar no meio | `/kirby:handoff` |
| Aprendeu algo | `/kirby:learn` |

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

### `/kirby:learn`: lição vira melhoria permanente

Garimpa a sessão (correções suas, erros que custaram, fatos não óbvios, regra
ignorada), filtra (muda comportamento? não é óbvio? não está escrito?) e propõe
cada lição com evidência e destino, no degrau mais leve que resolve:

`CLAUDE.md` do repo → instruções globais → skill nova → hook (só se o texto já falhou) → o próprio kirby.

Grava só o que você aprovar; skill, hook ou mudança no kirby viram um `/kirby:task` à parte.

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
