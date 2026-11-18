# Spec Delta

## Purpose

Define os vínculos entre tarefas — criação, remoção, tipos, latências e inspeção — que estruturam o fluxo do cronograma.

## ADDED Requirements

### Requirement: Tipos de dependência
O sistema SHALL suportar os tipos de vínculo Terminar–Começar (FS), Começar–Começar (SS), Terminar–Terminar (FF) e Começar–Terminar (SF), aplicando cada um no cálculo de datas.

#### Scenario: Vínculo SS
- **WHEN** uma tarefa deve começar junto com outra (SS)
- **THEN** seu início não é anterior ao início do predecessor

### Requirement: Latência e antecipação
O sistema SHALL aceitar latência positiva e antecipação (latência negativa) em qualquer vínculo, expressa em tempo útil ou em unidades de tempo configuradas.

#### Scenario: Latência de 2 dias úteis
- **WHEN** um vínculo FS tem latência de 2 dias úteis
- **THEN** o sucessor começa 2 dias úteis depois do término do predecessor, pulando o não útil

#### Scenario: Antecipação
- **WHEN** um vínculo tem antecipação de 1 dia
- **THEN** o sucessor pode iniciar 1 dia antes do término do predecessor

### Requirement: Criação de vínculo por interface
O sistema SHALL permitir criar vínculos pelo Gantt (arrastar do manipulador da barra), pela coluna de predecessores da Task Sheet e pelo formulário de detalhes, com o mesmo resultado.

#### Scenario: Criação pela coluna
- **WHEN** o usuário digita o número WBS de um predecessor na coluna correspondente
- **THEN** o vínculo FS com lag zero é criado e as datas são recalculadas

### Requirement: Remoção de vínculo
O sistema SHALL permitir remover vínculos por seleção e tecla de exclusão, pelo formulário de detalhes ou por menu de contexto, mantendo as datas atuais das tarefas até o recálculo.

#### Scenario: Remover vínculo
- **WHEN** o usuário remove um vínculo
- **THEN** o predecessor some da coluna e as datas são recalculadas sem a restrição

### Requirement: Validação de vínculos
O sistema SHALL recusar vínculos inválidos (ciclo, tarefa inexistente, vínculo duplicado) informando o motivo e não alterando nada.

#### Scenario: Vínculo duplicado
- **WHEN** o usuário tenta criar o mesmo vínculo duas vezes
- **THEN** a operação é recusada sem duplicar o registro

### Requirement: Cadeia condutora
O sistema SHALL identificar, para qualquer tarefa, o conjunto de predecessores que efetivamente determina sua data e permitir inspecioná-la no painel de detalhes.

#### Scenario: Inspecionar motivos
- **WHEN** o usuário abre a inspeção de uma tarefa com três predecessores, sendo um deles com folga
- **THEN** apenas o predecessor determinante aparece como condutor, com a explicação do cálculo

### Requirement: Sincronização com a Task Sheet
O sistema SHALL refletir imediatamente vínculos criados ou removidos na coluna de predecessores, no Gantt e no formulário de detalhes.

#### Scenario: Criação pelo Gantt
- **WHEN** o usuário cria um vínculo arrastando no Gantt
- **THEN** a coluna de predecessores da grade é atualizada na mesma interação
