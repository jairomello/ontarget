# Architecture — e-project

Arquitetura técnica do e-project (v1).
Complementa `docs/PRD.md` e `docs/Design.md`.

- Versão: 0.1
- Runtime: **Bun** · Banco: **SQLite** · UI: **React + CSS** · Motor: **TypeScript puro**

---

## 1. Visão geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Browser (React 19)                            │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────────┐  │
│  │  UI Shell    │   │  Features    │   │  Store (Zustand + Immer)   │  │
│  │  ribbon,     │──▶│  gantt,      │──▶│  domain (undoável)         │  │
│  │  status bar  │   │  tasksheet,  │   │  computed (schedule, cache)│  │
│  │  portfolio   │   │  timeline…   │   │  ui (seleção, zoom, tema)  │  │
│  └──────────────┘   └──────┬───────┘   └─────────────┬──────────────┘  │
│                            │                          │                 │
│                   ┌────────▼────────┐        ┌────────▼────────┐       │
│                   │  Gantt Renderer │        │  Scheduler      │       │
│                   │  (SVG + virtual)│        │  (Web Worker)   │       │
│                   └─────────────────┘        └────────┬────────┘       │
└───────────────────────────────────┬─────────────────────┴──────────────┘
                                    │  REST (fetch, batched, debounced)
┌───────────────────────────────────▼──────────────────────────────────────┐
│                          Bun + Hono (HTTP)                               │
│   routes → services → repositories → Drizzle ORM → SQLite (bun:sqlite)   │
│   + serving do build estático do client                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Regras de dependência (em uma frase):** `core` não importa nada de `server`/`client`; `server` não importa `client`; `client` importa `core` e `shared`. Violação disso é bug de arquitetura.

---

## 2. Stack e justificativa

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Runtime/pacotes | **Bun** | runtime + test runner + package manager + servidor em um binário; `bun:sqlite` nativo (sem compilar addon) |
| Servidor HTTP | **Hono** | ultraleve, tipado, roda nativamente no Bun (`Bun.serve({ fetch: app.fetch })`), sem middleware legacy |
| ORM/migrações | **Drizzle ORM + drizzle-kit** | schema em TS, SQL gerado previsível, migrações versionadas, driver `bun-sqlite` |
| Banco | **SQLite** (arquivo único `e-project.db`) | transacional, sem servidor, backup = copiar 1 arquivo |
| UI | **React 19 + TypeScript** | composição, ecosistema, hooks para o Gantt |
| Build | **Vite** | dev server rápido, build estático servido pelo Hono |
| Estilos | **CSS Modules + design tokens (CSS vars)** | controle total do visual do Gantt; sem runtime de classe dinâmica |
| Estado | **Zustand + Immer** | store normalizado, patches do Immer viram undo/redo e payload de persistência |
| Grade/virtualização | **@tanstack/react-virtual** (linhas) + colunas virtuais próprias | virtualização de outline síncrona com o Gantt |
| Navegação | **react-router** | rotas `/`, `/p/:projectId`, `/p/:projectId/print` |
| Testes | **bun test** (unidade) + **Playwright** (E2E) | mesmo runner do runtime; E2E pinta o Gantt real |
| Datas | **API de tempo própria em UTC-naive** (sem dayjs/moment/TZ) | ver §8.1 — evita bugs de fuso e DST |
| Worker | **Web Worker** nativo (bundler plugin) | mantém o CPM fora da thread principal |

**Decisões explícitas (e o que foi recusado):**

- ❌ Biblioteca de Gantt pronta (`dhtmlx-gantt`, `frappe-gantt`, `gantt-task-react`) — acabamento insuficiente e pouco controle sobre escala/zoom.
- ❌ Tailwind — tokens em CSS vars são mais adequados a um grid denso com centenas de regras de estado.
- ❌ TanStack Table como base da grade — o outline síncrono + edição inline + sync com Gantt exigem controle próprio (a virtualização sim é reaproveitada).
- ❌ Redux/Zustand persistido automaticamente — persistência é explícita e versionada (§10).

---

## 3. Estrutura do repositório

