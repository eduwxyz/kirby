---
name: task
description: Fluxo único pra qualquer mudança de código (feature nova, mudança de comportamento, bug, refatoração), com cerimônia proporcional ao tamanho e dois pontos de parada com o usuário (plano e commit). Use quando o usuário pedir pra implementar, adicionar, mudar, corrigir, consertar ou refatorar algo no código, ou invocar /kirby:task.
---

# task

Um fluxo só pra toda mudança de código. O que muda de uma tarefa pra outra é o
**primeiro movimento** (definido pelo tipo) e **quanta cerimônia** roda
(definida pelo tamanho). Tarefa pequena não passa por burocracia; tarefa grande
não pula o plano.

## 1. Classifique

Antes de qualquer coisa, decida o **tipo** e o **tamanho** e declare numa linha:

> **Tarefa:** fix · small — o bug está numa função só e a causa é clara. Me corrija se discordar.

Não espere resposta pra seguir; o usuário interrompe se discordar.

**Tipo**

| Tipo | Quando |
|---|---|
| `feature` | a capacidade ainda não existe |
| `change` | funciona, mas o comportamento desejado agora é outro |
| `fix` | está quebrado: o comportamento atual é um erro |
| `refactor` | o comportamento fica igual; só a estrutura melhora |

`change` e `fix` se confundem: se o comportamento atual era o combinado e agora
querem outro, é `change`. Se nunca deveria ter sido assim, é `fix`.

**Tamanho**: use o sinal mais alto entre os três.

| Tamanho | Arquivos | Contrato / dependência | Decisão de design |
|---|---|---|---|
| `trivial` | 1, poucas linhas | nenhum | nenhuma, é óbvio |
| `small` | 1 arquivo ou função | nenhum | clara depois de ler o código |
| `standard` | 2–5 | talvez um módulo interno novo | uma escolha real |
| `large` | muitos, transversal | dependência externa nova, API pública, contrato entre times | várias perguntas abertas |

Mexer em autenticação/autorização, entrada de usuário, query de banco, caminho
de arquivo vindo de fora, chamada a API externa, criptografia ou segredos torna
a tarefa **no mínimo `standard`** e liga a revisão de segurança (passo 5).

Se no meio do caminho a tarefa se mostrar maior do que você classificou, pare,
diga isso e reclassifique. Não siga como `small` uma tarefa que virou `standard`.

## 2. Entenda (`small` pra cima)

Leia o caminho do código que será tocado antes de propor qualquer coisa. Num
`fix`, reproduza o problema: rode o comando, o teste ou o trecho que mostra o
erro acontecendo.

**Ancore nos padrões do repo.** Pra cada item abaixo que a tarefa toca, ache um
exemplo real no código e siga ele:

- nomes (arquivos, funções, tipos)
- tratamento de erro
- log
- acesso a dados
- testes: onde ficam, framework, fixtures, estilo de assert

Se não existe exemplo, diga isso explicitamente. Nunca invente um padrão e
apresente como se fosse do repo.

## 3. Planeje (`standard` e `large`) → primeira parada

Apresente o plano e **espere aprovação antes de escrever código de
implementação**:

```markdown
**Objetivo:** <uma frase>
**Padrões a seguir:** <item → arquivo:linha do exemplo>
**Arquivos:** <o que muda em cada um>
**Fatias:** <passos em ordem; cada um deixa o sistema funcionando>
**Como vamos saber que está pronto:** <comando(s) de teste/eval que precisam passar>
**Riscos:** <o que pode dar errado e como evitar>
```

Fatias finas: cada uma entrega um pedaço de ponta a ponta que funciona, em vez
de "primeiro todos os modelos, depois todas as rotas".

`trivial` e `small` não param aqui: sigam direto pro passo 4.

## 4. Implemente

**O primeiro movimento depende do tipo:**

| Tipo | Primeiro movimento | O que pode acontecer com os testes existentes |
|---|---|---|
| `feature` | um teste pro comportamento novo, depois o código | nada: só se adicionam testes |
| `change` | atualizar os testes que descrevem o comportamento antigo, depois o código | mudam **só** os que descrevem o comportamento que está mudando; liste quais |
| `fix` | um teste que **falha** reproduzindo o bug; confirme que falha pelo motivo certo; depois corrija até passar | nada: só se adiciona o teste de regressão |
| `refactor` | rodar os testes e confirmar que estão verdes | nada: nenhum teste muda |

A última coluna é a regra mais importante do fluxo. Se pra terminar você
precisar mexer num teste existente fora do que ela permite, **pare e explique**:
ou a tarefa foi mal classificada, ou o teste está pegando um problema real.
Afrouxar teste pra passar nunca é a saída.

Durante a implementação:

- Rode os testes ao fim de cada fatia, não só no final.
- Siga os padrões encontrados no passo 2.
- Se a mesma falha resistir a 3 tentativas de correção, pare e relate o que
  tentou e o que observou. Não fique rodando em círculo.

## 5. Revise

1. Sempre, inclusive em `trivial`: releia o diff inteiro contra o plano (ou
   contra o pedido, se não houve plano). Sobrou algo não pedido? Faltou algo?
2. De `small` pra cima: rode o `/code-review` num contexto limpo. Resolva os achados graves antes de
   seguir; os menores, liste na entrega.
3. Se a tarefa tocou um gatilho de segurança (passo 1), rode também o
   `/security-review`.
4. Em `large`, ofereça uma segunda opinião adversarial de outro modelo (ex.:
   Codex), se estiver disponível.

## 6. Entregue → segunda parada

Apresente e **espere confirmação antes de commitar**:

```markdown
**Feito:** <o que mudou, em 1–3 linhas>
**Verificado:** <comando rodado → resultado>
**Ficou de fora / pendências:** <ou "nada">
**Commit proposto:** `<tipo>: <descrição>`
```

Use o tipo do commit coerente com a tarefa (`feat`, `fix`, `refactor`, `test`,
`docs`, `chore`) e um commit por mudança lógica. Nunca faça push sem o usuário
pedir.
