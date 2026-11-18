# Spec Delta

## Purpose

Define os calendários de projeto, tarefa e recurso que determinam o tempo útil, os turnos e as exceções usados por todo o agendamento e pelo desenho do Gantt.

## ADDED Requirements

### Requirement: Calendário padrão do projeto
O sistema SHALL criar todo projeto com um calendário padrão contendo dias úteis seg–sex, turno único e horário configurável, aplicável a tarefas e recursos que não tenham calendário próprio.

#### Scenario: Projeto novo
- **WHEN** um projeto é criado sem especificar calendário
- **THEN** ele recebe um calendário padrão seg–sex com turno de 8 horas

### Requirement: Calendários por tarefa e por recurso
O sistema SHALL permitir associar calendários diferentes a tarefas e a recursos, prevalecendo a ordem calendário da tarefa → calendário do recurso → calendário do projeto.

#### Scenario: Tarefa com turno próprio
- **WHEN** uma tarefa usa um calendário de 6 horas diárias
- **THEN** sua duração é calculada sobre aquelas 6 horas, independentemente do calendário do projeto

### Requirement: Dias úteis e turnos
O sistema SHALL permitir configurar, por dia da semana, se é útil e o intervalo de turno com início e fim, incluindo a pausa entre turnos.

#### Scenario: Sábado útil
- **WHEN** o usuário marca o sábado como dia útil com turno de 4 horas
- **THEN** o agendamento utiliza o sábado e o Gantt deixa de sombreá-lo

### Requirement: Exceções de calendário
O sistema SHALL permitir cadastrar exceções pontuais (feriado, dia útil especial, turno especial) com data, natureza e nome, aplicadas antes do padrão semanal.

#### Scenario: Feriado no meio da semana
- **WHEN** um feriado é cadastrado em uma quarta-feira útil
- **THEN** o dia não é computado como tempo útil e as tarefas são deslocadas

#### Scenario: Dia útil compensatório
- **WHEN** um sábado é cadastrado como dia útil especial
- **THEN** ele é computado como útil mesmo sendo fim de semana no padrão

### Requirement: Propagação de mudanças de calendário
O sistema SHALL recalcular as tarefas afetadas e redesenhar o tempo não útil no Gantt quando um calendário for alterado.

#### Scenario: Novo feriado
- **WHEN** o usuário adiciona um feriado ao calendário do projeto
- **THEN** as tarefas que atravessavam aquela data são reagendadas e a coluna passa a exibir a sombra

### Requirement: Duração em unidades de tempo
O sistema SHALL aceitar durações em horas, dias, semanas e meses, convertendo cada unidade pelo calendário aplicável e arredondando para o tempo útil correspondente.

#### Scenario: Duração de uma semana
- **WHEN** o usuário informa `1w` em uma tarefa com calendário seg–sex
- **THEN** a duração equivale aos dias úteis da semana, não a 7 dias corridos

### Requirement: Gerenciamento de calendários
O sistema SHALL permitir criar, renomear, duplicar e excluir calendários não utilizados, e bloquear a exclusão do calendário em uso.

#### Scenario: Exclusão bloqueada
- **WHEN** o usuário tenta excluir o calendário associado ao projeto
- **THEN** a exclusão é recusada com indicação de onde ele está em uso