```
e-project/
├── package.json                 # workspaces: apps/* e packages/*
├── bunfig.toml
├── tsconfig.base.json
├── docs/                        # PRD.md · Design.md · architecture.md
├── templates/                   # templates de importação (json/csv) e de projeto
│   ├── import/planilha-padrao.csv
│   └── projects/*.json
├── packages/
│   ├── core/                    # ⭐ domínio puro (sem I/O, sem React, sem DOM)
│   │   ├── src/
│   │   │   ├── calendar/        # calendário, turnos, exceções, duração→data
│   │   │   ├── scheduler/       # CPM, restrições, tipos de tarefa, rollup, splits
│   │   │   ├── recurrence/      # recorrência diária/semanal/mensal
│   │   │   ├── leveling/        # superalocação (v1: detecção; v2: resolução)
│   │   │   ├── wbs/             # árvore/outline: indent, outdent, move, renumber (§7.3), outline codes, máscaras
│   │   │   ├── custom-fields/   # tipos, fórmulas, indicadores gráficos
│   │   │   ├── cost/            # custo por atribuição, rollups, baseline deltas
│   │   │   ├── filters/         # filtros, grupos, ordenação
│   │   │   ├── io/              # parse/serialize JSON e CSV + validação
│   │   │   └── types.ts
│   │   └── tests/
│   ├── shared/                  # tipos DTO + constantes usados por server e client
│   └── design-system/           # tokens, componentes base, ícones
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts         # Bun.serve + Hono
│   │   │   ├── routes/          # projects, sync, baselines, library, import, export
│   │   │   ├── services/        # regras de aplicação (transações)
│   │   │   ├── repos/           # acesso a dados (Drizzle)
│   │   │   ├── db/
│   │   │   │   ├── schema.ts
│   │   │   │   └── migrations/
│   │   │   └── static.ts        # serve o build do client
│   │   └── tests/
│   └── web/
│       ├── src/
│       │   ├── app/             # shell, rotas, providers, tema
│       │   ├── store/           # domainStore, computedStore, uiStore, history
│       │   ├── workers/scheduler.worker.ts
│       │   ├── features/
│       │   │   ├── portfolio/
│       │   │   ├── tasksheet/   # §7 — VirtualGrid, cells, commands/keymap, clipboard
│       │   │   ├── gantt/       # §9
│       │   │   ├── timeline/
│       │   │   ├── team/        # Team-Panel
│       │   │   ├── details/     # Task Form + Task Inspector
│       │   │   ├── tracking/    # baselines, status date, progress line
│       │   │   ├── customfields/
│       │   │   ├── import-export/
│       │   │   └── print/
│       │   ├── ui/              # componentes do design system
│       │   ├── styles/          # tokens.css, base.css, themes
│       │   └── lib/             # api client, keyboard, dom utils
│       └── tests/
└── e2e/                         # Playwright
```

---

## 4. Modelo de dados (SQLite)

### 4.1 Princípios

- IDs: `TEXT` UUIDv7 (ordenáveis por tempo, gerados no client — permite criar offline).
- Datas: `INTEGER` epoch ms em **relógio UTC-naive** (ver §8.1).
- Durações/trabalho: `INTEGER` ms de **tempo útil** (não relógio de parede).
- Booleans: `INTEGER` 0/1. JSON estruturado: `TEXT` + validação na borda.
- Integridade referencial com `ON DELETE CASCADE` nas relações de projeto.

### 4.2 Esquema

```sql
-- Portfólio
projects(
  id TEXT PK, name TEXT, code TEXT, color TEXT,
  start INTEGER, finish INTEGER, status_date INTEGER,
  calendar_id TEXT FK→calendars,
  default_task_type TEXT,           -- fixed_duration|fixed_work|fixed_units
  default_scheduling_mode TEXT,     -- manual|auto
  percent_complete REAL, budget REAL,
  notes TEXT, archived INTEGER, template_key TEXT,
  created_at INTEGER, updated_at INTEGER);

-- Biblioteca global (Global.MPT) — visões/filtros/calendários reutilizáveis
library_items(id TEXT PK, kind TEXT, name TEXT, project_id TEXT NULL, config TEXT, created_at INTEGER);
-- kinds: view | filter | group | sort | calendar | outline_code | table

calendars(
  id TEXT PK, project_id TEXT NULL, name TEXT,
  is_default INTEGER, weekly_mask INTEGER,   -- bits seg..dom
  working_hours_start TEXT, working_hours_end TEXT);

calendar_exceptions(
  id TEXT PK, calendar_id TEXT, date INTEGER,
  is_working INTEGER, name TEXT,
  start_time TEXT NULL, end_time TEXT NULL);   -- turnos especiais

-- Tarefas (árvore por parent_id + ordenação explícita)
tasks(
  id TEXT PK, project_id TEXT, parent_id TEXT NULL,
  outline_level INTEGER, outline_number TEXT,   -- "1.2.4"
  sort_order INTEGER,
  name TEXT, notes TEXT,
  is_summary INTEGER, is_milestone INTEGER, is_inactive INTEGER,
  scheduling_mode TEXT,                        -- manual|auto
  is_placeholder INTEGER,
  task_type TEXT, effort_driven INTEGER,
  constraint_type TEXT, constraint_date INTEGER,
  deadline INTEGER,
  manual_start INTEGER, manual_finish INTEGER, manual_duration INTEGER,
  start INTEGER, finish INTEGER,               -- calculados (cache)
  duration INTEGER, duration_unit TEXT,        -- calculados
  work INTEGER, cost REAL, fixed_cost REAL,
  actual_start INTEGER, actual_finish INTEGER,
  actual_duration INTEGER, actual_work INTEGER, actual_cost REAL,
  percent_complete REAL, physical_percent REAL,
  duration_estimated INTEGER,
  priority INTEGER,                            -- 1..1000
  calendar_id TEXT NULL,
  wbs_code TEXT,                              -- outline code custom, se houver
  recurrence TEXT NULL,                       -- JSON: {freq, interval, until, count, byDay}
  segments TEXT NULL,                         -- JSON: [{start, finish}] splits
  created_at INTEGER, updated_at INTEGER);

task_links(
  id TEXT PK, project_id TEXT,
  predecessor_id TEXT, successor_id TEXT,
  type TEXT,                                  -- fs|ss|ff|sf
  lag_ms INTEGER,                             -- negativo = lead
  cross_project_ref TEXT NULL,                -- referência externa (v1: somente leitura)
  UNIQUE(predecessor_id, successor_id, type));

-- Recursos e equipes
teams(id TEXT PK, name TEXT, color TEXT, sort_order INTEGER);
resources(
  id TEXT PK, project_id TEXT, team_id TEXT NULL,
  name TEXT, initials TEXT, color TEXT,
  type TEXT,                                  -- work (v1) | material | cost | budget
  max_units REAL,                             -- ex.: 1.0 = 100%
  standard_rate REAL, cost_per_use REAL,
  calendar_id TEXT NULL, email TEXT, active INTEGER, notes TEXT);

assignments(
  id TEXT PK, project_id TEXT, task_id TEXT, resource_id TEXT,
  units REAL, work INTEGER, cost REAL,
  actual_work INTEGER, actual_cost REAL,
  start INTEGER, finish INTEGER,
  proposed INTEGER, notes TEXT,
  UNIQUE(task_id, resource_id));

-- Baselines e planos provisórios
baselines(id TEXT PK, project_id TEXT, name TEXT, kind TEXT, saved_at INTEGER, scope TEXT);
baseline_values(
  baseline_id TEXT, task_id TEXT,
  start INTEGER, finish INTEGER, duration INTEGER, work INTEGER, cost REAL,
  PRIMARY KEY(baseline_id, task_id));

-- Campos personalizados
custom_fields(
  id TEXT PK, project_id TEXT, entity_type TEXT,  -- task|resource|project
  name TEXT, data_type TEXT,                     -- text|number|date|duration|cost|flag|formula|list
  formula TEXT NULL, config TEXT,               -- lista de valores, máscara, formato
  show_indicator INTEGER, indicator_rules TEXT,
  sort_order INTEGER);

custom_field_values(
  field_id TEXT, entity_id TEXT,
  value_text TEXT, value_num REAL, value_date INTEGER,
  PRIMARY KEY(field_id, entity_id));

-- Histórico de alterações (alimenta o change highlighting)
change_log(
  id INTEGER PK AUTOINCREMENT, project_id TEXT,
  entity_type TEXT, entity_id TEXT, field TEXT,
  old_value TEXT, new_value TEXT, changed_at INTEGER);

-- Recuperação após crash (snapshots periódicos)
snapshots(id TEXT PK, project_id TEXT, payload TEXT, created_at INTEGER);

-- Templates de importação
import_templates(id TEXT PK, name TEXT, format TEXT, mapping TEXT, sample TEXT);
```

