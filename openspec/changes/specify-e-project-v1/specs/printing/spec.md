# Spec Delta

## Purpose

Define a saída impressa do projeto em PDF, com controle de página, escala de tempo, cabeçalho, rodapé, legenda e colunas visíveis.

## ADDED Requirements

### Requirement: Pré-visualização de impressão
O sistema SHALL oferecer uma pré-visualização dedicada, sem interação, mostrando como as páginas serão impressas antes de gerar o PDF.

#### Scenario: Abrir impressão
- **WHEN** o usuário aciona imprimir
- **THEN** a pré-visualização exibe as páginas com margens, cabeçalho, rodapé e legenda

### Requirement: Cabeçalho e rodapé configuráveis
O sistema SHALL permitir configurar o conteúdo do cabeçalho (nome do projeto, período, marca) e do rodapé (data, página N de M, autor), com os campos disponíveis.

#### Scenario: Páginas numeradas
- **WHEN** o projeto gera 4 páginas
- **THEN** cada página exibe "Página X de 4" no rodapé

### Requirement: Escala de tempo na impressão
O sistema SHALL oferecer escala automática (ajustar à página), ajuste à largura da página e escala fixa, mantendo as divisões de calendário inteiras.

#### Scenario: Ajustar à página
- **WHEN** o projeto inteiro deve caber em uma página
- **THEN** a escala é reduzida até caber, com datas ainda legíveis e sem cortar barras

### Requirement: Repetição de cabeçalho de colunas
O sistema SHALL repetir o cabeçalho da tabela em todas as páginas quando a listagem é multipla.

#### Scenario: Segunda página
- **WHEN** as tarefas continuam na segunda página
- **THEN** o cabeçalho de colunas é repetido no topo dela

### Requirement: Seleção de conteúdo
O sistema SHALL permitir escolher quais colunas e quais visões entram na impressão, incluindo Timeline, Task Sheet, Gantt e formulário de detalhes.

#### Scenario: Imprimir só o Gantt
- **WHEN** o usuário desmarca a Task Sheet
- **THEN** a pré-visualização mostra apenas o Gantt com as colunas escolhidas

### Requirement: Legenda
O sistema SHALL incluir legenda explicando os tipos de barra (tarefa, resumo, marco, baseline, crítica, inativa) e as marcações de tempo não útil.

#### Scenario: Legenda presente
- **WHEN** qualquer conteúdo é impresso
- **THEN** a legenda aparece na última página, sem ocupar espaço das barras

### Requirement: Orientação e formato de página
O sistema SHALL permitir retrato e paisagem em tamanhos A4, A3 e carta, respeitando as margens configuradas.

#### Scenario: Paisagem em A3
- **WHEN** o usuário escolhe A3 paisagem
- **THEN** o Gantt usa a largura total da página na escala escolhida

### Requirement: Geração de PDF
O sistema SHALL gerar PDF a partir da pré-visualização com o conteúdo selecionado, preservando cores, fontes e alinhamentos.

#### Scenario: Exportar PDF
- **WHEN** o usuário confirma a geração
- **THEN** um arquivo PDF é baixado com todas as páginas configuradas
