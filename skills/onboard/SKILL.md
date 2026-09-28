---
name: onboard
description: Prepara um repositório pro kirby. Lê o código, verifica os comandos rodando de verdade e gera um CLAUDE.md curto, o .claude/kirby-test (comando rápido de testes) e o .claude/kirby-protected (o que é régua e não pode ser afrouxado). Use quando o usuário pedir pra configurar, preparar ou fazer onboarding de um repo, gerar ou revisar o CLAUDE.md, ou invocar /kirby:onboard.
---

# onboard

Deixa um repo pronto pro kirby em três arquivos:

| Arquivo | Pra quê |
|---|---|
| `CLAUDE.md` | o que um agente precisa saber deste repo e não descobriria sozinho rápido |
| `.claude/kirby-test` | o comando que o hook de testes roda antes de o agente encerrar |
| `.claude/kirby-protected` | o que define "pronto" e não pode ser afrouxado |

Nada é commitado: o usuário revisa com `git diff` e decide.

## 1. Reconheça o repo

Leia, nesta ordem, o que existir: `CLAUDE.md`, `AGENTS.md`, `README`,
`CONTRIBUTING`, os manifestos (`package.json`, `pyproject.toml`, `mix.exs`,
`go.mod`, `Makefile`…), a configuração de CI (`.gitlab-ci.yml`,
`.github/workflows/`) e a árvore de diretórios até dois níveis. Depois, os
pontos de entrada e um ou dois módulos centrais.

O CI é a melhor fonte de verdade sobre como o projeto é testado de fato: o
README costuma estar desatualizado.

Anote:

- o que o repo é, numa frase
- comandos: instalar, rodar, testar, lint/format, typecheck, evals
- onde ficam: código principal, testes, evals/datasets, prompts, configs
- convenções que **diferem do padrão** da linguagem
- armadilhas: variáveis de ambiente obrigatórias, serviços que precisam estar de
  pé, arquivos gerados que não se editam à mão

## 2. Verifique os comandos rodando

Um comando no CLAUDE.md que não funciona é pior que nenhum: o agente confia nele.

- Rode os comandos de teste, lint e typecheck e anote o resultado e o tempo.
- **Não instale nem baixe nada** sem perguntar. Isso inclui os comandos de
  instalação (`npm install`/`ci`, `pnpm`/`yarn install`, `pip install`,
  `uv sync`, `poetry install`, `mix deps.get`, `bundle install`…) e os que
  baixam pacotes na hora (`npx`, `pnpm dlx`, `uvx`, `pipx run`) quando a
  ferramenta não está instalada no projeto. Pra saber se ela existe, olhe
  `node_modules/.bin/`, o virtualenv ou use `which`.
- Se um comando não roda por falta de dependência, registre-o como
  *não verificado*. Não suba serviços sem perguntar.
- Não rode nada que escreva fora do repo, faça deploy ou chame APIs externas.

## 3. Escolha o comando do `kirby-test`

O hook roda esse comando **toda vez** que o agente encerra uma resposta depois
de editar arquivos. Por isso ele precisa ser rápido: idealmente menos de 30s,
nunca mais de 2 minutos.

- Se a suíte completa é rápida, use ela.
- Se não é, procure um subconjunto rápido que o repo já ofereça (script
  `test:unit`, marcador do pytest, diretório de testes unitários) e verifique
  quanto ele leva.
- Se não há testes, não crie o arquivo e avise.

O arquivo tem uma linha só com o comando. Comentários com `#` são permitidos.

## 4. Decida o que é régua (`kirby-protected`)

Régua é o que decide se o trabalho está pronto. Se o agente pudesse mudar,
passaria "na marra". Candidatos, **só se existirem no repo**:

- datasets de eval, casos de regressão e gabaritos
- prompts de judge e configs de métrica ou threshold
- config de lint, format e typecheck (`.eslintrc*`, `ruff.toml`, `mypy.ini`…)
- config de CI

Não entram: os testes em si (a skill `task` já controla quais podem mudar),
snapshots que mudam legitimamente quando o comportamento muda, e código-fonte.
`pyproject.toml` também não entra, porque mistura dependências com config de
lint; mencione isso na entrega em vez de protegê-lo.

Datasets protegidos só crescem por **arquivos novos**: alterar um caso existente
fica bloqueado. Se o dataset é um arquivo único (ex.: um `.jsonl` grande),
avise que protegê-lo impede adicionar casos e sugira um arquivo por caso.

A sintaxe é a do `.gitignore`: `evals/datasets/` protege tudo dentro,
`ruff.toml` vale em qualquer profundidade.

## 5. Escreva o CLAUDE.md

Ele entra no contexto de **toda** sessão, então cada linha precisa se pagar.
Mire em no máximo 60 linhas.

```markdown
# <nome>

<o que é, numa frase>

## Comandos
- Testes (rápido): `<cmd>`
- Testes (completo): `<cmd>`
- Lint / format: `<cmd>`
- Evals: `<cmd>`
<marque com "(não verificado)" o que não rodou>

## Mapa
- `<dir>/`: <o que tem, em poucas palavras>
<só os 5–10 lugares que importam; não liste tudo>

## Convenções
- <só o que difere do padrão da linguagem, com um exemplo arquivo:linha>

## Não mexa
- <arquivos gerados, migrations já aplicadas, código vendorizado…>

## Armadilhas
- <env vars obrigatórias, serviços necessários, pegadinhas descobertas>
```

Fica de fora: conselho genérico ("escreva código limpo"), o que se descobre
lendo um arquivo, descrição longa de arquitetura e listas completas de arquivos.
Seção sem conteúdo real é removida, não preenchida com enrolação.

## 6. Grave sem atropelar

- **CLAUDE.md não existe:** crie. Se existe um `AGENTS.md` com o essencial,
  comece o CLAUDE.md com `@AGENTS.md` e escreva só o que falta, sem duplicar.
- **CLAUDE.md já existe:** não reescreva. Mostre as mudanças propostas
  (acréscimos e correções de comandos que não funcionam) e espere o usuário
  aprovar.
- **`kirby-test`:** crie ou atualize.
- **`kirby-protected` não existe:** crie.
- **`kirby-protected` já existe:** o hook bloqueia a edição, e é assim que deve
  ser. Mostre as linhas sugeridas pro usuário acrescentar.

## 7. Entregue

```markdown
**Criado/alterado:** <arquivos>
**Comandos verificados:** <comando → resultado, tempo>
**Não verificados:** <comando → por quê>
**Protegido:** <padrões e o motivo de cada um>
**Atenção:** <pendências: dataset em arquivo único, pyproject com lint, etc.>
```