**Índices principais**

```sql
CREATE UNIQUE INDEX ix_tasks_proj_order ON tasks(project_id, sort_order);
CREATE INDEX ix_tasks_parent        ON tasks(project_id, parent_id);
CREATE INDEX ix_tasks_outline       ON tasks(project_id, outline_number);
CREATE INDEX ix_links_pred          ON task_links(predecessor_id);
CREATE INDEX ix_links_succ          ON task_links(successor_id);
CREATE INDEX ix_assign_task         ON assignments(task_id);
CREATE INDEX ix_assign_resource     ON assignments(resource_id);
CREATE INDEX ix_log_project_time    ON change_log(project_id, changed_at);
```

**Visões de conveniência (SQL):** `v_project_summary` (contagem de tarefas, %, datas min/max) para o portfólio sem carregar tudo.

### 4.3 Export do domínio (aggregate)

`GET /api/projects/:id` devolve **um aggregate** (projeto + tasks + links + resources + assignments + baselines + custom fields + views). O client carrega tudo na abertura — o app é local, não há ganho em paginação; a virtualização resolve a renderização.

---

## 5. API HTTP

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/health` | heartbeat |
| GET | `/api/projects` | lista do portfólio (via `v_project_summary`) |
| POST | `/api/projects` | cria (aceita `templateKey`) |
| GET | `/api/projects/:id` | aggregate completo |
| PATCH | `/api/projects/:id` | metadados do projeto |
| DELETE | `/api/projects/:id` | excluir (soft = `archived`) |
| POST | `/api/projects/:id/duplicate` | duplicar (deep copy de tudo) |
| POST | `/api/projects/:id/sync` | **batch** de upserts/deletes (ver §10) |
| POST | `/api/projects/:id/baselines` | salvar baseline/interim |
| DELETE | `/api/projects/:id/baselines/:baselineId` | apagar baseline |
| GET | `/api/projects/:id/export?format=json\|csv\|print` | exportar |
| POST | `/api/import/preview` | parse + validação, retorna relatório de erros |
| POST | `/api/import/commit` | aplica o lote validado (transação) |
| GET | `/api/library?kind=…` · POST/PATCH/DELETE `/api/library/:id` | biblioteca global |
| GET | `/api/templates` · `/api/templates/import` | templates de projeto/importação |

**Convenções:** JSON puro, erros `{ error: { code, message, details? } }`, tudo em transação única, `If-Match` opcional com `updated_at` para detectar conflito (single-user → apenas aviso).

---

## 6. Fluxo de dados (o caminho de uma edição)

```
1. Usuário digita "3d" na célula Duração
        │
