# Spec Delta

## Purpose

Define pessoas (recursos) pré-cadastradas em equipes, sua atribuição às tarefas, o cálculo de trabalho e custo e a detecção de superalocação.

## ADDED Requirements

### Requirement: Cadastro de recursos em equipes
O sistema SHALL permitir cadastrar pessoas com nome, iniciais, cor, unidades máximas, taxa padrão e calendário, organizadas em equipes nomeadas e coloridas.

#### Scenario: Nova pessoa em uma equipe
- **WHEN** o usuário adiciona uma pessoa a uma equipe
- **THEN** ela fica disponível para atribuição em qualquer tarefa do projeto

### Requirement: Atribuição de tarefas a recursos
O sistema SHALL permitir atribuir recursos a tarefas pela coluna de recursos da Task Sheet, pelo formulário de detalhes e por arrastar no painel de equipe, definindo unidades percentuais.

#### Scenario: Atribuição pela coluna
- **WHEN** o usuário seleciona uma pessoa na coluna de recursos
- **THEN** a atribuição é criada com 100% de unidades e o trabalho é recalculado

#### Scenario: Atribuição por arraste
- **WHEN** o usuário arrasta uma tarefa do painel lateral para uma pessoa
- **THEN** a atribuição é criada e a tarefa aparece na linha daquela pessoa

### Requirement: Cálculo de trabalho e custo
O sistema SHALL calcular o trabalho da atribuição como duração × unidades × calendário da pessoa, e o custo como trabalho × taxa padrão, com roll-up para tarefa e projeto.

#### Scenario: Duas pessoas na mesma tarefa
- **WHEN** duas pessoas são atribuídas a uma tarefa de 5 dias com 100% e 50% de unidades
- **THEN** o trabalho soma as duas contribuições e o custo usa a taxa de cada uma

### Requirement: Remoção de atribuição
O sistema SHALL permitir remover atribuições sem apagar a tarefa, recalculando trabalho e custo.

#### Scenario: Único recurso removido
- **WHEN** o usuário remove a única atribuição de uma tarefa
- **THEN** a tarefa permanece, com trabalho e custo zerados

### Requirement: Detecção de superalocação
O sistema SHALL identificar períodos em que a demanda de uma pessoa excede suas unidades máximas e sinalizá-los no painel de equipe, no Gantt e nos alertas.

#### Scenario: Pessoa alocada acima da capacidade
- **WHEN** uma pessoa com 100% de unidades tem duas tarefas simultâneas
- **THEN** o período conflitante é exibido com marca de superalocação e a razão demanda/capacidade

### Requirement: Painel de equipe
O sistema SHALL exibir, para cada pessoa, uma faixa de tempo com as tarefas atribuídas, no mesmo zoom do Gantt, permitindo reatribuir por arrastar.

#### Scenario: Reatribuição no painel
- **WHEN** o usuário arrasta uma barra de uma pessoa para outra
- **THEN** a atribuição muda de responsável e ambas as linhas são atualizadas

### Requirement: Ociosidade de trabalho
O sistema SHALL indicar, por pessoa, o total de trabalho atribuído, a capacidade disponível no período e as janelas sem trabalho.

#### Scenario: Resumo da pessoa
- **WHEN** o usuário abre o resumo de uma pessoa
- **THEN** são exibidos trabalho atribuído, capacidade e janelas ociosas no período do projeto

### Requirement: Recursos ausentes do escopo do v1
O sistema SHALL tratar apenas recursos de trabalho (pessoas) no v1, não permitindo recursos de material, custo ou orçamento.

#### Scenario: Tipo indisponível
- **WHEN** o usuário procura por opções de recurso de material
- **THEN** a opção não é oferecida e o tipo registrado é sempre "trabalho"
