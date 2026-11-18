# Design — ontarget

Especificação de design (design system + UX) do ontarget.
Complementa `docs/PRD.md` (o *quê*) e `docs/architecture.md` (o *como*).

- Versão: 0.1
- Princípios: **Precisão** (números alinhados, nada saltitante), **Calma** (o conteúdo manda, a UI não compete), **Feedback imediato** (toda ação tem resposta visual), **Continuidade** (nunca perder seleção/scroll durante edição).

---

## 1. Direção visual

Estudo de caso: MS Project 2010 (densidade e hierarquia) + painéis modernos de ferramentas de engenharia (Linear, Figma, Raycast).

| Característica | Decisão |
| --- | --- |
| Superfície | Clara e escura, ambas de primeira classe; troca instantânea sem reload |
| Grid | Linhas finas de 1px, zebra sutil, cabeçalho sticky com fundo translúcido (`backdrop-filter`) |
| Tipografia | Sans-serif variável para UI + fonte monoespaçada com algarismos tabulares para datas e números |
| Densidade | Três alturas de linha: compacta (24px), confortável (28px), ampla (34px) |
| Raio | 6px (controles) / 10px (cards) / 999px (pills) |
| Movimento | 120–180 ms, `cubic-bezier(.2,.8,.2,1)`; tudo desativável por `prefers-reduced-motion` |
| Cor | Um acento único + paleta semântica; cores de barra do Gantt em sistema próprio |

---

## 2. Design tokens

### 2.1 Cor — modo claro

```
--bg-canvas:        #f7f8fa   /* fundo da aplicação */
--bg-surface:       #ffffff   /* painéis, grade */
--bg-surface-2:     #f1f3f6   /* cabeçalhos, zebra */
--bg-hover:         rgba(15,23,42,.05)
--bg-active:        rgba(15,23,42,.09)

--fg-default:       #0f172a
--fg-muted:         #5b6577
--fg-subtle:        #94a0b4

--border-default:   #e3e7ee
--border-strong:    #cdd4e0

--accent:           #4f46e5   /* indigo — foco, seleção primária */
--accent-soft:      rgba(79,70,229,.12)
--accent-fg:        #ffffff

--success:          #16a34a
--warning:          #d97706
--danger:           #dc2626
--info:             #0284c7
```

### 2.2 Cor — modo escuro

```
--bg-canvas:        #0b0e14
--bg-surface:       #12161f
--bg-surface-2:     #171c27
--bg-hover:         rgba(255,255,255,.05)
--bg-active:        rgba(255,255,255,.09)
--fg-default:       #e6e9ef
--fg-muted:         #98a2b4
--fg-subtle:        #667085
--border-default:   #232936
--border-strong:    #333b4d
--accent:           #6366f1
--accent-soft:      rgba(99,102,241,.18)
```

### 2.3 Escala tipográfica

| Token | Valor | Uso |
| --- | --- | --- |
| `--text-xs` | 11px / 1.4 | rótulos, cabeçalhos de coluna |
| `--text-sm` | 12.5px / 1.45 | corpo da grade (densidade compacta) |
| `--text-md` | 13.5px / 1.5 | corpo padrão |
| `--text-lg` | 15px / 1.5 | painéis de detalhe |
| `--text-xl` | 19px / 1.3 | títulos de página |
| `--mono` | JetBrains Mono / ui-monospace | datas, durações, custos, WBS |

Regra: **todo valor numérico usa `font-variant-numeric: tabular-nums`** para manter colunas alinhadas durante edição.

### 2.4 Espaçamento, sombra, raio

```
--sp-1..--sp-8:  4 8 12 16 20 24 32 40  (px)
--radius-sm: 6px  --radius-md: 10px  --radius-lg: 14px
--shadow-1: 0 1px 2px rgba(15,23,42,.06)
--shadow-2: 0 6px 16px -6px rgba(15,23,42,.14)
--shadow-3: 0 16px 40px -12px rgba(15,23,42,.22)
```

---

## 3. Shell da aplicação