2. uiStore → domainStore.patch(taskId, { duration: 3d })
        │   Immer produz [patch, inversePatch]
        ├──────────────► history.push({patch, inversePatch})   ← Ctrl+Z
        ├──────────────► dirty.mark(taskId)                   ← persistência
        └──────────────► scheduler.request()  (debounce 40ms, coalesced)
        │
3. Web Worker: schedule(domainSnapshot) → ScheduleResult
        │   { dates, floats, criticalSet, rollups, overallocations, conflicts }
        │
4. computedStore.merge(ScheduleResult)   ← não é undoável
        │
5. Render: Gantt lê { task.rect, link.path } de computedStore + domainStore
        │
6. sync loop (debounce 800ms): POST /api/projects/:id/sync com os dirty
        │   → Drizzle transação → SQLite → dirty.clear()
```

Pontos-chave:
- **Toda entrada passa pela camada de comandos** (§7.2): atalho, menu de contexto e botão da ribbon produzem o **mesmo** comando → mesmo patch → mesmo undo. Não há "atalho que faz outra coisa".
- **Undo opera só no domínio**; o schedule é sempre derivado (nunca é salvo como verdade).
- **Autosave é idempotente**: reenviar o mesmo lote não duplica nada (UPSERT por PK).
- **Nunca perder seleção/scroll**: os stores de UI são separados do domínio.

---

## 7. Task Sheet, WBS e camada de comandos

A Task Sheet (grade à esquerda do Gantt) é a **superfície primária de edição**. Regra de produto: nada de rotina exige abrir o Task Form; tudo é feito inline, preferencialmente por teclado (`PRD` RF-06.5b–g).

### 7.1 Estrutura do módulo

```
features/tasksheet/
├── VirtualGrid.tsx          # janelamento de linhas + colunas sticky + scroll compartilhado
├── rows/                    # linha outline: seta, indentação, resumo, contadores
├── cells/                   # editors por tipo: text, date, duration, percent, cost, flag, list, formula
├── commands/                # ⭐ registry de comandos (teclado + menu + toolbar)
│   ├── keymap.ts            # atalhos → id de comando, com escopo (grid | gantt | global)
│   ├── structure.ts         # indent, outdent, move, insert, delete, toggle
│   ├── edit.ts              # commit, cancel, paste, fillDown, clear
│   └── navigation.ts        # célula, intervalo, página, extremos, busca
├── clipboard.ts             # copiar/colar multi-célula (TSV) compatível com Excel
└── hooks/                   # useCellEditor, useSelection, useOutline, useColumnState
```

**Regras de dependência do módulo:** importa `domainStore`, `uiStore` e `@core/wbs`; nunca escreve direto no store — sempre emite um **comando**.

### 7.2 Camada de comandos (teclado)

Todo atalho vira um `Command` com `id`, `when` (escopo/condição), `run(ctx)` e `label` (para o overlay `?` e a paleta `Ctrl+K`).

```ts
interface Command {
  id: string;                       // "wbs.indent"
  scope: 'grid' | 'gantt' | 'global';
  label: string;                    // "Indentar (Ctrl+Shift+Right)"
  keys?: string[];                  // sequência de binding
  when?: (ctx: CommandContext) => boolean;
  run(ctx: CommandContext): void;   // emite patch(s) no domainStore
}
```

- **Um único foco ativo por vez** (`grid` | `gantt`), alternável por `F6`; a barra de status mostra o escopo ativo e o overlay `?` lista só aqueles atalhos.
- **Guarda de modo de edição**: enquanto uma célula estiver em edição, nenhum comando de navegação/estrutura é disparado — digitar `-`, `+`, `Tab` ou uma seta tem o comportamento do campo.
- Comandos são **unitários para undo**: `wbs.indent` em um bloco de 5 linhas = 1 passo.
- O mesmo comando é acionável por teclado, menu de contexto e barra de comandos — **uma implementação só**.

### 7.3 Operações de estrutura (`packages/core/wbs`)

Funções **puras** sobre a árvore normalizada (`parent_id` + `sort_order`), retornando patches do Immer:

```ts
indent(tasks, ids):        { patches, inverse } | { error: 'no-previous-sibling' }
outdent(tasks, ids):       { patches, inverse } | { error: 'root-level' }
moveWithinLevel(tasks, id, dir):  { patches, inverse }
insertSibling(tasks, id, position): { patches, inverse }   // above|below
insertChild(tasks, parentId, position): { patches, inverse }
deleteSubtree(tasks, ids, mode):  'delete-children' | 'promote-children'
renumber(tasks):           outline_level + outline_number recalculados ("2.1.3")
```

Invariantes garantidas e testadas:

1. Indentar usa o **irmão anterior** como novo pai; sem irmão anterior → erro amigável (`Não há tarefa anterior para indentar`), **nenhuma alteração**.
2. Outdent promove para o nível do avô; bloqueado na raiz.
3. Seleção múltipla preserva a **ordem relativa** do bloco e move os descendentes junto.
4. `outline_number` é sempre recalculado em qualquer mutação de árvore (nunca editado à mão, exceto quando há *outline code* customizado — aí tem precedência e validação de duplicidade).
5. Ciclo impossível (tarefa não pode ser descendente de si mesma) → rejeitado.
6. Tarefas **inativas** e **resumos** movem como qualquer outra, mantendo seus atributos.

### 7.4 Edição inline

- Editors por tipo de célula com **commit/validate/cancel** padronizados (`Enter`/`Tab` descem/avançam, `Esc` cancela, `Ctrl+Enter` mantém).
- **Digitação direta**: o primeiro caractere substitui o conteúdo e abre o editor (comportamento Excel).
- **Validação na borda**: valor inválido mantém a célula em edição com `--danger` + motivo; nada é gravado.
- **Colar em lote**: o clipboard usa TSV — `Ctrl+V` de uma matriz do Excel cria/atribui as células; colar na coluna `Nome` cria as tarefas; **um único undo** para toda a operação.
- Cada commit gera um patch no `domainStore` → o mesmo ciclo do `PRD` §6 (worker recalcula, `sync` persiste).

### 7.5 Hierarquia: recolher/expandir

- Estado de expansão fica em **`uiStore.collapsed: Set<TaskId>`** (não é domínio → não entra no undo, não vai para o SQLite; é persistido **por visão** em `library_items`).
- Ao expandir, a seleção é restaurada e a rolagem é ancorada na linha visível mais próxima.
- **Sincronia com o Gantt**: as linhas visíveis vêm de uma única função pura `visibleRows(domain, collapsed, filter, group, sort)` usada pelos dois componentes — nunca podem divergir.
- Recalcular `visibleRows` é barato (uma passada com memoização por hash de entrada); só roda quando `collapsed`/`filter`/`sort`/árvore mudam, não a cada scroll.

### 7.6 Testes deste módulo

| Tipo | O que cobre |
| --- | --- |
| Unitário (`bun test`) | `core/wbs` — todas as invariantes da §7.3, inclusive erros e seleção múltipla |
| Unitário | keymap: cada atalho → comando certo no escopo certo; nenhum comando disparado em modo de edição |
| Componente | editors de célula (commit, validação, Escape), clipboard TSV, colar em lote com 1 undo |
| E2E (Playwright) | cenários `PRD` §8.1 (11–20): indent/outdent em bloco, expand/collapse, colar do Excel, `F4`/`Esc` |

---

## 8. Motor de agendamento (`packages/core/scheduler`)

### 8.1 Relógio do projeto (decisão importante)

Todas as datas são **UTC-naive**: epoch ms tratados como "data/hora local do projeto", **nunca** convertidos para o fuso do navegador. Isso elimina classes inteiras de bugs (DST, horário de verão, troca de fuso) e reproduz o modelo do MS Project, que trabalha com séries de data sem fuso.

- Exibição: formatar `Date` em UTC (`getUTCFullYear` etc.) com fuso fixo `+00:00`.
- Conversão de entrada do usuário (`10/12`, `+2d`): interpretar como data local do projeto, gravar como UTC-naive.
- Regra de ouro: **nenhum `toLocaleString` sem `timeZone: 'UTC'`**.

### 8.2 Calendários

- Semana padrão: máscara de 7 bits + turno (`09:00`–`18:00` com intervalo).
- Exceções: feriado (dia não útil), dia útil especial, turno especial.
- API do módulo:

```ts
// calendar.ts
type Duration = number; // ms de tempo útil

