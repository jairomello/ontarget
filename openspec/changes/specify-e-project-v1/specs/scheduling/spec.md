# Spec Delta

## Purpose

Define o motor de agendamento que calcula datas, durações, floats e caminho crítico do projeto, reproduzindo o comportamento do MS Project 2010 para os cenários de referência.

## ADDED Requirements

### Requirement: Agendamento controlado pelo usuário
O sistema SHALL suportar tarefas com agendamento manual (datas definidas pelo usuário, imunes a dependências e calendário) e automática (calculadas pelo motor), com conversão em ambos os sentidos por tarefa e em lote para o projeto.

#### Scenario: Conversão para automática
- **WHEN** o usuário converte uma tarefa manual para automática
- **THEN** ela é recalculada segundo dependências, restrições e calendário e passa a se mover com o cronograma

#### Scenario: Conversão para manual preserva datas
- **WHEN** o usuário converte uma tarefa automática para manual
- **THEN** as datas calculadas são mantidas como datas manuais e a tarefa para de se mover

### Requirement: Propagação de tarefas manuais
O sistema SHALL usar as datas de uma tarefa manual como origem para o agendamento dos sucessores, sem alterar a tarefa manual.

#### Scenario: Sucessor de tarefa manual
- **WHEN** uma tarefa automática depende de uma tarefa manual terminar
- **THEN** ela começa após a data de término informada manualmente

### Requirement: Cálculo do caminho crítico
O sistema SHALL calcular o caminho crítico pelo método do caminho crítico, com passagem direta e inversa, determinando início/término tardios, float total e float livre de cada tarefa, e identificando múltiplos caminhos críticos.

#### Scenario: Float zero
- **WHEN** o cálculo termina
- **THEN** toda tarefa com float total zero está marcada como crítica e é destacada no Gantt e na grade

#### Scenario: Múltiplos caminhos
- **WHEN** dois caminhos independentes terminam em marcos com float zero
- **THEN** ambos são exibidos como críticos

### Requirement: Tipos de tarefa e esforço
O sistema SHALL suportar duração fixa, trabalho fixo e unidades fixas, mantendo a relação duração × unidades × trabalho coerente, com opção de agendamento condicionado pelo esforço.

#### Scenario: Trabalho fixo com mais recursos
- **WHEN** um segundo recurso é adicionado a uma tarefa de trabalho fixo com esforço ativo
- **THEN** o trabalho permanece e a duração é reduzida proporcionalmente à soma das unidades

#### Scenario: Duração fixa
- **WHEN** uma tarefa de duração fixa recebe mais recursos
- **THEN** a duração permanece e o trabalho cresce

### Requirement: Restrições de data
O sistema SHALL suportar as restrições ASAP, ALAP, Começar Não Antes De, Começar Não Depois De, Terminar Não Antes De, Terminar Não Depois De, Deve Começar Em e Deve Terminar Em, aplicando-as no cálculo e exibindo o ícone correspondente.

#### Scenario: Restrição vence o cálculo
- **WHEN** uma tarefa com "Começar Não Antes De" teria início anterior por dependência
- **THEN** o início é fixado na data da restrição e um conflito é registrado

#### Scenario: Restrição conflitante
- **WHEN** duas condições impõem datas incompatíveis
- **THEN** o sistema mantém a restrição dura e registra o conflito para exibição nos alertas

### Requirement: Prazos (deadlines)
O sistema SHALL aceitar um prazo por tarefa, exibi-lo como marcador no Gantt e gerar alerta quando o término calculado o exceder.

#### Scenario: Prazo excedido
- **WHEN** o término calculado ultrapassa o prazo
- **THEN** o marcador fica em estado de excesso e a tarefa aparece na lista de alertas

### Requirement: Roll-up de tarefas-resumo
O sistema SHALL calcular início e término do resumo como mínimo e máximo dos descendentes ativos, respeitando datas manuais quando definidas no resumo.

#### Scenario: Resumo com filhos inativos
- **WHEN** um resumo tem subtarefas ativas e inativas
- **THEN** apenas as ativas determinam o roll-up

### Requirement: Tarefas inativas fora do cálculo
O sistema SHALL excluir tarefas inativas do cálculo de datas, de roll-ups, de caminho crítico e de superalocação, preservando seus dados.

#### Scenario: Inativa não desloca nada
- **WHEN** uma tarefa inativa seria a mais tardia do projeto
- **THEN** o fim do projeto não a considera

### Requirement: Tarefas de espaço reservado parcialmente calculadas
O sistema SHALL agendar tarefas de espaço reservado usando os campos informados e marcar como pendente todo campo ausente, sem bloquear o cálculo do restante do projeto.

#### Scenario: Placeholder com só o nome
- **WHEN** uma tarefa de espaço reservado possui apenas o nome
- **THEN** ela é exibida sem datas calculadas com marcador de pendência e não impede o agendamento

### Requirement: Divisão de tarefas (splits)
O sistema SHALL permitir dividir uma tarefa em segmentos separados por intervalo não útil, calculando duração e datas como a soma dos segmentos.

#### Scenario: Tarefa interrompida
- **WHEN** o usuário insere um intervalo de 3 dias no meio de uma tarefa
- **THEN** ela é exibida em dois segmentos, a duração útil total é preservada e o término é adiado

### Requirement: Tarefas recorrentes
O sistema SHALL expandir tarefas recorrentes em ocorrências diárias, semanais ou mensais com intervalo, fim por data ou por número de ocorrências, respeitando o calendário ativo.

#### Scenario: Recorrência semanal com feriado
- **WHEN** uma ocorrência semanal cai em um feriado
- **THEN** a ocorrência é deslocada conforme o calendário e mantém sua ordem

### Requirement: Detecção de ciclos
O sistema SHALL recusar a criação de dependência que forme ciclo, identificando as arestas envolvidas, e manter o cálculo íntegro quando um ciclo existir em dados importados.

#### Scenario: Ciclo informado pelo usuário
- **WHEN** o usuário tenta vincular uma tarefa a sua própria descendente
- **THEN** a operação é recusada com a indicação do caminho que formaria o ciclo

### Requirement: Recálculo incremental e desempenho
O sistema SHALL recalcular apenas a cadeia afetada por uma edição e concluir um recálculo completo de 5.000 tarefas em até 300 ms, mantendo a interface responsiva.

#### Scenario: Edição em projeto grande
- **WHEN** o usuário altera a duração de uma tarefa em um projeto de 5.000 tarefas
- **THEN** as datas afetadas são atualizadas sem travamento perceptível da interface

### Requirement: Paridade com o MS Project 2010
O sistema SHALL reproduzir exatamente os resultados dos cenários de referência de agendamento (dependências com latência em dias úteis, restrições, calendários alternativos, tipos de tarefa, tarefas manuais, inatividade, splits, recorrência e baselines).

#### Scenario: Cenário de referência automatizado
- **WHEN** a suíte de paridade é executada
- **THEN** todas as entradas produzem as datas esperadas extraídas do MS Project 2010
