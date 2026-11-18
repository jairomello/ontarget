# Spec Delta

## Purpose

Define a árvore de tarefas do projeto: hierarquia WBS, ordenação, recolhimento/expandimento e os estados especiais de tarefa (resumo, marco, inativa e de espaço reservado).

## ADDED Requirements

### Requirement: Estrutura hierárquica de tarefas
O sistema SHALL representar as tarefas como uma árvore com nível, ordem e número WBS derivado (`1`, `1.2`, `1.2.3`), mantendo-o consistente após qualquer mudança de estrutura.

#### Scenario: Renumeração automática
- **WHEN** uma tarefa é indentada no meio da árvore
- **THEN** os números WBS de todas as tarefas afetadas são recalculados imediatamente

### Requirement: Indentar tarefa
O sistema SHALL permitir transformar uma tarefa em subtarefa do irmão imediatamente anterior, por `Ctrl+Shift+Right` ou `Tab` na primeira coluna, e bloquear a operação quando não há irmão anterior.

#### Scenario: Indentar com seleção múltipla
- **WHEN** o usuário indenta um bloco de tarefas selecionadas
- **THEN** todas se tornam subtarefas do mesmo pai, preservando a ordem relativa do bloco

#### Scenario: Tentativa sem irmão anterior
- **WHEN** o usuário tenta indentar a primeira tarefa do projeto
- **THEN** nenhuma alteração ocorre e uma mensagem explica que não há tarefa anterior

### Requirement: Outdentar tarefa
O sistema SHALL permitir promover uma tarefa um nível acima por `Ctrl+Shift+Left` ou `Shift+Tab` na primeira coluna, e bloquear a operação na raiz.

#### Scenario: Promover subtarefa
- **WHEN** o usuário outdenta a primeira subtarefa de um resumo
- **THEN** ela passa a ser irmã do resumo e a árvore seguinte é renumerada

### Requirement: Recolher e expandir hierarquia
O sistema SHALL permitir recolher e expandir subárvores por seta, `+`, `-`, `Ctrl++`, `Ctrl+-`, `Ctrl+Shift+*` e duplo-clique, preservando a seleção e ancorando a rolagem na linha visível mais próxima.

#### Scenario: Recolher mantém seleção
- **WHEN** o usuário recolhe o nó que contém a seleção
- **THEN** a seleção permanece no resumo recolhido e a rolagem não salta

#### Scenario: Expandir restaura o ponto de vista
- **WHEN** o usuário expande um resumo recolhido
- **THEN** as subtarefas aparecem e a linha anteriormente visível permanece visível

### Requirement: Estado de expansão persistido por visão
O sistema SHALL armazenar o estado recolhido/aberto por visão e restaurá-lo ao reabrir o projeto.

#### Scenario: Reabertura do projeto
- **WHEN** o usuário reabre um projeto com fases recolhidas
- **THEN** a árvore é exibida no mesmo estado de expansão da última sessão

### Requirement: Tarefa-resumo e roll-up
O sistema SHALL criar tarefa-resumo automaticamente ao indentar e calcular seu início, término e duração a partir dos descendentes ativos, exceto quando o resumo tem datas manuais (planejamento top-down).

#### Scenario: Roll-up automático
- **WHEN** a data de término da última subtarefa muda
- **THEN** o resumo passa a terminar nessa data

#### Scenario: Resumo top-down divergente
- **WHEN** o usuário define datas manualmente em um resumo que difere do roll-up
- **THEN** as datas do resumo são mantidas e uma indicação visual sinaliza a divergência

### Requirement: Marcos
O sistema SHALL tratar tarefas com duração zero como marcos, exibindo-as como losango no Gantt e permitindo marcá-las ou desmarcá-las a qualquer momento.

#### Scenario: Conversão em marco
- **WHEN** o usuário marca uma tarefa como marco
- **THEN** sua duração vira zero e a barra no Gantt vira losango, sem alterar as datas dos dependentes já iniciados

### Requirement: Tarefas inativas
O sistema SHALL manter tarefas inativas com todos os dados (custos, alocações, campos personalizados) excluindo-as de roll-ups, cálculo de caminho crítico e superalocação, e permitir reativá-las.

#### Scenario: Inativar preserva dados
- **WHEN** o usuário inativa uma tarefa com atribuições e custo
- **THEN** os dados permanecem visíveis e editáveis, mas a tarefa não afeta datas nem resumos

#### Scenario: Reativar tarefa
- **WHEN** o usuário reativa uma tarefa
- **THEN** ela volta a participar do cálculo e seu agendamento é recalculado

### Requirement: Tarefas de espaço reservado
O sistema SHALL permitir criar tarefas contendo apenas o nome e qualquer combinação de início, término e duração, mantendo os campos ausentes como pendentes.

#### Scenario: Tarefa só com nome
- **WHEN** o usuário cria uma tarefa informando apenas o nome
- **THEN** ela é aceita, exibida com marcador de pendência e não bloqueia o agendamento

### Requirement: Ordenação de tarefas
O sistema SHALL permitir mover tarefas para cima e para baixo dentro do mesmo nível por `Alt+↑`/`Alt+↓` e por arrastar, preservando as subárvores.

#### Scenario: Reordenar com subárvore
- **WHEN** o usuário move um resumo para baixo
- **THEN** ele se desloca com todas as suas subtarefas
