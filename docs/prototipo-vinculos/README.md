# Protótipo — vínculos do Gantt

Protótipo **HTML puro** (um arquivo, sem build e sem dependências) para validar o
roteamento das linhas de conexão entre barras antes de portar a solução para a
aplicação.

## Como abrir

```bash
xdg-open docs/prototipo-vinculos/index.html
```

Ou servir a pasta:

```bash
python3 -m http.server 4010 --directory docs/prototipo-vinculos
# → http://localhost:4010/index.html
```

## O que o protótipo simula

O shell da aplicação (barra de marca, ribbon, timeline, filtros, grade com as
23 tarefas do projeto de demonstração, cabeçalho temporal, sombreamento de
fins de semana, grade e barra de status) — com o roteamento dos vínculos como
único ponto em refino.

## Como funciona o roteamento

1. **Pontos de conexão.** Cada barra expõe quatro pontos invisíveis —
   `left`, `right`, `top`, `bottom`. A linha **nasce e morre exatamente** em um
   deles (como em um programa de desenho vetorial): o caminho é construído a
   partir das coordenadas do ponto, nunca "solto" no espaço.
   O botão **Pontos de conexão** mostra os pontos; os verdes são os efetivamente
   usados pelos vínculos existentes.

2. **Semântica por tipo.** Para `FS` a origem pode sair por `right`/`top`/`bottom`
   e o destino aceita `left`/`top`/`bottom`; `SS`, `FF` e `SF` trocam os lados
   obrigatórios (o protótipo usa `FS`, como a aplicação).

3. **Candidatos.** Para cada par de pontos o gerador produz todas as polilinhas
   ortogonais possíveis:
   | origem → destino | caminhos | curvas |
   |---|---|---|
   | alinhados | reta | 0 |
   | horizontal → vertical | `H-V` | 1 |
   | vertical → horizontal | `V-H` | 1 |
   | horizontal → horizontal | `H-V-H` (2 calhas) | 2 |
   | vertical → vertical | `V-H-V` | 2 |

4. **Custo e escolha.** Cada candidato recebe `curvas × PESO + extensão`, com
   penalidade alta para caminhos que atravessariam barras (colisão por segmento
   contra os retângulos). Ganha o menor custo; empates são resolvidos pelo menor
   número de vértices.

5. **Desenho.** O caminho vira `path` SVG com cantos arredondados (mesma
   técnica do `roundedPath` de `packages/core/src/gantt/geometry.ts`) e seta no
   final via `marker-end`.

## Controles

| Controle | O que faz |
|---|---|
| **Política** | `menos curvas primeiro` (padrão), `menos comprimento primeiro`, `clássico` (sempre borda→borda, como o MS Project) |
| **Zoom** | 14 / 26 / 52 / 120 px por dia |
| **Pontos de conexão** | mostra os4 pontos de cada barra (verde = em uso) |
| **Candidatos** | desenha todos os caminhos avaliados (tracejado) e o vencedor (verde) |
| **Nº de curvas** | rótulo `1↕` / `2↕` sobre cada linha |

O rodapé e o cartão de dica mostram a distribuição por nº de curvas — é a
métrica de aceite: **quanto menos curvas, melhor**.

## Resultado atual (política padrão,26 px/dia)

```
21 vínculos ·16 com1 curva ·4 com2 curvas ·0 com3+
```

Validação numérica: os21 caminhos começam e terminam exatamente em um ponto
de conexão de uma barra (`startAttached:21`, `endAttached:21`, `detached: []`).

## Próximos passos (portar para a aplicação)

- [x] `linkGeometry()` em `packages/core/src/gantt/geometry.ts` gerou os
      candidatos e passou a escolher por custo (contrato dos testes em
      `packages/core/tests/geometry.test.ts` atualizado).
- [x] `GanttView.tsx` ganhou as camadas de pontos de conexão implícitas (as
      barras viram `obstacles`), o `marker-end` da seta, o rótulo de latência e
      os atributos `data-from` / `data-to` / `data-curves`.
- [x] Política fixada em `menos curvas primeiro` (`CURVE_PENALTY = 40`).
- [x] Bug corrigido no caminho: `yOf()` não compensava o `scrollMargin` do
      virtualizador — os vínculos ficavam uma faixa acima das barras; o corpo
      do Gantt também passou a subtrair o cabeçalho e a compensar a barra de
      ferramentas do Task Sheet, alinhando grade e Gantt.

Validação final na aplicação: `bun test` (395), `bun run typecheck` e a suíte
Playwright (50/50) verdes.
