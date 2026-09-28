---
name: learn
description: Transforma o que a sessão ensinou em melhoria permanente. Extrai lições com evidência (correções do usuário, erros que custaram a resolver, fatos não óbvios do repo) e propõe onde cada uma deve morar, seja no CLAUDE.md do repo, nas instruções globais, numa skill nova, num hook ou no próprio kirby. Use quando o usuário pedir pra aprender com a sessão, registrar uma lição, "não errar mais nisso", ou invocar /kirby:learn.
---

# learn

Handoff guarda *estado* (onde a tarefa parou). Learn guarda *lições*: o que
deveria mudar o comportamento de qualquer sessão futura. É como o harness
evolui: cada lição vai pro lugar mais leve que resolve.

## 1. Garimpe a sessão

Procure momentos concretos:

- **Correções do usuário:** "não, faz assim", "já falei que…", uma mudança
  desfeita por ele.
- **Erros que custaram a resolver:** várias tentativas até achar a causa.
- **Fatos não óbvios do repo:** comando que não funciona como parece,
  dependência escondida, convenção que ninguém escreveu.
- **Atrito repetido:** o mesmo procedimento de vários passos feito à mão mais
  de uma vez.
- **Regra escrita e ignorada:** algo que já estava no CLAUDE.md ou numa skill e
  mesmo assim não foi seguido.

## 2. Filtre sem dó

Uma lição só passa se responder "sim" às três perguntas:

1. **Muda o comportamento** numa sessão futura?
2. **Não se descobre** lendo um arquivo em poucos segundos?
3. **Não está escrita** em lugar nenhum ainda (CLAUDE.md, skill, README)?

Conselho genérico ("testar antes de commitar", "ler o código com atenção") não
passa. **Zero lições é um resultado válido**: diga isso em vez de inventar.
Mais de 5 é sinal de que você não filtrou.

## 3. Escolha onde cada lição mora

Suba um degrau só quando o de baixo não resolve:

| Destino | Quando |
|---|---|
| `CLAUDE.md` do repo | fato ou convenção deste repo |
| Instruções globais (`~/.claude/CLAUDE.md`) | preferência do usuário que vale em qualquer repo |
| Skill nova | procedimento de vários passos que se repete |
| Hook | regra que **já estava escrita e foi ignorada**: texto não bastou, precisa de garantia |
| O próprio kirby | falha de um fluxo do kirby (skill ambígua, hook que bloqueou errado ou deixou passar) |

A regra do hook é estrita: só proponha hook com evidência de que o texto
falhou. Primeira ocorrência vira texto, nunca hook.

## 4. Proponha e espere

Apresente cada lição assim e **espere aprovação antes de gravar qualquer
coisa**:

```markdown
### <lição em uma frase>
**Evidência:** <o momento da sessão: o que aconteceu, com citação curta>
**Destino:** <arquivo, e a seção dentro dele>
**Texto:** <a linha exata a acrescentar ou a mudança exata>
```

Pra skill, hook ou mudança no kirby: descreva o que faria e por quê. Não
implemente dentro do learn; isso é uma tarefa própria (`/kirby:task`).

## 5. Grave o que foi aprovado

- Aplique só o texto aprovado, do jeito aprovado.
- **Prefira editar uma linha existente a acrescentar outra.** Se a lição corrige
  ou refina algo que já está escrito, mude aquela linha.
- O CLAUDE.md do repo deve ficar em torno de 60 linhas. Se a lição passar disso,
  proponha junto o que enxugar ou juntar.
- Não commite.
