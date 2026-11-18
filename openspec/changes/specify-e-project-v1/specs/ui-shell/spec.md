# Spec Delta

## Purpose

Define o invólucro da aplicação: tema, densidade, layout dividido, escopos de foco, paleta de comandos, overlay de atalhos, acessibilidade e comportamento responsivo.

## ADDED Requirements

### Requirement: Tema claro e escuro
O sistema SHALL oferecer tema claro, escuro e automático (seguindo o sistema), com troca imediata e persistência da preferência, mantendo contraste mínimo de 3:1 em elementos gráficos e 4,5:1 em texto.

#### Scenario: Troca imediata
- **WHEN** o usuário alterna o tema
- **THEN** toda a interface muda sem recarregar e sem perda de estado

### Requirement: Densidade de linhas
O sistema SHALL oferecer alturas de linha compacta, confortável e ampla, aplicadas à Task Sheet, ao Gantt e ao painel de equipe, com a preferência persistida.

#### Scenario: Densidade compacta
- **WHEN** o usuário escolhe densidade compacta
- **THEN** mais linhas cabem na tela e a altura das barras é proporcional

### Requirement: Layout dividido redimensionável
O sistema SHALL permitir redimensionar os divisores entre Timeline, Task Sheet, Gantt e formulário de detalhes, com larguras mínimas e persistência por visão.

#### Scenario: Divisor arrastado
- **WHEN** o usuário estreita a Task Sheet
- **THEN** o Gantt ganha largura e a configuração é lembrada na próxima abertura

### Requirement: Escopo de foco único
O sistema SHALL manter um único escopo de foco ativo entre a Task Sheet e o Gantt, alternável por `F6`, exibindo-o na barra de status.

#### Scenario: Atalho por escopo
- **WHEN** o foco está na grade, `+` recolhe a hierarquia
- **THEN** com o foco no Gantt, `+` amplia o zoom

### Requirement: Paleta de comandos
O sistema SHALL oferecer uma paleta de comandos (`Ctrl+K`) buscando ações, projetos e tarefas, executando o comando selecionado.

#### Scenario: Buscar tarefa
- **WHEN** o usuário digita parte do nome de uma tarefa na paleta
- **THEN** ela é listada e selecioná-la abre o projeto e a linha correspondente

### Requirement: Overlay de atalhos
O sistema SHALL exibir, ao pressionar `?`, a tabela de atalhos do escopo ativo, buscável e sem capturar a digitação em campos de texto.

#### Scenario: Ajuda contextual
- **WHEN** o foco está na grade e o usuário pressiona `?`
- **THEN** são listados os atalhos da grade

### Requirement: Acessibilidade por teclado e leitor de tela
O sistema SHALL expor a grade com papéis ARIA de tabela hierárquica, anunciar célula e estado por leitor de tela, manter foco visível em todos os elementos interativos e respeitar `prefers-reduced-motion` e `prefers-contrast`.

#### Scenario: Navegação sem mouse
- **WHEN** o usuário opera a aplicação apenas com teclado
- **THEN** é possível criar, editar, indentar, vincular, salvar e imprimir

#### Scenario: Movimento reduzido
- **WHEN** o sistema operacional solicita movimento reduzido
- **THEN** as animações são substituídas por mudanças imediatas

### Requirement: Estado de salvamento sempre visível
O sistema SHALL exibir na barra de aplicação o estado de salvamento (sem alterações, salvando, salvo, erro) em todas as telas.

#### Scenario: Indicador durante edição
- **WHEN** o usuário edita um campo
- **THEN** o indicador muda para "Salvando…" e depois para "Salvo" sem interromper a edição

### Requirement: Comportamento responsivo
O sistema SHALL adaptar o layout entre 1440px, 1100px, 768px e abaixo de 768px, convertendo o formulário em painel lateral, a Task Sheet em sobreposição e, em telas muito estreitas, oferecendo modo de leitura.

#### Scenario: Janela estreita
- **WHEN** a janela é reduzida para 900px
- **THEN** o formulário vira gaveta sobreposta e o Gantt permanece utilizável

### Requirement: Internacionalização de textos e datas
O sistema SHALL exibir todos os textos de interface por meio de chaves traduzíveis, com português do Brasil como idioma padrão e datas formatadas em pt-BR.

#### Scenario: Data exibida
- **WHEN** uma tarefa começa em 13 de novembro de 2026
- **THEN** a interface exibe `13/11/2026` por padrão
