# Spec Delta

## Purpose

Mantém o portfólio de projetos do usuário: criação, abertura, duplicação, arquivamento, exclusão e o resumo agregado de cada projeto na tela inicial.

## ADDED Requirements

### Requirement: Listagem do portfólio
O sistema SHALL exibir todos os projetos não excluídos em uma tela inicial com, para cada projeto, nome, cor, período (início/término), percentual de conclusão, número de tarefas, recursos envolvidos e data da última alteração.

#### Scenario: Portfólio com múltiplos projetos
- **WHEN** o usuário abre a aplicação
- **THEN** todos os projetos existentes são listados com seus resumos atualizados

#### Scenario: Portfólio vazio
- **WHEN** não há nenhum projeto criado
- **THEN** o sistema exibe um estado vazio com ações de criar projeto e importar arquivo

### Requirement: Criação de projeto
O sistema SHALL permitir criar um projeto informando nome, data de início e calendário padrão, a partir de um template (Vazio, Entrega de software, Planejamento de obras, Marketing) ou de um arquivo importado.

#### Scenario: Projeto criado a partir de template
- **WHEN** o usuário escolhe um template e confirma a criação
- **THEN** o projeto é criado com as tarefas, marcos e estrutura do template e abre automaticamente na Task Sheet

### Requirement: Abrir projeto
O sistema SHALL carregar o projeto selecionado com todas as suas tarefas, recursos, visões e estado de expansão preservados desde a última sessão.

#### Scenario: Retomada de trabalho
- **WHEN** o usuário abre um projeto que foi trabalhado na sessão anterior
- **THEN** as tarefas, seleção, visão ativa, zoom e árvore recolhida/aberta são restaurados

### Requirement: Duplicar projeto
O sistema SHALL criar uma cópia integral do projeto (tarefas, dependências, recursos, atribuições, baselines, calendários e campos personalizados) com nome sugerido `<original> (cópia)` e datas preservadas.

#### Scenario: Cópia independente
- **WHEN** o usuário duplica um projeto e altera uma tarefa na cópia
- **THEN** o projeto original permanece inalterado

### Requirement: Arquivar projeto
O sistema SHALL permitir arquivar um projeto, removendo-o da listagem principal e movendo-o para uma área de arquivados, sem perder dados.

#### Scenario: Projeto arquivado some da listagem principal
- **WHEN** o usuário arquiva um projeto
- **THEN** ele deixa de aparecer na listagem padrão e passa a ser listado na área de arquivados

### Requirement: Excluir projeto
O sistema SHALL exigir confirmação explícita antes de excluir um projeto definitivamente, informando a contagem de tarefas e recursos que serão removidos.

#### Scenario: Exclusão confirmada
- **WHEN** o usuário confirma a exclusão
- **THEN** o projeto e todos os dados associados são removidos e a ação pode ser desfeita por um período de 10 segundos via toast de undo

#### Scenario: Exclusão cancelada
- **WHEN** o usuário cancela a confirmação
- **THEN** nada é removido

### Requirement: Resumo agregado do projeto
O sistema SHALL calcular o percentual de conclusão, as datas mínimo/máximo e a contagem de tarefas de cada projeto de forma resumida, sem carregar o projeto inteiro.

#### Scenario: Resumo atualizado após alteração
- **WHEN** o percentual de conclusão de tarefas de um projeto muda
- **THEN** o resumo do portfólio reflete o novo valor na próxima consulta
