# Proposal — specify-e-project-v1

## Why

O e-project não tem nenhuma spec: o conhecimento de produto está espalhado em `docs/PRD.md`, `docs/Design.md` e `docs/architecture.md`, sem um contrato verificável do que o sistema deve fazer. Sem specs em `openspec/specs/`, não há como medir paridade com o MS Project 2010, validar aceitação nem evoluir o produto sem reabrir decisões já tomadas. Esta change cria o baseline de especificação do **v1 completo**, derivado dos documentos existentes, para que a implementação (F0–F8) tenha requisitos, cenários e critérios de aceite rastreáveis.

## What Changes

- Cria o inventário inicial de capacidades do produto (nenhuma existe hoje em `openspec/specs/`).
- Especifica o **v1 completo** do e-project: aplicação web single-user (Bun + SQLite + React) com experiência de planejamento inspirada no MS Project 2010 e visual renovado.
- Cobre desde a fundação (portfólio, persistência, histórico) até as capacidades centrais (WBS/Task Sheet, Gantt com zoom e escala, motor de agendamento, calendários, dependências), passando por recursos, tracking, personalização, visualizações, import/export e impressão.
- Fixa como requisitos verificáveis as decisões já acordadas: sem login, múltiplos projetos + portfólio, relógio UTC-naive, Gantt próprio (sem biblioteca de terceiros), edição inline com teclado e formulário de detalhes sob demanda.
- Introduz os critérios de **paridade com o MS Project 2010** (cenários de agendamento e de interface) como requisitos de aceitação.

Sem alterações de comportamento em capacidades existentes — não há specs anteriores.

## Capabilities

### New Capabilities

- `portfolio`: ciclo de vida dos projetos — criar (vazio ou template), abrir, duplicar, arquivar, excluir, metadados, resumo de portfólio (% , datas, contagens).
- `persistence`: persistência local em SQLite, autosave em lote idempotente, recuperação após falha, snapshots e integridade referencial.
- `editing-history`: undo/redo global e unitário por comando, cobrindo edições de estrutura, dados, dependências e atribuições.
- `task-structure`: árvore de tarefas — WBS/outline, indentar/outdentar, ordenar, recolher/expandir, tarefas-resumo, marcos, inativas e de espaço reservado.
- `task-sheet`: a grade de tarefa como superfície primária de edição — edição inline, navegação e atalhos de teclado, colunas, seleção, clipboard.
- `gantt-view`: o gráfico de Gantt — barras, links, cabeçalho de escala, zoom contínuo, escala, interações, sincronia com a Task Sheet e acabamento visual.
- `timeline-view`: a linha do tempo no topo das visualizações — seleção de tarefas, recorte do intervalo, personalização e exportação.
- `calendars`: calendários de projeto, tarefa e recurso — dias úteis, turnos, exceções e tempo não útil.
- `scheduling`: o motor de agendamento — agendamento manual/automático, CPM, restrições, prazos, tipos de tarefa, esforço, splits, recorrência, roll-up e caminho crítico.
- `task-dependencies`: dependências entre tarefas — criação e remoção de vínculos, tipos FS/SS/FF/SF, lag/lead, validação de ciclos e cadeia condutora.
- `resources`: recursos e equipes — pessoas pré-cadastradas, atribuições, unidades, custo, superalocação e painel de equipe.
- `tracking`: acompanhamento e controle — baselines múltiplos, planos provisórios, data de status, % e valores reais, Tracking Gantt, linha de progresso e alertas.
- `custom-fields`: campos personalizados (tipos, fórmulas, listas, indicadores gráficos) e códigos de estrutura/WBS.
- `views-and-filters`: visões, tabelas, filtros, agrupamentos, ordenações e biblioteca global reutilizável entre projetos.
- `import-export`: importação de JSON/CSV com template e mapeamento, validação com relatório de erros, e exportação round-trip.
- `printing`: layout de impressão e geração de PDF com escala de tempo, cabeçalho, rodapé e legenda.
- `ui-shell`: o invólucro da aplicação — tema claro/escuro, densidade, layout dividido, escopos de foco, paleta de comandos, overlay de atalhos e acessibilidade.

### Modified Capabilities

Nenhuma — `openspec/specs/` está vazio (baseline inicial do projeto).

## Impact

- **Documentos**: `docs/PRD.md`, `docs/Design.md` e `docs/architecture.md` passam a ser a fonte das specs; divergências futuras serão resolvidas em changes, não por edição silenciosa.
- **Código (fase de apply)**: criação do monorepo Bun (`packages/core`, `packages/shared`, `apps/server`, `apps/web`) — nenhum código existente é afetado.
- **API**: novos endpoints REST (`/api/projects*`, `/api/library`, `/api/import`, `/api/export`).
- **Banco**: novo arquivo SQLite com o esquema de `docs/architecture.md` §4.
- **Dependências novas**: Hono, Drizzle ORM + drizzle-kit, React 19, Vite, Zustand + Immer, @tanstack/react-virtual, react-router, Playwright.
- **Fora de escopo do v1** (registrado para não reabrir): autenticação, multiusuário, tempo real, Project Server/PWA/timesheets, sync SharePoint, recursos material/custo complexo, nivelamento automático completo, EVM completo, Visual Reports Excel/Visio, leitura/escrita nativa de `.mpp`.