```
┌──────────────────────────────────────────────────────────────────────┐
│  A  Barra de aplicação: projeto atual · undo/redo · tema · zoom     │
├──────────────────────────────────────────────────────────────────────┤
│  B  Barra de comandos (ribbon moderna): Tarefa | Recurso | Projeto | │
│     Ver | Formatar — grupos com ícone + rótulo, contexto por visão  │
├──────────────────────────────────────────────────────────────────────┤
│  C  Timeline (linha do tempo) — altura 64px, ocultável              │
├───────────────────────────────────┬──────────────────────────────────┤
│  D  Task Sheet (outline/WBS)      │  E  Gantt Chart                 │
│      colunas configuráveis        │      barras, links, escala      │
│      largura redimensionável      │      ↔ sincronizado com D       │
├───────────────────────────────────┴──────────────────────────────────┤
│  F  Painel de detalhes (Task Form / Resource Form) — redimensionável│
├──────────────────────────────────────────────────────────────────────┤
│  G  Barra de status: modo de agendamento · zoom · seleção · salvar  │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Barra de aplicação (A)

- Esquerda: botão **Portfólio** (grid), seletor de projeto (nome + cor), indicador de estado (`Salvo`, `Salvando…`, `Sem alterações`).
- Direita: undo/redo (ícone + contador de passos), busca global (`Ctrl+K`), tema claro/escuro/auto, densidade, menu `?` (atalhos), menu conta/ajustes.
- Estado de salvamento é sempre visível e nunca modal.

### 3.2 Barra de comandos (B)

Ribbon do MS Project 2010 reinterpretada: abas como *segmented control* de baixa altura, grupos separados por divisor vertical fino, sem caixas decorativas.

- **Tarefa**: Inserir, Apagar, Indentar/Outdentar, Modo Manual/Automático, Inativar, Vincular, Tipo, Restrição, % concluído, Inserir subtask.
- **Recurso**: Adicionar recurso, Atribuir, Equipes, Unidades, Nível (v2), Team-Panel.
- **Projeto**: Definir baseline, Data de status, Propriedades, Cálculo, Importar/Exportar, Impressão.
- **Ver**: Visualizações (Gantt, Task Sheet, Timeline, Form), Dividir painel, Zoom, Grade, Modo escuro.
- **Formatar**: cores de barra, tema do Gantt, densidade, colunas.
- **Contextuais** (aparecem só quando relevante): `Formatar` para Gantt, `Agrupar/Filtrar` para seleção.

Comportamento: cada botão mostra atalho em tooltip após 500 ms; botões com efeito imediato (Zoom, Mostrar crítico) funcionam como toggle com estado ativo visível.

### 3.3 Barra de status (G)

```
[● Agendamento: Manual/Automático] [Tarefas: 42 | Selecionadas: 3] 
[Zoom: Mês] ──●──────── [100%] [Salvo às 14:32] [Tema] [Densidade]
```

O slider de zoom é o mesmo controle de zoom do Gantt (espelhado).

---

## 4. Task Sheet (grade principal)

### 4.1 Colunas padrão (layout)

```
| ▸ | WBS | Nome da tarefa | Início | Término | Duração | % | Predecessores | Recurso | Restrição | Indicadores |
```

### 4.2 Princípio "grade primeiro, formulário depois"

A Task Sheet é a **principal superfície de edição**. Nenhuma operação comum obriga a abrir o Task Form:

- Todo campo visível na grade é editável **na própria célula**.
- O formulário de detalhes abre **só quando o usuário pedir** (`F4`, botão `Detalhes` na barra de status, duplo-clique na barra do Gantt, menu `Propriedades`) e serve para campos avançados, atribuições e notas longas.
- Fechar o form (`Esc`) devolve o foco exatamente à célula que estava ativa antes.
- A grade e o form são **duas visões do mesmo estado**: editar em um reflete no outro imediatamente, sem salvar.

### 4.3 Edição inline

- **Entrar na célula**: `F2`, duplo-clique, ou **digitação direta** (o caractere digitado substitui o conteúdo atual e entra em modo de edição — como no Excel).
- **Confirmar**: `Enter` (desce uma linha), `Tab` (avança uma célula), clique fora.
- **Cancelar**: `Esc` (restaura o valor anterior).
- **Manter a célula após confirmar**: `Ctrl+Enter`.
- **Avançar e criar linha**: `Enter` na última linha cria uma nova tarefa no mesmo nível.
- **Colar em lote**: `Ctrl+V` com várias linhas do Excel/CSV distribui os valores por células e, se a coluna for `Nome`, cria as tarefas — **um único passo de undo**.
- **Tipos de célula**: texto, data (`10/12`, `+2d`, `+1 semana`, picker), duração (`3d`, `2w`, `40h`), percentual (`50`, `+10`, `-10`), moeda, flag (clique alterna), lista (dropdown), fórmula (somente leitura com ícone `ƒ`).
- **Validação inline**: valor inválido → borda `--danger` + tooltip com o motivo; a célula **nunca** fecha com erro silencioso.
- **Nenhuma tecla de navegação é capturada durante a edição**: escrever `-`, `+`, `Tab` ou uma seta dentro de uma célula tem o comportamento do campo, não o da grade.

### 4.4 Teclado — mapa completo da grade

> Regra de ouro: o app é operável **inteiramente sem mouse**. O overlay `?` mostra esta tabela.

**Navegação**

| Tecla | Ação |
| --- | --- |
| `↑ ↓ ← →` | mover célula / linha |
| `Home` / `End` | primeira / última célula da linha |
| `Ctrl+Home` | primeira célula da grade |
| `Ctrl+End` | última célula da grade |
| `Page Up` / `Page Down` | uma tela para cima/baixo |
| `Shift+setas`, `Shift+Page` | estender seleção |
| `Ctrl+A` | selecionar coluna / todas as linhas visíveis |
| `Ctrl+F` | busca com destaque e navegação pelos resultados |
| `Ctrl+K` | paleta de comandos |

**Edição**

| Tecla | Ação |
| --- | --- |
| `F2` / duplo-clique | editar célula |
| digitação direta | substituir conteúdo e editar |
| `Enter` | confirmar e desce |
| `Tab` / `Shift+Tab` | confirmar e avança / volta |
| `Esc` | cancelar edição |
| `Ctrl+Enter` | confirma mantendo a célula |
| `Delete` / `Backspace` | limpar conteúdo |
| `Ctrl+C/V/X` | copiar/colar recorte (multi-célula e multi-linha) |
| `Ctrl+D` | preencher para baixo (replicar valor no intervalo) |

**Estrutura WBS (hierarquia)**

| Tecla | Ação |
| --- | --- |
| `Ctrl+Shift+Right` (ou `Tab` na coluna 1) | **Indentar** — vira subtarefa da tarefa imediatamente acima |
| `Ctrl+Shift+Left` (ou `Shift+Tab` na coluna 1) | **Outdentar** — promove um nível |
| `Enter` na última linha | inserir nova tarefa no **mesmo nível** da anterior |
| `Insert` | inserir tarefa acima da selecionada (mesmo nível) |
| `Ctrl+Insert` | inserir tarefa abaixo (mesmo nível) |
| `Ctrl+Shift+Enter` | inserir tarefa-resumo acima e indentar as selecionadas |
| `Delete` | excluir tarefa(s) (com confirmação se houver subtarefas) |
| `Ctrl+Shift+Delete` | excluir mantendo as subtarefas (promover) |
| `Alt+↑` / `Alt+↓` | mover tarefa para cima/baixo **dentro do mesmo nível** |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer (a indentação é um passo único) |

**Recolher / expandir**

| Tecla | Ação |
| --- | --- |
| `+` (`Shift+=`) | expandir o nó selecionado |
| `-` | recolher o nó selecionado |
| `Ctrl++` | expandir **toda a subárvore** da seleção |
| `Ctrl+-` | recolher **toda a subárvore** da seleção |
| `Ctrl+Shift+*` (`Ctrl+Shift+8`) | expandir tudo |
| `Ctrl+Shift+-` | recolher tudo |
| duplo-clique na seta/nome | alternar expand/collapse |

Comportamentos obrigatórios do expand/collapse:

- **A seleção é preservada** (mesmo se a linha ficar oculta, ela é reativada ao expandir, com scroll até ela).
- A rolagem é **ancorada na linha visível mais próxima** — nada "pula".
- O estado de expansão é **persistido por visão** e sobrevive a trocar de visão e reabrir o projeto.
- O Gantt espelha o collapse: linhas recolhidas desaparecem dos dois lados, sempre em sincronia.

**Contexto do form**

| Tecla | Ação |
| --- | --- |
| `F4` | abrir Task Form para a seleção (ou alternar) |
| `Esc` (com form aberto) | fechar e devolver o foco à célula anterior |
| `F4` + `Shift` | abrir a aba anterior do form |

### 4.5 Hierarquia WBS na prática

- **Indentar** move a tarefa (e seus descendentes) para baixo do irmão anterior; se não houver irmão anterior, vira subtarefa do nó acima — senão, a ação é bloqueada com um toast discreto (`Não há tarefa anterior para indentar`).
- **Outdentar** promove para o nível do pai do pai; bloqueada na raiz.
- Ambas as operações funcionam em **seleção múltipla** preservando a ordem relativa do bloco.
- A numeração WBS (`2`, `2.1`, `2.1.3`) se recalcula **instantaneamente** e é animada (fade de 120 ms) para que o usuário acompanhe a mudança.
- Se a tarefa tiver **WBS code customizado** (máscara), o campo é editado manualmente e passa a ter precedência sobre a automática; duplicidade → erro inline.
- **Tarefas-resumo criadas primeiro** (top-down): `Ctrl+Shift+Enter` cria o resumo e as datas podem divergir do roll-up, sinalizado por ícone e tooltip.
- Reordenar por **drag** de linha mantém as mesmas regras: linha de inserção 2px, alvo inválido → `--danger` + shake.

### 4.6 Colunas

- Arrastar cabeçalho para redimensionar (snap em múltiplos de 4px), reordenar por drag, ocultar por menu de contexto, duplo-clique → autofit.
- **Coluna 1 (seta) e coluna `Nome` sempre fixas** ao rolar horizontalmente; cabeçalho fixo verticalmente.
- Ordem, larguras e visibilidade ficam salvas na **visão personalizada** (e na biblioteca global, se o usuário desejar).

### 4.7 Realce de alterações e indicadores

- **Change highlighting**: célula alterada desde o marco de referência ganha fundo `--accent-soft` + indicador no canto; limpeza manual ou por data.
- **Indicadores** (ícones 14px na coluna `Indicadores`): restrição, prazo (deadline), marco, superalocação, comentário, link inválido, duração estimada, placeholder, resumo com filhos ocultos.
- Indicadores são **ativos**: clicar abre o painel relevante (Task Inspector, menu de restrições etc.).

### 4.8 Estados de linha

| Estado | Tratamento |
| --- | --- |
| Selecionada | fundo `--accent-soft` + borda esquerda 2px `--accent` |
| Arrastando para reordenar | linha-fantasma 35% + linha de inserção 2px accent |
| Editando | borda da célula com `--accent`, shadow-1 |
| Inativa | texto `--fg-subtle`, nome com tachado sutil, sem negrito |
| Resumo | negrito, fundo `--bg-surface-2` |
| Placeholder | texto itálico `--fg-muted`, células vazias com `···` |
| Crítica | indicador `!` em `--danger` na coluna de indicadores (não pinta a linha inteira) |
| Resumo recolhido | seta `▸` + contador de descendentes ocultos (`+4` em pill `--bg-surface-2`) |
| Foco de navegação | anel 2px `--accent` com offset 2px (distinto da seleção de intervalo) |

---

## 5. Painel de detalhes (Task Form) — sob demanda

**Não abre automaticamente.** Abre apenas quando o usuário pedir: `F4`, botão `Detalhes` na barra de status, duplo-clique na barra do Gantt, ou item de contexto `Propriedades`. Tudo o que é rotineiro já é feito na grade (§4).

Abas verticais na borda direita: `Geral · Datas · Agendamento · Custos · Atribuições · Personalizado · Notas`.

- Campo: rótulo à esquerda (120px, `--fg-muted`), controle à direita, alinhado em grid.
- **Task Inspector** (nova seção do form): mostra *por que* a tarefa está onde está — cadeia condutora, restrição aplicada, calendário em uso, conflitos. É o coração do "entenda seu agendamento".
- O form é edição em tempo real sobre o mesmo estado da grade (nada de "OK/Cancelar"): cada alteração já vale, com `Esc`/`Ctrl+Z` desfazendo.
- Abrir/fechar não perde seleção, rolagem nem modo de edição da grade; a largura é persistida.
- Em telas estreitas vira drawer sobreposto com foco preso.

---

## 6. Gantt Chart — especificação visual

> Este é o item de maior exigência do projeto.

### 6.1 Composição em camadas

De baixo para cima (cada camada é um elemento de renderização independente, o que permite re-renderizar só o que mudou):

1. **Grid temporal**: linhas verticais (unidade menor), linhas fortes (unidade maior), linhas horizontais por linha de tarefa.
2. **Não útil**: sombra `--nonworking` (sábado/domingo/feriados/turnos) com opacidade 0.5–0.6, mais escura no modo escuro.
3. **Barras**: summary, tarefa, milestone, baseline, segmentos (splits).
4. **Progresso**: preenchimento interno da barra com barras/gradiente diagonal.
5. **Links**: caminho ortogonal com cantos arredondados + ponta de seta.
6. **Marcadores**: today line, status date, deadline, restrições, marcos sem tarefa.
7. **Seleção/interação**: highlight de cadeia condutora, guias de drag, preview de novo link, marquee.

### 6.2 Anatomia da barra de tarefa

```
  ┌─────────────────────────────────────┐
  │▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   ← 22px de altura, raio 6px
  └─────────────────────────────────────┘
   ↑ respiro 3px, borda 1px
