# Design — specify-e-project-v1

## Context

O projeto é greenfield: não existe código em `docs/` além dos documentos de planejamento (`PRD.md`, `Design.md`, `architecture.md`), que descrevem um clone web do MS Project 2010 rodando localmente em Bun + SQLite. As 17 capacidades desta change são novas — não há specs anteriores nem comportamento legado a preservar.

Restrições que moldam a abordagem:

- Aplicação **single-user e local** (decisão do usuário): sem autenticação, sem tempo real, sem servidor remoto.
- **Múltiplos projetos + portfólio** com persistência entre sessões.
- Paridade de agendamento com o MS Project 2010 é critério de release, não desejo.
- O Gantt deve ser **próprio** (acabamento e controle de escala/zoom incompatíveis com bibliotecas prontas).
- Experiência de edição **inline e por teclado** na grade; formulário de detalhes apenas sob demanda.
- Interface moderna (tema claro/escuro, densidade ajustável, animações discretas).

## Goals / Non-Goals

**Goals:**

- Estruturar o código em módulos que espelham exatamente as 17 capacidades das specs, para que cada requisito tenha um dono claro.
- Garantir que o motor de agendamento seja **puro, testável isoladamente e comparável** ao MS Project 2010 por fixtures.
- Manter 60 fps no Gantt com 2.000 linhas e recálculo ≤ 300 ms em 5.000 tarefas.
- Permitir que qualquer ação do usuário (inclusive estruturais em lote) seja um único passo de undo e um único lote de persistência.
- Deixar o caminho aberto para multiusuário/tempo real futuros sem reescrita do domínio.

**Non-Goals:**

- Não implementar autenticação, colaboração simultânea ou sincronização com serviços externos.
- Não suportar arquivos `.mpp` nativos no v1.
- Não construir nivelamento automático completo nem análise de valor agregado completa.
- Não otimizar para milhares de usuários concorrentes — o alvo é uma instância local.

## Decisions

### D1 — Monorepo com camada de domínio isolada

**Decisão:** `packages/core` (domínio puro, sem I/O, sem React, sem DOM), `packages/shared` (DTOs), `apps/server` (Hono + Drizzle + SQLite), `apps/web` (React + Vite).

**Por quê:** a paridade de agendamento exige testes determinísticos sem mockar nada; isolar o domínio permite rodar a suíte de paridade em `bun test` puro.

**Alternativas descartadas:** app único com domínio dentro do frontend (não testável sem DOM); backend com lógica de agendamento (transferiria datas pela rede a cada tecla e perderia fluidez).

### D2 — Relógio UTC-naive para todas as datas

**Decisão:** datas são epoch ms tratados como "data/hora local do projeto", exibidos e manipulados sempre em UTC, sem converter para o fuso do navegador.

**Por quê:** reproduz o modelo do MS Project (séries sem fuso) e elimina classes inteiras de bugs de horário de verão e troca de fuso.

**Alternativas descartadas:** `Date` local com conversão (quebra em DST); bibliotecas de fuso (complexidade sem ganho em app local).

### D3 — Agendamento puro executado em Web Worker

**Decisão:** o pipeline (expandir recorrências → filtrar inativas → grafo → roll-up → forward/backward → crítica → tracking → conflitos) roda em worker a partir de um snapshot do domínio, devolvendo um `ScheduleResult` derivado.

**Por quê:** mantém a thread principal livre (60 fps) e mantém o schedule **nunca** como fonte de verdade — ele é sempre recalculável, o que simplifica undo e persistência.

**Alternativas descartadas:** cálculo síncrono na thread principal (trava o zoom em projetos grandes); persistir datas calculadas como dados (cria divergência entre fonte de verdade e estado derivado).

### D4 — Estado em três stores: domínio, derivado e UI

**Decisão:** `domainStore` (único dono do editável, undoável, serializável), `computedStore` (resultado do schedule e caches), `uiStore` (seleção, foco, zoom, tema, `collapsed`).

**Por quê:** separar derivado de editável evita que undo toque em cálculos, e separar UI evita que trocar de tema ou rolar gere persistência ou undo.

**Alternativa descartada:** store único (qualquer ação gera efeitos colaterais indesejados em undo e save).

### D5 — Undo por patches com inversos, agrupados por comando

**Decisão:** toda alteração passa por uma camada de comandos que produz patch + patch inverso; ações estruturais em múltiplas tarefas geram **um** registro.

**Por quê:** é o que permite "indentar 5 tarefas = 1 Ctrl+Z", além de reutilizar o mesmo caminho para atalho, menu e toolbar.

**Alternativas descartadas:** snapshots completos (custo de memória alto); undo por re-execução (frágil com dados externos).

### D6 — Persistência em lote idempotente com debounce

**Decisão:** alterações marcam entidades como sujas; após 800 ms um único `POST /sync` envia upserts e deletes por chave primária em transação única; falha mantém as entidades sujas e retenta.

**Por quê:** local não precisa de páginação nem de sincronização em tempo real; lote idempotente tolera reenvio.

**Alternativa descartada:** endpoint por entidade (muitas requisições, ordem não garantida).

### D7 — Gantt próprio em camadas com virtualização em duas dimensões

