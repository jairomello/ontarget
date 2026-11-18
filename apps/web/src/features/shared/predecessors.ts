import { DAY_MS, validateLink } from "@ontarget/core";
import { linkId } from "../gantt/linkRules";
import { useDomainStore } from "../../store/domainStore";
import type { LinkType, Task } from "../../store/types";

/**
 * Criação/remoção de predecessores pela coluna da Task Sheet e pelo
 * formulário (specs/task-dependencies — "Criação de vínculo por interface").
 *
 * Os três caminhos (coluna, formulário, Gantt) passam pela mesma validação
 * do domínio e geram o mesmo registro determinístico (`link:<origem>:<destino>:<tipo>`).
 *
 * Formato do campo — código WBS com sufixos opcionais (padrão MS Project):
 *
 * ```
 * 2.3        Término-Início (padrão), sem latência
 * 2.3SS      Início-Início
 * 2.3FF      Término-Término
 * 1.1SF      Início-Término
 * 4.4+2d     latência (começa2 dias depois do término do predecessor)
 * 1.1SS-1d   antecipação (lead) de1 dia
 * ```
 *
 * A ordem é sempre `<wbs><tipo><±Nd>` e cada parte é opcional.
 */

export interface PredecessorResult {
  /** Motivos de recusa em pt-BR (vazio quando tudo foi aplicado). */
  errors: string[];
}

/** Um token escrito no campo, já decomposto. */
export interface PredecessorRef {
  /** Código WBS escrito (número ou código personalizado). */
  wbs: string;
  type: LinkType;
  /** Latência em ms — negativa é antecipação (lead). */
  lagMs: number;
}

const LAG_PATTERN = /([+-])(\d+)d$/;
const TYPE_PATTERN = /(FS|SS|FF|SF)$/;
/** Sufixo de tipo mal formado (ex.: `1.1XX`). */
const BAD_TYPE_PATTERN = /[A-Z]{2}$/;

/** `1.1SS+2d` → `{ wbs: "1.1", type: "ss", lagMs: 2d }`. */
export function parsePredecessorToken(raw: string): PredecessorRef {
  let token = raw.trim();
  let lagMs = 0;
  let type: LinkType = "fs";

  const lag = token.match(LAG_PATTERN);
  if (lag) {
    lagMs = (lag[1] === "-" ? -1 : 1) * Number(lag[2]) * DAY_MS;
    token = token.slice(0, token.length - lag[0].length);
  }

  const kind = token.match(TYPE_PATTERN);
  if (kind) {
    type = kind[1]!.toLowerCase() as LinkType;
    token = token.slice(0, token.length - kind[0].length);
  }

  return { wbs: token, type, lagMs };
}

/** Reconstroi o texto do campo para um vínculo (exibição). */
export function formatPredecessorRef(task: Task, link: { type: LinkType; lagMs: number }): string {
  const wbs = task.wbsCode ?? task.outlineNumber;
  const type = link.type === "fs" ? "" : link.type.toUpperCase();
  const lag =
    link.lagMs === 0
      ? ""
      : `${link.lagMs > 0 ? "+" : "-"}${Math.round(Math.abs(link.lagMs) / DAY_MS)}d`;
  return `${wbs}${type}${lag}`;
}