```

| Tipo | Geometria | Cor (claro) | Cor (escuro) |
| --- | --- | --- | --- |
| **Tarefa** | retângulo arredondado 6px, altura 20px | `#6366f1` sólido | `#818cf8` |
| **Progresso** | preenchido da esquerda, faixa diagonal `repeating-linear-gradient` 45°, contraste +12% | `#4338ca` | `#a5b4fc` |
| **Manual (não agendada)** | mesma barra com borda `2px dashed` e fill a 60% | `#0ea5e9` | `#38bdf8` |
| **Crítica** | barra com borda `2px --danger` e fill inalterado | `#ef4444` | `#f87171` |
| **Resumo** | barra com "capítulos" (setas nos extremos, raio 0 no meio), altura 18px | `#334155` | `#cbd5e1` |
| **Baseline** | barra fantasma abaixo da atual, altura 8px, fill translúcido | `rgba(100,116,139,.45)` | `rgba(148,163,184,.45)` |
| **Inativa** | barra com `repeating-linear-gradient` diagonal cinza, borda tracejada | `#94a3b8` a 40% | `#475569` |
| **Placeholder** | borda `1.5px dashed`, sem fill, altura 16px | `--fg-subtle` | `--fg-subtle` |
| **Milestone** | losango 14×14 rotacionado 45°, contorno branco 1.5px | `#f59e0b` | `#fbbf24` |
| **Milestone concluída** | losango preenchido com `✓` central | `--success` | `--success` |
| **Tarefa concluída (100%)** | barra em `--success` com padrão sutil | `#16a34a` | `#22c55e` |