**Decisão:** camadas independentes (grid, tempo não útil, barras, progresso, links, marcadores, overlay); linhas virtualizadas por janela de DOM e colunas/tempo por culling de intervalo; escala contínua `pxPerDay` com unidade de exibição derivada.

**Por quê:** é a única forma de atingir o acabamento visual exigido mantendo 60 fps; camadas isoladas permitem redesenhar só o que mudou.

**Alternativas descartadas:** bibliotecas de Gantt (acabamento e escala insuficientes); canvas único (texto e acessibilidade piores, hit-testing manual).

### D8 — Grade virtual própria com sincronia por função pura

**Decisão:** `visibleRows(domínio, collapsed, filtro, agrupamento, ordenação)` é a única fonte de linhas da Task Sheet **e** do Gantt; a seleção e o escopo de foco (`grid`/`gantt`) são compartilhados.

**Por quê:** a especificação exige linhas idênticas nos dois painéis; uma função só torna a divergência impossível.

### D9 — Limites de capacidade fixados no domínio

**Decisão:** v1 trabalha apenas com recursos de trabalho (pessoas), até 11 baselines, até 50.000 linhas por importação, até 500 caracteres em nomes, fórmulas avaliadas por interpretador com funções predefinidas (nunca `eval`).

**Por quê:** cada limite está ligado a um requisito das specs (`resources`, `tracking`, `import-export`, `custom-fields`) e evita superfícies de ataque e de complexidade sem valor no escopo.

### D10 — Impressão via CSS de impressão com raiz dedicada

**Decisão:** rota de impressão renderiza um componente isolado sem interação, com `@media print` e `@page`; geração server-side de PDF só se o resultado do navegador for insuficiente.

**Por quê:** entrega imediata com fidelidade boa e sem dependência pesada; a alternativa (Chromium headless) pode ser adicionada sem mudar specs.

## Risks / Trade-offs

- **[Divergência de datas vs. MS Project]** → suíte de paridade com fixtures extraídas do MS Project 2010, rodando em CI desde a primeira versão do motor; qualquer regressão bloqueia o merge.
- **[Gantt degrada acima de 2.000 tarefas]** → virtualização 2D desde o início (não como otimização futura), medição contínua de frame time e orçamento de 8 ms de scripting por quadro.
- **[Camada de comandos vira um ponto único de falha]** → keymap coberto por testes que verificam "atalho → comando → mesmo patch do menu".
- **[Undo de ações estruturais complexas]** → invariantes de árvore testadas em `core/wbs` antes de qualquer UI; undo é sempre o inverso exato do patch.
- **[Banco local corrompido por fechamento abrupto]** → transações atômicas + até 5 snapshots por projeto + recuperação oferecida na abertura.
- **[Escopo amplo em uma change só]** → o plano de migração é incremental por fases (abaixo), cada uma com verificação executável; nada é "meio implementado e publicado".
- **[Fórmulas de campos personalizados como vetor de injeção]** → interpretador próprio, sem `eval`, com limite de profundidade e de tamanho de expressão.
- **[Trade-off: densidade de specs vs. velocidade]** → specs escritas como contrato testável; onde houver ambiguidade residual, o cenário prevalece sobre a interpretação.

## Migration Plan

Como é um projeto novo, não há migração de dados; o "deploy" é a sequência de fases, cada uma com verificação:

1. **F0 — Fundação**: monorepo, Hono + Drizzle + migrações, tokens de tema, shell, portfólio → app abre e gerencia projetos.
2. **F1 — Task Sheet**: stores + camada de comandos + grade virtual com edição inline, hierarquia e formulário sob demanda → planejamento textual completo por teclado.
3. **F2 — Gantt core**: escala, camadas, virtualização 2D, barras, links, zoom e arrastar-e-soltar → visualização interativa.
4. **F3 — Agendamento**: calendários, motor CPM, restrições, tipos, inativos, placeholders, recorrência, splits + suíte de paridade verde.
5. **F4 — Recursos**: equipes, atribuições, painel de equipe, superalocação.
6. **F5 — Tracking**: baselines, data de status, progresso, Tracking Gantt, linha de progresso, alertas.
7. **F6 — Personalização**: campos custom, fórmulas, indicadores, filtros/grupos/visões, biblioteca global.
8. **F7 — Saída**: Timeline, impressão/PDF, import/export JSON/CSV.
9. **F8 — Polimento**: acessibilidade, i18n, performance, E2E visual, documentação de atalhos.

**Rollback:** por ser local e sem dependência externa, cada fase é revertível pelo controle de versão; o schema do banco é versionado por migrações com passo reversível ou recriação (dados de demonstração não são críticos).

**Estratégia de verificação contínua:** a suíte de paridade (`scheduling`) e os cenários de interface do PRD §8.1 passam a rodar em CI a partir de F3 e não podem regredir.

## Open Questions

Nenhuma que altere specs, abordagem ou o plano de tarefas. Pontos adiáveis sem impacto:

- Valores exatos dos tokens de cor (escolha de Design.md §2, ajustável sem mudar comportamento).
- Adicionar geração de PDF server-side via Chromium headless, se o `@media print` não bastar (D10 já prevê a porta de entrada).
- Nível de granularidade dos turnos múltiplos por dia em calendários (v1 mantém um turno por dia; specs não exigem mais).
