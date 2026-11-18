# Spec Delta

## Purpose

Permite desfazer e refazer qualquer edição do usuário de forma previsível, tratando cada ação (inclusive ações estruturais em lote) como um único passo.

## ADDED Requirements

### Requirement: Desfazer e refazer global
O sistema SHALL manter uma pilha de desfazer com pelo menos 100 passos, acessível por `Ctrl+Z` (desfazer) e `Ctrl+Y`/`Ctrl+Shift+Z` (refazer), disponível em qualquer visão ativa.

#### Scenario: Desfazer sequencial
- **WHEN** o usuário executa três edições diferentes e pressiona `Ctrl+Z` três vezes
- **THEN** cada edição é revertida na ordem inversa e o estado volta ao anterior à primeira delas

#### Scenario: Refazer após desfazer
- **WHEN** o usuário desfaz e depois pressiona `Ctrl+Y`
- **THEN** a edição desfeita é reaplicada com os mesmos valores

### Requirement: Ação estrutural é um único passo
O sistema SHALL tratar operações de hierarquia aplicadas a múltiplas tarefas (indentar, outdentar, mover, excluir subárvore) como um único passo de desfazer.

#### Scenario: Indentar um bloco de 5 tarefas
- **WHEN** o usuário indenta 5 tarefas selecionadas e pressiona `Ctrl+Z` uma vez
- **THEN** as 5 tarefas voltam à posição e ao nível originais simultaneamente

### Requirement: Desfazer cobre todas as categorias de edição
O sistema SHALL desfazer alterações de estrutura de tarefas, campos de dados, dependências, atribuições de recursos, baselines e configurações de visão.

#### Scenario: Desfazer criação de dependência
- **WHEN** o usuário cria um vínculo entre tarefas e desfaz
- **THEN** o vínculo é removido e as datas recalculadas voltam ao estado anterior

### Requirement: O estado derivado não entra no histórico
O sistema SHALL recalcular o agendamento e os valores derivados após cada desfazer/refazer, sem armazená-los como parte do histórico.

#### Scenario: Desfazer altera datas derivadas
- **WHEN** o usuário desfaz a mudança de duração de uma tarefa
- **THEN** as datas das tarefas dependentes são recalculadas para o estado anterior

### Requirement: Histórico por projeto
O sistema SHALL manter o histórico separado por projeto e descartá-lo ao trocar de projeto.

#### Scenario: Troca de projeto
- **WHEN** o usuário abre outro projeto
- **THEN** `Ctrl+Z` não afeta o projeto anterior

### Requirement: Desfazer não altera seleção nem rolagem
O sistema SHALL preservar a seleção e a posição de rolagem durante desfazer e refazer.

#### Scenario: Desfazer com célula selecionada
- **WHEN** o usuário desfaze uma edição mantendo uma célula selecionada
- **THEN** a seleção permanece na mesma célula e a visão não salta

### Requirement: Pilha limitada
O sistema SHALL descartar os passos mais antigos quando a pilha atingir o limite, mantendo sempre o máximo disponível.

#### Scenario: Limite atingido
- **WHEN** o usuário realiza mais de 100 edições
- **THEN** os passos mais antigos são descartados e os mais recentes continuam desfazíveis
