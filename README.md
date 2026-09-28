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

## Desenvolvimento

```
npm test
```
