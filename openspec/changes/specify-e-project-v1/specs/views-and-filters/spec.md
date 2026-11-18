# Spec Delta

## Purpose

Define visões, tabelas, filtros, agrupamentos e ordenações, incluindo a biblioteca global que os reutiliza entre projetos.

## ADDED Requirements

### Requirement: Ordenação por um ou mais campos
O sistema SHALL permitir ordenar por um ou mais campos em ordem ascendente ou descendente, preservando a hierarquia WBS quando solicitado.

#### Scenario: Ordenar por duração mantendo árvore
- **WHEN** o usuário ordena por duração com a hierarquia preservada
- **THEN** os irmãos são reordenados e cada resumo permanece com suas subtarefas

### Requirement: Filtros
O sistema SHALL oferecer filtros por campo, valor e operador, combináveis por E/OU, além de filtros prontos (em atraso, críticas, atrasadas, sem recurso, marcos, tarefas manuais).

#### Scenario: Filtro combinado
- **WHEN** o usuário filtra "em atraso E críticas"
- **THEN** somente tarefas que satisfazem ambas as condições são exibidas na grade e no Gantt

#### Scenario: Sem correspondência
- **WHEN** nenhum registro satisfaz o filtro
- **THEN** a visão exibe estado vazio explicando que nenhum item corresponde, mantendo o filtro ativo

### Requirement: Agrupamento
O sistema SHALL permitir agrupar por um ou mais campos com cabeçalho de grupo exibindo contagem e sumário numérico dos campos agregáveis.

#### Scenario: Agrupar por recurso
- **WHEN** o usuário agrupa por recurso
- **THEN** cada pessoa vira um cabeçalho com contagem de tarefas e soma de trabalho

### Requirement: Visões nomeadas
O sistema SHALL permitir criar, renomear, duplicar e remover visões que preservam conjunto de colunas, ordem, filtros, agrupamento, ordenação, layout dividido, zoom e estado de expansão.

#### Scenario: Trocar de visão
- **WHEN** o usuário alterna entre "Visão Gantt" e "Visão de Controle"
- **THEN** cada uma restaura suas próprias colunas, filtros e layout

### Requirement: Biblioteca global
O sistema SHALL manter uma biblioteca de visões, filtros, agrupamentos, tabelas, calendários e códigos de estrutura compartilhável entre projetos, além dos itens próprios de cada projeto.

#### Scenario: Reutilizar filtro
- **WHEN** o usuário salva um filtro na biblioteca global
- **THEN** ele está disponível em todos os projetos

### Requirement: Visão de detalhes e layout dividido
O sistema SHALL permitir alternar painéis (Timeline, Task Sheet, Gantt, formulário de detalhes), redimensionar os divisores e lembrar o layout por visão.

#### Scenario: Layout restaurado
- **WHEN** o usuário reabre o projeto com o formulário de detalhes aberto e a divisão em 40%
- **THEN** o layout é restaurado exatamente

### Requirement: Estado de agrupamento e filtros no Gantt
O sistema SHALL aplicar filtros, agrupamentos e ordenação também ao Gantt, mantendo as linhas idênticas às da Task Sheet.

#### Scenario: Filtro ativo
- **WHEN** um filtro é aplicado
- **THEN** o Gantt exibe exatamente as mesmas linhas da grade, incluindo cabeçalhos de grupo
