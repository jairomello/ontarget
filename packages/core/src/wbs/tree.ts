/**
 * Operações puras sobre a árvore de tarefas (WBS).
 *
 * Fonte de verdade: lista em pré-ordem com `parentId` e `sortOrder`
 * (índice entre os irmãos). Todas as funções são puras — devolvem uma nova
 * lista e nunca mutam a entrada — e respeitam as invariantes de
 * docs/architecture.md §7.3.
 */

export interface WbsNode {
  id: string;
  parentId: string | null;
  sortOrder: number;
  outlineLevel: number;
  outlineNumber: string;
}

export type WbsErrorCode =
  | "no-previous-sibling"
  | "root-level"
  | "not-found"
  | "would-create-cycle"
  | "empty";

export type WbsResult =
  | { ok: true; nodes: WbsNode[]; changed: string[] }
  | { ok: false; error: WbsErrorCode };

export interface WbsInsertResult {
  ok: true;
  nodes: WbsNode[];
  parentId: string | null;
  sortOrder: number;
  outlineLevel: number;
  outlineNumber: string;
  changed: string[];
}

export type InsertPosition = "above" | "below";

interface Graph {
  byId: Map<string, WbsNode>;
  /** Filhos por parentId (null = raiz), ordenados por sortOrder. */
  children: Map<string | null, WbsNode[]>;
}