Regras:
- **Contraste mínimo 3:1** contra o fundo da grade em ambos os temas.
- Hover: elevação `shadow-1` + realce da barra em 6%; nunca altera o tamanho (evita jitter).
- Selecionada: contorno externo 2px `--accent` com `outline-offset: 2px`.
- Rótulo do nome aparece **dentro** da barra quando cabe (`> 64px`), caso contrário à direita da barra com fundo translúcido — e some em zoom muito fechado para não poluir.
- Barras de tarefas-mãe (resumo) mostram contagem de subtarefas no rótulo (`(4)`).

### 6.3 Dependências (links)

```
        ┌─────┐                          ┌─────┐
        │ A   ├─┐                        │ B   │
        └─────┘ │                        └─────┘
                └──────► (lag) ────────────┘
```

- Geometria **ortogonal com cantos arredondados** (raio 5px), nunca diagonais.
- Ponto de saída: borda direita da barra (FS/FF) ou topo (SS/SF); ponto de entrada: borda esquerda (FS/SS) ou topo/fundo (FF/SF).
- Lag positivo: segmento horizontal com rótulo `+2d`; lead (lag negativo): segmento com seta invertida e rótulo `−2d`.
- **Predecessor** na cadeia condutora: traço 2px `--accent`; demais links: 1.5px `--border-strong` a 70%.
- Hover em um link: destaca a cadeia completa (predecessores em jusante/sul) e apaga os demais (opacidade 25%).
- Criação de link: arrastar do **handle circular** (6px, aparece na borda direita no hover) até a barra alvo → preview com `dashed` + cursor de link; soltar em ponto inválido → `--danger` + shake 120ms.
- Setas: polígono de 6px com `--border-strong`, alinhado à borda da barra.

