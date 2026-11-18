# Spec Delta

## Purpose

Define a entrada e saída de dados do projeto em JSON e CSV, com templates, mapeamento de colunas, validação e round-trip garantido.

## ADDED Requirements

### Requirement: Template de importação publicado
O sistema SHALL disponibilizar um template padrão de importação em JSON e CSV, baixável, com as colunas e formatos esperados documentados.

#### Scenario: Download do template
- **WHEN** o usuário abre a importação
- **THEN** ele pode baixar o template CSV e o JSON de exemplo antes de preencher

### Requirement: Detecção automática do arquivo
O sistema SHALL detectar automaticamente o delimitador, a codificação e o cabeçalho do CSV, e aceitar JSON no formato versionado do produto.

#### Scenario: CSV com ponto e vírgula
- **WHEN** o usuário envia um CSV separado por ponto e vírgula com acentos
- **THEN** as colunas são reconhecidas corretamente sem configuração manual

### Requirement: Mapeamento de colunas
O sistema SHALL oferecer etapa de mapeamento entre colunas do arquivo e campos do produto, sugerindo correspondências automáticas e permitindo ajuste manual.

#### Scenario: Coluna renomeada
- **WHEN** o arquivo usa "Início" em vez de "Start"
- **THEN** a correspondência é sugerida e pode ser confirmada ou alterada

### Requirement: Pré-validação com relatório de erros
O sistema SHALL validar o arquivo antes de aplicar, informando número de linhas válidas, linhas com erro, linha e motivo de cada erro, e permitindo exportar o relatório.

#### Scenario: Linhas inválidas
- **WHEN** 3 de 120 linhas têm data inválida
- **THEN** o sistema lista as 3 linhas com o motivo e oferece importar apenas as válidas

### Requirement: Importação transacional
O sistema SHALL aplicar a importação em uma única transação, substituindo ou mesclando os dados conforme a escolha do usuário, sem deixar projeto em estado parcial.

#### Scenario: Falha durante a importação
- **WHEN** a aplicação falha no meio
- **THEN** nada é alterado e o usuário pode tentar novamente

### Requirement: Exportação round-trip
O sistema SHALL exportar o projeto completo em JSON compatível com a própria importação, de modo que exportar e importar reproduza o mesmo projeto.

#### Scenario: Round-trip
- **WHEN** o usuário exporta um projeto e o importa novamente
- **THEN** tarefas, vínculos, recursos, atribuições, baselines e campos personalizados são idênticos

### Requirement: Exportação CSV do escopo visível
O sistema SHALL exportar em CSV exatamente as linhas e colunas visíveis na visão ativa, respeitando filtros, agrupamento e ordenação.

#### Scenario: Exportar com filtro
- **WHEN** o usuário exporta com filtro de tarefas em atraso
- **THEN** o CSV contém apenas essas tarefas, nas colunas exibidas

### Requirement: Proteção contra injeção em CSV
O sistema SHALL neutralizar valores que iniciem com `=`, `+`, `-` ou `@` ao exportar CSV para evitar fórmulas maliciosas em planilhas.

#### Scenario: Nome com sinal de igual
- **WHEN** uma tarefa se chama `=1+1`
- **THEN** o CSV exporta o valor de forma que a planilha não o execute como fórmula

### Requirement: Importação em massa com limite
O sistema SHALL aceitar até 50.000 linhas em uma importação, avisando antes de processar arquivos que excedam esse limite.

#### Scenario: Arquivo grande
- **WHEN** o arquivo tem 80.000 linhas
- **THEN** o sistema avisa e pede confirmação antes de prosseguir