function buildGraph(nodes: WbsNode[]): Graph {
  const byId = new Map<string, WbsNode>();
  const children = new Map<string | null, WbsNode[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    const key = node.parentId;
    const list = children.get(key);
    if (list) list.push(node);
    else children.set(key, [node]);
  }

  for (const list of children.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return { byId, children };
}

function previousSibling(graph: Graph, node: WbsNode): WbsNode | undefined {
  const siblings = graph.children.get(node.parentId) ?? [];
  const index = siblings.findIndex((sibling) => sibling.id === node.id);
  return index > 0 ? siblings[index - 1] : undefined;
}

/**
 * Percorre a árvore e devolve os nós em pré-ordem com nível, numeração WBS
 * e `sortOrder` recalculados.
 */
function walk(
  children: Map<string | null, WbsNode[]>,
  overrides: Map<string, Partial<WbsNode>>,
): WbsNode[] {
  const out: WbsNode[] = [];
  const counters: number[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const list = children.get(parentId) ?? [];
    counters.length = depth + 1;
    // contador de irmãos zera para cada pai novo
    counters[depth] = 0;

    list.forEach((node, index) => {
      counters[depth] = (counters[depth] ?? 0) + 1;
      const override = overrides.get(node.id) ?? {};
      const merged: WbsNode = {
        ...node,
        ...override,
        parentId,
        sortOrder: index,
        outlineLevel: depth,
        outlineNumber: counters.slice(0, depth + 1).join("."),
      };
      out.push(merged);
      visit(merged.id, depth + 1);
    });
  };

  visit(null, 0);
  return out;
}

/** Monta o novo mapa de filhos aplicando as mudanças de pai. */
function reparent(
  graph: Graph,
  moves: Map<string, { parentId: string | null; anchor: string | null }>,
): Map<string | null, WbsNode[]> {
  const next = new Map<string | null, WbsNode[]>();

  // base: filhos originais menos os que saíram
  for (const [parentId, list] of graph.children) {
    next.set(
      parentId,
      list.filter((node) => !moves.has(node.id)).map((node) => ({ ...node })),
    );
  }

  // grupos de movidos por (novo pai, âncora), preservando a pré-ordem
  const groups = new Map<string, { parentId: string | null; anchor: string | null; ids: string[] }>();
  const orderedMoves = [...moves.keys()];
  for (const id of orderedMoves) {
    const move = moves.get(id)!;
    const key = `${String(move.parentId)}|${String(move.anchor)}`;
    const group = groups.get(key) ?? { parentId: move.parentId, anchor: move.anchor, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const source = group.ids.map((id) => graph.byId.get(id)!);
    const list = next.get(group.parentId) ?? [];
    const anchorIndex = group.anchor ? list.findIndex((node) => node.id === group.anchor) : -1;

    if (anchorIndex >= 0) {
      list.splice(anchorIndex + 1, 0, ...source);
    } else {
      list.push(...source);
    }
    next.set(group.parentId, list);
  }

  return next;
}

function finish(
  graph: Graph,
  moves: Map<string, { parentId: string | null; anchor: string | null }>,
): { nodes: WbsNode[]; changed: string[] } {
  const children = reparent(graph, moves);
  const nodes = walk(children, new Map());
  const changed = [...moves.keys()];
  return { nodes, changed };
}

/* -------------------------------------------------------------------------- */
/* Indentar / outdentar                                                        */
/* -------------------------------------------------------------------------- */

export function indent(nodes: WbsNode[], ids: string[]): WbsResult {
  if (ids.length === 0) return { ok: false, error: "empty" };
  const graph = buildGraph(nodes);
  const moving = new Set(ids);

  for (const id of ids) {
    if (!graph.byId.has(id)) return { ok: false, error: "not-found" };
  }

  const moves = new Map<string, { parentId: string | null; anchor: string | null }>();

  for (const id of ids) {
    const node = graph.byId.get(id)!;
    // nó cujo pai também se move: acompanha o pai, sem reancorar
    if (node.parentId !== null && moving.has(node.parentId)) continue;

    // âncora = primeiro irmão anterior que NÃO está se movendo
    let anchor = previousSibling(graph, node);
    while (anchor && moving.has(anchor.id)) anchor = previousSibling(graph, anchor);
    if (!anchor) return { ok: false, error: "no-previous-sibling" };

    moves.set(id, { parentId: anchor.id, anchor: anchor.id });
  }

  if (moves.size === 0) return { ok: true, nodes, changed: [] };
  return { ok: true, ...finish(graph, moves) };
}

export function outdent(nodes: WbsNode[], ids: string[]): WbsResult {
  if (ids.length === 0) return { ok: false, error: "empty" };
  const graph = buildGraph(nodes);
  const moving = new Set(ids);

  for (const id of ids) {
    if (!graph.byId.has(id)) return { ok: false, error: "not-found" };
  }

  const moves = new Map<string, { parentId: string | null; anchor: string | null }>();

  for (const id of ids) {
    const node = graph.byId.get(id)!;
    if (node.parentId !== null && moving.has(node.parentId)) continue;

    if (node.parentId === null) return { ok: false, error: "root-level" };

    const parent = graph.byId.get(node.parentId);
    if (!parent) return { ok: false, error: "not-found" };

    // promove para o nível do avô, logo após o pai original
    moves.set(id, { parentId: parent.parentId, anchor: parent.id });
  }

  if (moves.size === 0) return { ok: true, nodes, changed: [] };
  return { ok: true, ...finish(graph, moves) };
}

/* -------------------------------------------------------------------------- */
/* Mover dentro do nível, inserir e remover                                    */
/* -------------------------------------------------------------------------- */

export function moveWithinLevel(
  nodes: WbsNode[],
  id: string,
  direction: "up" | "down",
): WbsResult {
  const graph = buildGraph(nodes);
  const node = graph.byId.get(id);
  if (!node) return { ok: false, error: "not-found" };

  const siblings = graph.children.get(node.parentId) ?? [];
  const index = siblings.findIndex((sibling) => sibling.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return { ok: true, nodes, changed: [] };

  const reordered = [...siblings];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved!);

  const children = new Map<string | null, WbsNode[]>();
  for (const [parentId, list] of graph.children) {
    children.set(parentId, parentId === node.parentId ? reordered : list);
  }

  return { ok: true, nodes: walk(children, new Map()), changed: [id] };
}

export function insertSibling(
  nodes: WbsNode[],
  id: string,
  position: InsertPosition,
  newId: string,
): WbsInsertResult | { ok: false; error: WbsErrorCode } {
  const graph = buildGraph(nodes);
  const node = graph.byId.get(id);
  if (!node) return { ok: false, error: "not-found" };

  const siblings = graph.children.get(node.parentId) ?? [];
  const index = siblings.findIndex((sibling) => sibling.id === id);
  const insertAt = position === "above" ? index : index + 1;

  const children = new Map<string | null, WbsNode[]>();
  for (const [parentId, list] of graph.children) {
    children.set(parentId, [...list]);
  }
  const list = children.get(node.parentId)!;
  list.splice(insertAt, 0, {
    id: newId,
    parentId: node.parentId,
    sortOrder: insertAt,
    outlineLevel: node.outlineLevel,
    outlineNumber: "",
  });

  const built = walk(children, new Map());
  const created = built.find((n) => n.id === newId)!;

  return {
    ok: true,
    nodes: built,
    parentId: created.parentId,
    sortOrder: created.sortOrder,
    outlineLevel: created.outlineLevel,
    outlineNumber: created.outlineNumber,
    changed: [newId],
  };
}

export function insertChild(
  nodes: WbsNode[],
  parentId: string | null,
  newId: string,
): WbsInsertResult | { ok: false; error: WbsErrorCode } {
  const graph = buildGraph(nodes);
  if (parentId !== null && !graph.byId.has(parentId)) return { ok: false, error: "not-found" };

  const children = new Map<string | null, WbsNode[]>();
  for (const [key, list] of graph.children) children.set(key, [...list]);

  const list = children.get(parentId) ?? [];
  list.push({
    id: newId,
    parentId,
    sortOrder: list.length,
    outlineLevel: 0,
    outlineNumber: "",
  });
  children.set(parentId, list);

  const built = walk(children, new Map());
  const created = built.find((n) => n.id === newId)!;

  return {
    ok: true,
    nodes: built,
    parentId: created.parentId,
    sortOrder: created.sortOrder,
    outlineLevel: created.outlineLevel,
    outlineNumber: created.outlineNumber,
    changed: [newId],
  };
}

export interface DeleteResult {
  ok: true;
  nodes: WbsNode[];
  removed: string[];
  changed: string[];
}

/**
 * Remove subárvores. `delete-children` remove junto; `promote-children`
 * mantém os filhos, promovendo-os para o nível do pai removido.
 */
export function deleteSubtree(
  nodes: WbsNode[],
  ids: string[],
  mode: "delete-children" | "promote-children" = "delete-children",
): DeleteResult | { ok: false; error: WbsErrorCode } {
  const graph = buildGraph(nodes);
  const targets = new Set<string>();

  const collect = (id: string) => {
    if (targets.has(id)) return;
    targets.add(id);
    for (const child of graph.children.get(id) ?? []) collect(child.id);
  };

  for (const id of ids) {
    if (!graph.byId.has(id)) return { ok: false, error: "not-found" };
    if (mode === "delete-children") collect(id);
    else targets.add(id);
  }

  // Os filhos promovidos ocupam exatamente a posição do nó removido.
  const children = new Map<string | null, WbsNode[]>();
  for (const [parentId, list] of graph.children) {
    const kept: WbsNode[] = [];
    for (const node of list) {
      if (targets.has(node.id)) {
        if (mode === "promote-children") {
          kept.push(...(graph.children.get(node.id) ?? []));
        }
        continue;
      }
      kept.push({ ...node });
    }
    children.set(parentId, kept);
  }

  const built = walk(children, new Map());
  const removed = nodes.filter((node) => targets.has(node.id)).map((node) => node.id);
  const changed = ids.filter((id) => graph.byId.has(id));

  return { ok: true, nodes: built, removed, changed };
}

/** Recalcula nível e numeração WBS de toda a árvore. */
export function renumber(nodes: WbsNode[]): WbsNode[] {
  const graph = buildGraph(nodes);
  return walk(graph.children, new Map());
}