### 6.4 Cabeçalho de escala temporal

```
        │   2026                            │
        │  Novembro                    Dezembro        │
        │  10      17      24        01      08      │
        │  Seg Ter Qua Qui Sex Sáb Dom Seg Ter ...    │
```

- Duas a três faixas, dependendo do zoom (ano → mês → dia).
- Faixa superior: período grande (`2026`), com fundo `--bg-surface-2` e texto `--fg-subtle`, borda inferior 1px.
- Faixa do meio: unidade principal (`Novembro`), texto `--fg-default`, destaque para a unidade corrente (fundo `--accent-soft`).
- Faixa inferior: unidade menor (dias/semanas/horas), com **sábado/domingo em `--fg-subtle`** e **feriados com fundo `--warning-soft`**.
- Cabeçalho fixo (sticky) verticalmente e sincronizado horizontalmente com a grade por scroll compartilhado.
- **Hoje**: marcador vertical `--accent` 2px com pílula rotulada `Hoje` no cabeçalho.

### 6.5 Linha de hoje e status date

- `today`: linha vertical contínua 1.5px `--accent` a 55% de opacidade, atravessando todas as camadas.
- `status date`: linha tracejada `--info`, com rótulo no cabeçalho; quando coincidem, só o de hoje é desenhado.
- Deadline: pequena seta/caret `⌄` na coluna do prazo, `--warning`, com tooltip `Prazo: 20/12/2026 (em atraso)`.

