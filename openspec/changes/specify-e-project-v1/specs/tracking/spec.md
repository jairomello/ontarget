# Spec Delta

## Purpose

Define o acompanhamento e o controle do projeto: linhas de base, data de status, valores reais, comparação de desvios e alertas de desempenho.

## ADDED Requirements

### Requirement: Linhas de base múltiplas
O sistema SHALL permitir salvar até 11 linhas de base nomeáveis por projeto, com opção de escopo (projeto inteiro ou tarefas selecionadas), e permitir removê-las.

#### Scenario: Segunda baseline após mudança de escopo
- **WHEN** o usuário salva uma nova baseline depois de renegotiar o prazo
- **THEN** coexistem a baseline original e a nova, cada uma com seus valores

### Requirement: Planos provisórios
O sistema SHALL permitir salvar planos provisórios (interim plans) que registram apenas datas, sem custos, mantendo-os separados das baselines.

#### Scenario: Registro de datas provisórias
- **WHEN** o usuário salva um plano provisório
- **THEN** apenas as datas são registradas e ele aparece na lista como plano provisório

### Requirement: Data de status
O sistema SHALL permitir definir a data de status do projeto e usá-la como referência para atrasos e progresso, atualizando-a automaticamente para a data corrente quando configurado.

#### Scenario: Atraso em relação à data de status
- **WHEN** uma tarefa deveria ter terminado antes da data de status e não terminou
- **THEN** ela é classificada como atrasada com o desvio em dias exibido

### Requirement: Registro de progresso
O sistema SHALL aceitar percentual concluído, duração real, trabalho real, custo real, data de início real e data de término real por tarefa, e derivar o restante dos valores informados.

#### Scenario: Informar 50% concluído
- **WHEN** o usuário informa 50% em uma tarefa
- **THEN** o trabalho restante é recalculado e o preenchimento da barra no Gantt passa a 50%

### Requirement: Tracking Gantt
O sistema SHALL oferecer a visão Tracking Gantt exibindo a baseline como barra fantasma sob a barra atual, com colunas de desvio de início, término e duração.

#### Scenario: Comparação visual
- **WHEN** o usuário abre o Tracking Gantt após uma baseline salva
- **THEN** cada tarefa mostra a barra atual e a barra da baseline, com o desvio correspondente na grade

### Requirement: Linha de progresso
O sistema SHALL desenhar, na data de status, uma linha de progresso indicando tarefas adiantadas e atrasadas em relação ao planejado, com sinalização nos dois sentidos.

#### Scenario: Misto
- **WHEN** há tarefas adiantadas e atrasadas na data de status
- **THEN** a linha mostra desvios à direita (adiantado) e à esquerda (atrasado) com rótulos

### Requirement: Atualização em lote
O sistema SHALL oferecer "Atualizar tarefas" e "Atualizar projeto" para aplicar percentuais e valores reais a um conjunto selecionado ou a todo o projeto.

#### Scenario: Atualizar projeto
- **WHEN** o usuário usa "Atualizar projeto" com a data corrente
- **THEN** as tarefas em andamento recebem o progresso proporcional à data e o cronograma é recalculado

### Requirement: Alertas de desempenho
O sistema SHALL reunir em um painel as tarefas atrasadas, com prazo excedido, com restrição conflitante, superalocadas e com vínculo inválido, permitindo navegar até cada uma.

#### Scenario: Navegar do alerta
- **WHEN** o usuário clica em um alerta de tarefa atrasada
- **THEN** a tarefa é selecionada na grade e no Gantt com a visão rolada até ela

### Requirement: Replanejamento e simulação
O sistema SHALL permitir mover tarefas manualmente e duplicar o projeto para simulação de cenários, mantendo o projeto original intacto.

#### Scenario: Cenário what-if
- **WHEN** o usuário duplica o projeto para testar um atraso
- **THEN** o original permanece inalterado e o cenário pode ser descartado sem afetá-lo

### Requirement: Valores de desvio por baseline
O sistema SHALL calcular desvio em dias e em custo entre a baseline selecionada e o estado atual, por tarefa e em roll-up.

#### Scenario: Desvio acumulado
- **WHEN** o usuário seleciona a baseline 1
- **THEN** a grade exibe o desvio de cada tarefa e o acumulado do projeto