addWorkingTime(cal, dateMs, duration): DateMs
subtractWorkingTime(cal, dateMs, duration): DateMs
durationBetween(cal, startMs, endMs): Duration        // só tempo útil
isWorkingTime(cal, dateMs): boolean
nextWorkingMoment(cal, dateMs): DateMs
workingDaysBetween(cal, startMs, endMs): number       // para exibição "5d"
```

Durações são arredondadas para a unidade configurada (h/dia/semana/mês) **pelo calendário**, não por aritmética de relógio.

### 8.3 Pipeline de cálculo

```
snapshot do domínio
  ├─ 1. expandir recorrências            → ocorrências
  ├─ 2. excluir inativas do cálculo      → conjunto ativo
  ├─ 3. construir grafo de dependências  → topological sort (detecta ciclos)
  ├─ 4. roll-up de resumos               → datas mín/máx dos filhos (modo top-down respeita datas manuais do resumo)
  ├─ 5. forward pass (CPM)               → early start/finish por tipo de tarefa, restrições, calendário
  ├─ 6. backward pass                    → late start/finish, float total, float livre
  ├─ 7. critical path                    → float total == 0 (múltiplos caminhos suportados)
  ├─ 8. tracking                         → desvio vs baseline, atraso vs status date, % propagation
  ├─ 9. resources                        → unidades × trabalho, superalocação por período
  └─ 10. conflicts                       → restrição vs link, deadline excedido, link a ciclo, datas inconsistentes