### 6.6 Estados de interação do Gantt

| Ação | Comportamento |
| --- | --- |
| Hover na barra | tooltip flutuante com nome, datas, duração, %, recursos; handle de redimensionamento nas duas bordas |
| Arrastar barra (manual) | barra segue o cursor com snap na unidade de tempo; guia vertical de data + rótulo flutuante; soltar → recálculo imediato |
| Arrastar borda | redimensiona duração com rótulo `+3d`; dependentes pré-visualizados em linhas-fantasma |
| Ctrl+arrastar | cria **cópia** da tarefa |
| Arrastar em tarefa automática | oferece "mover para modo manual" (com aviso discreto) ou "reagendar dependente" |
| Selecionar tarefa | destaca cadeia condutora (predecessores em accent, sucessores em outline) |
| Ctrl+wheel | zoom centrado no ponteiro |
| Wheel com Shift | rolagem horizontal |
| Duplo-clique na barra | abre o Task Form na aba de datas |
| Clique direito | menu de contexto (recomendar itens do MS Project: Inserir tarefa, Vincular, Definir baseline, Inativar, Excluir) |
| Teclado | `←/→` navega tempo, `↑/↓` navega linhas, `+/-` expande/recolhe, `Ctrl+Z/Y` undo/redo |

**Gestão de foco entre a grade e o Gantt** (importante para não brigar com as teclas):

- Há **um único foco ativo** por vez: `Task Sheet` ou `Gantt`. A barra de status mostra qual (`F6` alterna entre os painéis).
- A **seleção é compartilhada**: navegar na grade move a linha destacada no Gantt e vice-versa, e a rolagem é espelhada.
- Com foco no Gantt, `+`/`-` controlam o **zoom**; com foco na grade, controlam **expand/collapse**. O tooltip do overlay `?` mostra o conjunto ativo.
- Nenhuma tecla digitada em campo de texto (célula em edição, busca, form) é interpretada como atalho de navegação.

### 6.7 Modos de visualização

- **Gantt padrão** — baseline oculta, foco no planejamento.
- **Tracking Gantt** — baseline (fantasma) + barra atual + coluna de desvio.
- **Gantt de custo** — barras proporcionais ao custo.
- **Modo de impressão** — escala congelada, sem interação, cabeçalho/rodapé/legenda.

---

## 7. Zoom e escala (Gantt)

### 7.1 Modelo

