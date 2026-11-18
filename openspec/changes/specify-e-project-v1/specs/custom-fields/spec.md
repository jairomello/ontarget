# Spec Delta

## Purpose

Define campos personalizados e códigos de estrutura, permitindo estender tarefas, recursos e projeto com dados próprios, fórmulas, listas e indicadores gráficos.

## ADDED Requirements

### Requirement: Criação de campos personalizados
O sistema SHALL permitir criar campos para tarefa, recurso e projeto com os tipos texto, número, data, duração, custo, sinalizador, fórmula e lista de valores.

#### Scenario: Campo de lista
- **WHEN** o usuário cria um campo de lista com os valores "Baixa", "Média", "Alta"
- **THEN** ele aparece como coluna editável na Task Sheet com seletor correspondente

### Requirement: Fórmulas em campos
O sistema SHALL avaliar fórmulas usando apenas funções predefinidas e operadores suportados, sem execução de código arbitrário, aplicando o resultado como valor calculado.

#### Scenario: Fórmula condicional
- **WHEN** o usuário cria um campo fórmula `IIF([Duração] > 5d, "Longo", "Curto")`
- **THEN** o valor é calculado para cada tarefa e atualizado quando a duração muda

#### Scenario: Expressão proibida
- **WHEN** o usuário tenta usar uma função inexistente ou código externo
- **THEN** a expressão é rejeitada com indicação do problema e nada é gravado

### Requirement: Indicadores gráficos
O sistema SHALL permitir definir regras que exibem um ícone na coluna de indicadores conforme o valor do campo, com prioridade de regra e estado sem correspondência.

#### Scenario: Prioridade de regra
- **WHEN** duas regras são atendidas simultaneamente
- **THEN** é exibido o ícone da regra de maior prioridade

### Requirement: Edição e exclusão de campos
O sistema SHALL permitir renomear, reconfigurar e excluir campos, informando onde estão em uso e preservando os valores históricos no histórico de alterações.

#### Scenario: Campo em uso
- **WHEN** o usuário tenta excluir um campo usado em 40 tarefas
- **THEN** ele é avisado da contagem e confirma antes da remoção

### Requirement: Códigos de estrutura (WBS)
O sistema SHALL gerar automaticamente o número WBS por nível e permitir definir códigos personalizados com máscara por nível, validando duplicidades.

#### Scenario: Máscara personalizada
- **WHEN** o usuário define a máscara `A.00.00.00`
- **THEN** os códigos gerados seguem a máscara e a coluna de código torna-se editável

#### Scenario: Duplicidade detectada
- **WHEN** o usuário digita um código já usado por outra tarefa
- **THEN** a edição é recusada com aviso de duplicidade

### Requirement: Coluna de campo personalizado
O sistema SHALL exibir campos personalizados como colunas na Task Sheet, editáveis inline conforme seu tipo, com os mesmos atalhos dos campos nativos.

#### Scenario: Editar campo custom na grade
- **WHEN** o usuário digita em uma coluna de campo personalizado
- **THEN** o valor é validado pelo tipo e aplicado à tarefa

### Requirement: Campos personalizados de projeto e recurso
O sistema SHALL permitir editar campos de projeto nas propriedades e de recurso no painel de recursos, além de expô-los na grade quando aplicável.

#### Scenario: Campo de recurso
- **WHEN** o usuário cria um campo de recurso do tipo texto
- **THEN** ele é editável na folha de recursos