```

**Regras de agendamento (resumo):**

| Regra | Comportamento |
| --- | --- |
| Tarefa **manual** | datas fixas pelo usuário; **não** é movida; **propaga** suas datas aos sucessores |
| Tarefa **automática** | calculada por CPM |
| **Placeholder** | parcialmente calculada: campos ausentes ficam "pendentes" (marcador `?`) |
| **Inativa** | fora do cálculo, roll-up e leveling; dados preservados |
| **Fixed Duration** | `work = duration × Σunits` |
| **Fixed Work** | `duration = work / Σunits` |
| **Fixed Units** | `units` preservados, `duration` e `work` derivam |
| **Effort-driven** | adicionar recurso mantém `work` e reduz `duration` |
| **Resumo top-down** | datas manuais do resumo vencem o roll-up; aviso visual de divergência |
| **Splits** | segmentos agregados; `duration` = soma dos segmentos |
| **Restrições duras** (`Must Start On`…) | vencem o CPM e geram conflito registrado |
| **Ciclo** | não recalcula; expõe erro por aresta no painel de alertas |

**Contrato de tipos (simplificado):**

```ts
interface ScheduleInput {
  project: ProjectSnapshot;
  tasks: TaskSnapshot[];
  links: LinkSnapshot[];
  resources: ResourceSnapshot[];
  assignments: AssignmentSnapshot[];
  baselines: BaselineSnapshot[];
}