A escala é definida por **unidade base** (`px por dia`) + **unidade de exibição** (que gera as faixas do cabeçalho e os snap points). Zoom é **contínuo**: o usuário pode ir de 1 dia inteiro ocupando 1.200px até 1 ano inteiro ocupando 120px.

```
zoomLevel  →  pxPerDay ∈ [4, 1200]   (escala logarítmica)
displayUnit → auto (derivado de pxPerDay) | forçado pelo usuário
```

**Unidade de exibição derivada de `pxPerDay`:**

| px/dia | Unidade exibida | Faixas do cabeçalho | Snap de arraste |
| --- | --- | --- | --- |
| ≥ 400 | Hora | Ano › Mês › Dia (com horas) | hora |
| 90 – 399 | Dia | Ano › Mês › Dia | dia |
| 26 – 89 | Semana | Ano › Mês › Semana (seg–dom) | dia |
| 8 – 25 | Mês | Ano › Mês | dia |
| 3 – 7 | Trimestre | Ano › Trimestre | semana |
| < 3 | Ano | Ano › Semestre/Trimestre | mês |

### 7.2 Presets

`Horas · Dias · Semanas · Meses · Trimestres · Anos · Ajustar ao projeto · Ajustar à seleção`

- Preset redefine `pxPerDay` e trava a unidade até o próximo zoom manual.
- **Ajustar ao projeto**: `pxPerDay = larguraDisponível / (duração do projeto em dias)`; se o projeto couber em menos de 14 dias, abre em escala de dias.
- Atalhos: `Ctrl +` / `Ctrl −` (passos discretos), `Ctrl+0` = ajustar ao projeto, `Ctrl+1` = ajustar à seleção, slider na barra de status.

### 7.3 Comportamento durante o zoom

- Zoom **centrado no ponteiro** (ou no centro da visão se o ponteiro estiver fora).
- Linhas de tarefa **não mudam de altura** nem reflow — só a escala horizontal.
- Faixas do cabeçalho trocam com transição de 140 ms (fade + 2px de deslocamento), sem salto.
- A partir de `pxPerDay < 12`, labels de dia são removidos para evitar colisão (só a unidade superior é rotulada).
- Rótulos das barras são recalculados só após a transição terminar (evita reflow durante o gesto).
- Limites: `pxPerDay` mínimo 1.5, máximo 4.000.

### 7.4 Não útil e calendário

- Sábado/domingo sombreados; **turnos de trabalho** desenhados como faixas claras dentro do dia (visível em zoom de horas).
- Feriados do calendário do projeto aparecem no cabeçalho com ícone e sombra própria.
- Ao trocar de calendário (projeto/tarefa/recurso), o Gantt redesenha a sombra sem recarregar os dados.

### 7.5 Timeline (linha do tempo)

- Barra superior com marcos e tarefas selecionadas, escala independente do Gantt (mas com botão "sincronizar").
- Handles de recorte nas duas pontas; arrastar para ampliar/reduzir o intervalo exibido no Gantt.
- Tarefas adicionadas viram "cards" compactos com cor do grupo/fase.
- Exportável em PNG (canvas) e copiável para a área de transferência.

---

## 8. Team-Panel (visão de recursos)

- Lista de pessoas por equipe; para cada pessoa, faixa de tempo com as tarefas atribuídas (barras na cor da tarefa).
- **Superalocação**: trecho em `--danger` com padrão hachurado + ícone `!`; ao passar o mouse, mostra a demanda × capacidade (`8h / 6h`).
- Atribuir: arrastar tarefa da lista lateral para a pessoa, ou usar o campo de recurso na Task Sheet.
- Zoom herdado do Gantt (com opção de escala independente).

---

## 9. Portfólio (tela inicial)

- Cabeçalho: `Projetos` + botão `Novo projeto` + busca + ordenação.
- Grid de cards (ou tabela, alternável): nome, cor do projeto, período, `% concluído` com barra de progresso, nº de tarefas, recursos envolvidos, última alteração.
- Ações rápidas no card: Abrir, Duplicar, Exportar, Arquivar, Excluir (com confirmação).
- Templates na criação: `Vazio`, `Entrega de software`, `Planejamento de obras`, `Marketing`, `Importar de CSV/JSON`.
- Estado vazio ilustrado com atalho para criar/importar.

---

## 10. Componentes reutilizáveis

