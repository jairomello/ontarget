# Spec Delta

## Purpose

Define a Timeline (linha do tempo) exibida no topo das visualizações, oferecendo uma visão resumida do projeto e controlando o intervalo de tempo mostrado no Gantt.

## ADDED Requirements

### Requirement: Timeline visível por padrão
O sistema SHALL exibir a Timeline no topo das visualizações principais por padrão, permitindo ocultá-la e restaurá-la, mantendo a preferência por visão.

#### Scenario: Nova visão
- **WHEN** o usuário abre um projeto novo
- **THEN** a Timeline aparece acima da Task Sheet e do Gantt

### Requirement: Adicionar tarefas à Timeline
O sistema SHALL permitir adicionar tarefas e marcos à Timeline por arrastar da Task Sheet ou por comando, mantendo a ordem e a cor do agrupamento de origem.

#### Scenario: Adição por arraste
- **WHEN** o usuário arrasta uma tarefa da grade para a Timeline
- **THEN** um card compacto com o nome e o período da tarefa aparece na Timeline

### Requirement: Recorte do intervalo exibido
O sistema SHALL permitir arrastar as extremidades da Timeline para ampliar ou restringir o intervalo de tempo exibido no Gantt, com opção de sincronizar os dois.

#### Scenario: Recortar para um trimestre
- **WHEN** o usuário ajusta a Timeline para um trimestre com sincronização ativa
- **THEN** o Gantt passa a exibir apenas aquele intervalo

### Requirement: Personalização visual
O sistema SHALL permitir alterar cor, rótulo e tipo de exibição (barra, faixa ou card) de cada item da Timeline.

#### Scenario: Colorir por fase
- **WHEN** o usuário atribui uma cor a uma fase na Timeline
- **THEN** o item é exibido na cor escolhida em claro e em escuro

### Requirement: Exportação da Timeline
O sistema SHALL permitir exportar a Timeline como imagem PNG e copiá-la para a área de transferência, preservando as cores e os rótulos.

#### Scenario: Copiar para apresentação
- **WHEN** o usuário usa "Copiar Timeline"
- **THEN** a imagem fica disponível na área de transferência e pode ser colada em um documento

### Requirement: Imprimir a Timeline
O sistema SHALL incluir a Timeline na página impressa quando ela estiver visível, com a mesma escala e legenda do restante da página.

#### Scenario: Impressão com Timeline
- **WHEN** o usuário imprime com a Timeline visível
- **THEN** ela aparece no topo da página impressa, sem cortes