interface ScheduleResult {
  dates: Record<TaskId, { start: DateMs; finish: DateMs; duration: Duration }>;
  floats:  Record<TaskId, { total: Duration; free: Duration }>;
  rollups: Record<TaskId, { start: DateMs; finish: DateMs; divergent: boolean }>;
  critical: Set<TaskId>;
  chains:   Record<TaskId, { driving: TaskId[] }>;      // Task Inspector
  overalloc: Record<ResourceId, { from: DateMs; to: DateMs; demand: number }[]>;
  conflicts: Conflict[];                                 // restrições, deadlines, ciclos
  warnings:  Warning[];
}
```

- Função **pura**: mesma entrada → mesma saída; testável com `bun test`.
- Executada em **Web Worker**; a troca usa `structuredClone` de arrays tipados (nada de objetos profundos por item).
- **Incremental (v1.1)**: restringir o recálculo ao subgrafo afetado (ancestrais + descendentes). O contrato já permite `schedule(input, { onlyFor: TaskId[] })`.

### 8.4 Paridade com o MS Project

Cenários de referência do PRD §8 viram fixtures (`packages/core/scheduler/fixtures/*.json`) com entrada esperada **e** saída esperada, extraída do MS Project 2010. Teste de paridade roda em CI.

---

## 9. Gantt (`apps/web/src/features/gantt`)

### 9.1 Módulos

```
gantt/
├── timeScale.ts        # puro: pxPerDay ↔ data, ticks, displayUnit, snap
├── geometry.ts         # puro: retângulo da barra, path do link, colisões
├── layout.ts           # puro: linhas visíveis, faixas, agrupamento
├── render/
│   ├── GridLayer.tsx       # linhas, não-útil (CSS gradient / pattern)
│   ├── BarLayer.tsx        # summary, task, milestone, baseline, progresso
│   ├── LinkLayer.tsx       # paths ortogonais + setas (SVG)
│   ├── MarkerLayer.tsx     # hoje, status date, deadline, restrições
│   └── OverlayLayer.tsx    # seleção, guias de drag, preview de link, marquee
├── interactions/
│   ├── dragMove.ts · dragResize.ts · createLink.ts · marquee.ts · keyboard.ts
├── GanttView.tsx       # composição + sincronia com Task Sheet
└── hooks/              # useScale, useRows, useDrag, useTooltip
```

### 9.2 Pipeline de renderização

```
domainStore + computedStore
   │
   ├─ timeScale(pxPerDay, viewWindow)      → x(dateMs) · dateMs(x) · ticks[]
   ├─ layout(rows, viewTop, viewBottom)     → rowsVisible[] + y(row)
   │      (linhas virtualizadas com @tanstack/react-virtual)
   ├─ culling temporal                      → só barras/links que intersectam viewWindow
   │
   └─ camadas (SVG, uma <g> por camada)
         1 grid  2 não-útil  3 barras  4 progresso  5 links  6 marcadores  7 overlay
```

**Decisões de performance:**

- Barras e links em **SVG** (vetor, nítido em qualquer DPR, hit-testing nativo) — o grid de fundo e a sombra de não-útil usam CSS (mais barato de redesenhar).
- **Duas dimensões de virtualização**: linhas (DOM) e colunas/tempo (culling por intervalo de datas).
- O cabeçalho de escala é um elemento separado com **scroll horizontal compartilhado** (via `scrollLeft` espelhado, sem re-render).
- Zoom/pan não disparam re-render de React no `rAF`: um store de `viewWindow` (mutable, assinado por `useSyncExternalStore`) + `requestAnimationFrame` no layer de grade.
- Barras movidas interpolam posição em 200 ms (`transform: translateX`) — ver `Design.md` §11.
- **Budget**: ≤ 8 ms de scripting por frame com 2.000 linhas; medido por `performance.measure` em teste E2E.

### 9.3 Escala (`timeScale.ts`)

```ts
interface TimeScale {
  pxPerDay: number;            // contínuo: 1.5 .. 4000
  displayUnit: 'hour'|'day'|'week'|'month'|'quarter'|'year';
  x(dateMs: number): number;
  dateMs(x: number): number;
  ticks(): { major: Tick[]; minor: Tick[]; header: HeaderBand[] };
  snap(dateMs: number, unit: SnapUnit): DateMs;
}
```

- `pxPerDay` → `displayUnit` pela tabela de `Design.md` §7.1.
- Ticks **sempre em unidades de calendário inteiras** (início do mês/semana/dia) — nunca "15 de novembro" no meio de uma célula.
- Regra de arredondamento de `x()`: alinhar a meio pixel quando `pxPerDay` não for inteiro (`Math.round(x * dpr) / dpr`).
- Presets, ajuste ao projeto/seleção, zoom no ponteiro: implementados em `useScale`.

### 9.4 Geometria de links (`geometry.ts`)

- Saída/entrada por tipo (FS/SS/FF/SF) conforme `Design.md` §6.3.
- Caminho ortogonal com raio de canto 5px (`arcTo`), desvio mínimo de 8px quando cruza a própria barra alvo.
- Lag/lead viram segmento horizontal extra com rótulo.
- Hit area do link: `stroke-width` largo invisível (12px) + stroke visível fino — clica-se fácil sem depender de precisão.
- Pré-computado por tarefa visível; cacheado por `(predId, succId, xScale)`.

### 9.5 Interações

| Ação | Implementação |
| --- | --- |
| Mover barra | `pointerdown` → captura de ponteiro → `setPointerCapture` → guia vertical + snap → `pointerup` aplica patch no domainStore |
| Redimensionar | handles de 6px nas bordas, só em tarefas manuais/ajustáveis |
| Criar link | handle direito → preview `dashed` → drop em barra → `POST` no domainStore |
| Seleção | clique, Shift (intervalo), Ctrl (múltiplo), marquee com Shift+drag no fundo |
| Zoom | `Ctrl+wheel` centrado no ponteiro, presets, slider da barra de status |
| Teclado | navegação por células/tempo, `+/-` outline, `F2` editar, `Ctrl+Z/Y` |

Todas as ações passam por um **comando** (ver §10) → undo funciona para cada uma.

---

## 10. Estado, undo/redo e persistência

### 10.1 Stores

```ts
domainStore    // entidades normalizadas: tasks, links, resources, assignments, baselines…
               // ÚNICO dono do estado editável · undoável · serializável
computedStore  // schedule result, caches de geometria, resumos do portfólio
uiStore        // seleção, foco (grid|gantt), collapsed: Set<TaskId>, view ativa, zoom, tema, densidade, painéis
historyStore   // pilha de {patch, inversePatch} (limitada a 100 passos)
```

### 10.2 Undo/redo com patches do Immer

```ts
const [next, patches, inversePatches] = produceWithPatches(state, draft => { ... });
history.push({ patches, inversePatches });   // Ctrl+Z → aplica inversePatches
                                            // Ctrl+Y → reaplica patches
```

- Comandos granulares (inserir tarefa, vincular, mover) envolvem **múltiplos patches** e entram na pilha como uma unidade.
- Histórico em memória (sessão) + snapshot periódico (`snapshots` table, últimos 5) para recuperação após crash.
- Undo **nunca** mexe em `computedStore` (sempre recalculado).

### 10.3 Persistência (batched sync)

```
dirty: Set<entityKey>                       // preenchida pelos patches
   │ debounce 800ms
   ▼
POST /api/projects/:id/sync
   { upserts: { tasks: [...], task_links: [...], assignments: [...] },
     deletes: { tasks: [ids], ... } }
   │
   ▼
Drizzle transaction → SQLite → dirty.clear()
```

- Se um novo patch chegar durante o envio, o lote seguinte cobre (nada é perdido; `dirty` só é limpo para os itens confirmados).
- Falha de rede/gravidade → toast com "Tentar novamente"; dados permanecem no store.
- `change_log` é gravado pelo servidor no mesmo `sync` (alimenta o change highlighting).

---

## 11. Importação, exportação, impressão

### 11.1 JSON (formato nativo, versionado)

```json
{
  "format": "e-project",
  "version": 1,
  "exportedAt": "2026-11-13T14:00:00.000Z",
  "project": { "...": "..." },
  "tasks": [ { "id": "...", "wbs": "1.2", "name": "...", "...": "..." } ],
  "taskLinks": [], "resources": [], "assignments": [],
  "baselines": [], "customFields": [], "calendars": []
}
```

- Round-trip garantido por teste (`export → import → deep equal`).
- Migração por `version` (funções `migrate_v1_to_v2` acumulativas).

### 11.2 CSV

- `POST /api/import/preview`: detecta delimitador (`;`/`,`/`\t`), encoding (UTF-8/1/8-Latin1), cabeçalho; aplica o **mapping** (coluna → campo); devolve `{ rows, errors, warnings, sample }`.
- Mapeamento persistido em `import_templates` (template padrão em `templates/import/`).
- Linhas com erro são listadas com número e motivo; opções: pular, corrigir no preview, abortar.
- **Export CSV** protege contra injeção de planilha: valores iniciando em `= + - @` recebem `'` na frente; separador configurável (`;` padrão pt-BR).

### 11.3 Impressão/PDF

- Rota `/p/:projectId/print` renderiza o **print root** (componente isolado, sem interação) com:
  - cabeçalho/rodapé (nome, período, data, página N/M), legenda, escala de tempo fixa ou auto,
  - colunas selecionadas, repetição de cabeçalho, quebras de página por fase.
- CSS `@media print` com `@page { size: A4 landscape; margin: 12mm }`.
- `Ctrl+P` nativo do navegador → PDF.
- (Opcional, fase final) PDF server-side via Playwright/Chromium headless para fidelidade de alta volume.

---

## 12. Segurança e robustez (app local, mas sério)

- SQLite sempre com **queries parametrizadas** (Drizzle) — sem concatenação de SQL.
- **Fórmulas de campos personalizados**: interpretador próprio com funções whitelisted (`IF`, `IIF`, `ABS`, `SUM`, `NOW`, aritmética). **Nunca `eval`/`new Function`**. Profundidade e tamanho de expressão limitados.
- Limites de entrada: nome ≤ 500 chars, notas ≤ 50 KB, importação ≤ 50k linhas (com aviso).
- Export: escaping CSV/JSON correto (nada de `</script>` injetável em JSON embutido).
- Tratamento de erro global: boundary React + toast + log em `console` + endpoint `/api/health`.

---

## 13. Testes

| Nível | Ferramenta | Escopo |
| --- | --- | --- |
| Unitário | `bun test` | `packages/core` (calendário, CPM, WBS, recorrência, custos, filtros, IO) |
| Paridade | `bun test` | fixtures do MS Project 2010 (PRD §8) |
| Contrato | `bun test` | rotas Hono com SQLite em memória (`:memory:`) |
| Componente | `bun test` + happy-dom | células da grade, timeScale, geometry |
| Comandos/teclado | `bun test` | keymap → comando, guarda de modo de edição, invariantes de `core/wbs` (§7.6) |
| Visual | Playwright screenshots | Gantt em 6 presets de zoom × 2 temas × 2 densidades |
| E2E | Playwright | criar projeto → estruturar WBS por teclado (PRD §8.1) → vincular → baseline → tracking → PDF |
| Performance | Playwright + `performance.measure` | budget de 8 ms/frame e 300 ms de CPM |

Alvos de cobertura: `packages/core` ≥ 90%, app ≥ 60%.

---

## 14. Orçamentos de performance

| Métrica | Orçamento |
| --- | --- |
| Scripting por frame (zoom/pan, 2.000 linhas) | ≤ 8 ms |
| Tecla → render na Task Sheet (navegação, indent, expand) | ≤ 16 ms (1 frame) |
| Recálculo CPM (5.000 tarefas) | ≤ 300 ms (worker) |
| Abertura de projeto (5.000 tarefas) | ≤ 1,5 s (p95) |
| `sync` local (500 linhas alteradas) | ≤ 100 ms |
| Bundle JS inicial (gzip) | ≤ 220 KB |
| Memória com projeto de 5.000 tarefas | ≤ 300 MB |

---

## 15. Roadmap técnico (alinhado ao PRD §10)

| Fase | Entregas de arquitetura |
| --- | --- |
| **F0** | Monorepo, Hono + Drizzle + migrações, tokens/CSS, shell, portfólio, api client |
| **F1** | `domainStore` + history, **camada de comandos + keymap (§7.2)**, `core/wbs` (§7.3), `VirtualGrid` com edição inline/colar em lote, expand/collapse sincronizado, Task Form sob demanda, sync batched → grade operável 100% por teclado, com undo em cada ação estrutural |
| **F2** | `timeScale`, `geometry`, camadas do Gantt, virtualização 2D, drag/link, presets de zoom |
| **F3** | `core/calendar`, `core/scheduler` (CPM + restrições + tipos + inativos + placeholder + recorrência + splits), Web Worker, Task Inspector, testes de paridade |
| **F4** | Recursos/equipes, assignments, Team-Panel, superalocação |
| **F5** | Baselines, status date, tracking, progress line, alertas, change highlighting |
| **F6** | Campos custom + fórmulas, filtros/grupos/tabelas/visões, biblioteca global |
| **F7** | Timeline view, impressão/PDF, import/export JSON/CSV |
| **F8** | Acessibilidade, i18n, performance, docs, CI, E2E visual |

---

## 16. Riscos técnicos e decisões abertas

| # | Risco / decisão | Posição atual |
| --- | --- | --- |
| 1 | Paridade de agendamento com o MS Project | Mitigado por fixtures de paridade (§8.4); é o principal critério de release |
| 2 | Gantt degrada com > 2.000 tarefas | Virtualização 2D + culling + camadas isoladas; medir desde F2 |
| 3 | CPM no worker vs. principal | Worker desde o início (custo baixo, benefício garantido) |
| 4 | Undo em operações estruturais (indentar nó inteiro) | Comandos com inverse explícito; testar os 10 passos mais comuns |
| 5 | Conflito de teclado entre grade, Gantt e modo de edição | Escopo de foco único (`grid`/`gantt`, `F6`) + guarda que bloqueia atalhos durante edição de célula (§7.2); keymap coberto por testes |
| 6 | Recalcular tudo a cada edição | v1 completo, v1.1 incremental (`schedule(input, { onlyFor })`) |
| 7 | Impressão fiel a PDF | CSS `@media print` primeiro; Chromium headless só se insuficiente |
| 8 | Nível de detalhe dos calendários/turnos | V1: semanal + exceções + 1 turno/dia; turnos múltiplos entram se os testes exigirem |
| 9 | Dependência entre projetos | Fora do escopo v1; campo `cross_project_ref` já reservado no schema |