| Componente | Notas |
| --- | --- |
| `Button` | variantes primary/secondary/ghost/danger; tamanhos sm/md; loading state |
| `IconButton` | 28×28, tooltip obrigatório |
| `Field` | label + input + hint + error, alinhado em grid |
| `Combobox` | busca, grupos, teclado, semântica ARIA completa |
| `Dialog` | foco preso, `Esc` fecha, largura máxima 640px |
| `ContextMenu` | itens com atalho, separadores, submenus, ícones |
| `Tooltip` | atraso 500 ms, posicionamento por flip |
| `Toast` | canto inferior direito, ação "Desfazer" por 6 s |
| `Tabs` | sublinhado animado, rolagem quando excede a largura |
| `SplitPane` | divisores arrastáveis, largura persistida |
| `VirtualGrid` | base da Task Sheet e do Team-Panel; `role="grid"`, navegação por célula, virtualização de linhas |
| `KeyboardOverlay` | `?` → tabela de atalhos do painel em foco, buscável |
| `CommandPalette` | `Ctrl+K`, busca em ações + projetos + tarefas |

---

## 11. Movimento e feedback

| Evento | Animação |
| --- | --- |
| Abrir painel/dialog | fade + 6px de subida, 150 ms |
| Trocar visão | crossfade 120 ms (sem deslizar) |
| Zoom | transição de faixas 140 ms; grade sem transição (snappy) |
| Arrastar barra | sem transição (deve seguir o cursor) |
| Recalcular após drop | barras afetadas interpolam posição em 200 ms (mostra o efeito do agendamento) |
| Undo | mesma interpolação inversa |
| Salvar | indicador muda `Salvando…` → `✓ Salvo` com fade |

`prefers-reduced-motion: reduce` → todas as animações viram troca instantânea.

---

## 12. Impressão e exportação

- Modo de impressão dedicado (preview em tela) antes de `Ctrl+P`.
- Página: margens configuráveis, cabeçalho/rodapé (nome do projeto, período, data, página N/M), legenda de cores (barra, baseline, crítica, inativa, marco, não útil).
- Escala de tempo: `Ajustar à página` (auto), `Ajustar à largura`, ou escala fixa.
- Repetição do cabeçalho de colunas em todas as páginas; escolha de colunas visíveis.
- Sair para **PDF** via diálogo do navegador; geração server-side opcional para PDFs de alta fidelidade.
- Timeline exportada em PNG para colar em apresentações.

---

## 13. Acessibilidade

- Navegação completa por teclado na grade, com `role="grid"`/`gridcell` e anúncio de célula em `aria-live`.
- Foco visível sempre (anel 2px `--accent` com 2px de offset).
- Contraste AA (4.5:1 para texto, 3:1 para gráficos/barras).
- Cor nunca é o único canal: estados críticos também têm ícone/padrão.
- Modo de alto contraste respeita `prefers-contrast: more`.
- Atalhos documentados no overlay `?`, sem atalhos que capturem a entrada de texto.

---

## 14. Responsividade

| Largura | Comportamento |
| --- | --- |
| ≥ 1440px | layout completo (Task Sheet + Gantt + Form) |
| 1100–1439px | Form vira drawer; Task Sheet recolhível |
| 768–1099px | Task Sheet em overlay; Gantt em tela cheia |
| < 768px | modo leitura: Timeline + lista de tarefas; edição limitada (não é alvo de v1) |

---

## 15. Atributos de qualidade do Gantt (checklist de aceite)

1. Nenhum salto de layout durante zoom ou rolagem.
2. Barras alinhadas pixel-perfect na unidade de tempo (sem `subpixel` irregular — usar `transform: translateX()` e snapping em meios pixels quando necessário).
3. Links nunca atravessam barras de forma confusa (desvio mínimo de 8px).
4. Texto sempre legível; rótulo recuado automaticamente quando colide com o fim da barra.
5. Escala de tempo com divisões inteiras (nunca "15 de novembro" no meio de uma célula de mês).
6. Temas claro/escuro testados lado a lado em todas as barras.
7. Zoom de 1,5 a 4.000 px/dia sem perda de nitidez (vetor/SVG ou DPR-aware canvas).
8. Impressão em A4 retrato e paisagem sem cortar barras.