/** Separa os códigos WBS escritos: "1", "1, 2.3SS", "2.3 4". */
export function parseWbsRefs(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Tarefa que possui esse código WBS (número ou código personalizado). */
function resolveWbs(tasks: Record<string, Task>): Map<string, string> {
  const byWbs = new Map<string, string>();
  for (const task of Object.values(tasks)) {
    byWbs.set(task.outlineNumber, task.id);
    if (task.wbsCode) byWbs.set(task.wbsCode, task.id);
  }
  return byWbs;
}

/**
 * Resolve um token do campo: primeiro tenta o texto como está (códigos
 * personalizados podem terminar em letras), depois com os sufixos de tipo e
 * latência destacados.
 */
function resolveToken(
  raw: string,
  byWbs: Map<string, string>,
): { ref: PredecessorRef; id: string } | { error: string } {
  const direct = raw.trim();
  const directId = byWbs.get(direct);
  if (directId) return { ref: { wbs: direct, type: "fs", lagMs: 0 }, id: directId };

  const ref = parsePredecessorToken(raw);
  const id = byWbs.get(ref.wbs);
  if (id) return { ref, id };

  const withoutLag = direct.replace(LAG_PATTERN, "");
  if (BAD_TYPE_PATTERN.test(withoutLag)) {
    const suffix = withoutLag.slice(-2);
    return {
      error: `Tipo de vínculo inválido: ${suffix}. Use FS (Término-Início), SS (Início-Início), FF (Término-Término) ou SF (Início-Término).`,
    };
  }
  return { error: `Predecessor não encontrado: ${direct}` };
}

/** Código WBS + sufixos dos predecessores de uma tarefa (texto do campo). */
export function predecessorsText(taskId: string): string {
  const state = useDomainStore.getState();
  const order = new Map(state.taskOrder.map((id, index) => [id, index]));

  return Object.values(state.taskLinks)
    .filter((link) => link.successorId === taskId)
    .map((link) => ({ link, task: state.tasks[link.predecessorId] }))
    .filter((entry) => entry.task !== undefined)
    .sort((a, b) => (order.get(a.link.predecessorId) ?? 0) - (order.get(b.link.predecessorId) ?? 0))
    .map((entry) => formatPredecessorRef(entry.task!, entry.link))
    .join(", ");
}

/**
 * Aplica o conjunto de predecessores escrito no campo (modo substituição):
 * cria os vínculos novos e remove os que saíram — inclusive quando só o tipo
 * ou a latência mudou (o id do vínculo inclui o tipo, então ele é recriado).
 * Tudo-ou-nada: se algum token não resolver ou alguma recusa de validação
 * ocorrer, nada é alterado (specs/task-dependencies — "Validação de vínculos").
 */
export function applyPredecessors(taskId: string, raw: string): PredecessorResult {
  const domain = useDomainStore.getState();
  const task = domain.tasks[taskId];
  if (!task) return { errors: ["Tarefa não encontrada."] };

  const byWbs = resolveWbs(domain.tasks);
  const desired: Array<PredecessorRef & { id: string }> = [];
  const errors: string[] = [];

  for (const token of parseWbsRefs(raw)) {
    const resolved = resolveToken(token, byWbs);
    if ("error" in resolved) {
      errors.push(resolved.error);
      continue;
    }
    if (!desired.some((entry) => entry.id === resolved.id)) {
      desired.push({ ...resolved.ref, id: resolved.id });
    }
  }
  if (errors.length > 0) return { errors };

  const current = Object.values(domain.taskLinks).filter(
    (link) => link.successorId === taskId,
  );

  const wanted = new Map(desired.map((entry) => [entry.id, entry]));
  /** Vínculos que saem: o predecessor sumiu ou o tipo/latência mudou. */
  const removals = current.filter((link) => {
    const entry = wanted.get(link.predecessorId);
    return !entry || entry.type !== link.type || entry.lagMs !== link.lagMs;
  });

  const prospective = current
    .filter((link) => !removals.includes(link))
    .map((link) => ({ predecessorId: link.predecessorId, successorId: link.successorId }));

  for (const entry of desired) {
    const alreadyKept = current.some(
      (link) =>
        link.predecessorId === entry.id &&
        link.type === entry.type &&
        link.lagMs === entry.lagMs,
    );
    if (alreadyKept) continue;

    const probe = validateLink(
      { predecessorId: entry.id, successorId: taskId },
      Object.values(domain.tasks),
      prospective,
    );
    if (!probe.ok) {
      const path =
        probe.path && probe.path.length > 1
          ? ` Caminho: ${probe.path
              .map((step) => domain.tasks[step]?.outlineNumber ?? step)
              .join(" → ")}.`
          : "";
      errors.push(`${probe.message ?? "Vínculo recusado."}${path}`);
      continue;
    }
    prospective.push({ predecessorId: entry.id, successorId: taskId });
  }

  // nada é alterado quando algo foi recusado
  if (errors.length > 0) return { errors };

  // aplica remoções e adições (a adição revalidada nunca deveria falhar aqui)
  for (const link of removals) domain.removeLink(link.id);

  for (const entry of desired) {
    const kept = current.find(
      (link) =>
        link.predecessorId === entry.id &&
        link.type === entry.type &&
        link.lagMs === entry.lagMs,
    );
    if (kept) continue; // já existia com o mesmo tipo e latência

    const result = domain.addLink({
      id: linkId(entry.id, taskId, entry.type),
      projectId: task.projectId,
      predecessorId: entry.id,
      successorId: taskId,
      type: entry.type,
      lagMs: entry.lagMs,
      crossProjectRef: null,
    });
    if (!result.ok) {
      errors.push(result.message ?? "Vínculo recusado.");
    }
  }

  return { errors };
}
