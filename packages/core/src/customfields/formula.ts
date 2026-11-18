/**
 * Interpretador de fórmulas de campos personalizados
 * (specs/custom-fields — "Fórmulas em campos"; docs/architecture.md D9:
 * interpretador próprio, **nunca `eval`**, com limites de tamanho e
 * profundidade).
 *
 * Linguagem: literais (número, texto entre aspas, duração `5d`/`40h`,
 * `true`/`false`), referências `[Nome do Campo]`, operadores aritméticos,
 * de comparação e lógicos, e as funções predefinidas IIF, ABS, MIN, MAX,
 * ROUND e CONCAT.
 *
 * Tudo é puro: a avaliação devolve valor ou um motivo de recusa em pt-BR.
 */

export type FormulaValue = number | string | boolean | null;

export type FormulaResult =
  | { ok: true; value: FormulaValue }
  | { ok: false; reason: string };

/** Limites (docs/architecture.md D9). */
export const FORMULA_MAX_LENGTH = 1_000;
export const FORMULA_MAX_DEPTH = 32;
export const FORMULA_MAX_NODES = 600;

/** Funções predefinidas (a UI oferece exatamente estas). */
export const FORMULA_FUNCTIONS = ["IIF", "ABS", "MIN", "MAX", "ROUND", "CONCAT"] as const;

/* ------------------------------------------------------------------ lexer -- */

type TokenKind = "num" | "str" | "dur" | "word" | "field" | "op" | "lparen" | "rparen" | "comma" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  at: number;
}

const DURATION_PATTERN = /^(\d+(?:[.,]\d+)?)\s*(d|dd|dia|dias|h|hs|hora|horas|min|mins|sem|semana|semanas|m)/i;

function fail(reason: string): FormulaResult {
  return { ok: false, reason };
}

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // referência de campo: [Nome]
    if (char === "[") {
      const end = expression.indexOf("]", index);
      if (end === -1) return null;
      tokens.push({ kind: "field", value: expression.slice(index + 1, end), at: index });
      index = end + 1;
      continue;
    }

    // texto: "…"
    if (char === '"') {
      let end = index + 1;
      let text = "";
      while (end < expression.length && expression[end] !== '"') {
        text += expression[end];
        end += 1;
      }
      if (end >= expression.length) return null; // aspas não fechadas
      tokens.push({ kind: "str", value: text, at: index });
      index = end + 1;
      continue;
    }

    // número / duração (5d, 40h, 2 semanas)
    if (/[0-9]/.test(char)) {
      const rest = expression.slice(index);
      const duration = rest.match(DURATION_PATTERN);
      if (duration) {
        tokens.push({ kind: "dur", value: duration[0].trim(), at: index });
        index += duration[0].length;
        continue;
      }
      const number = rest.match(/^\d+(?:[.,]\d+)?/);
      if (number) {
        tokens.push({ kind: "num", value: number[0].replace(",", "."), at: index });
        index += number[0].length;
        continue;
      }
      return null;
    }

    // palavras: true/false e nomes de função
    if (/[a-zA-Z_]/.test(char)) {
      const word = expression.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (!word) return null;
      tokens.push({ kind: "word", value: word[0], at: index });
      index += word[0].length;
      continue;
    }

    // operadores (o mais longo primeiro)
    const operators = ["<>", "<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "=", "<", ">"];
    const operator = operators.find((candidate) => expression.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: "op", value: operator, at: index });
      index += operator.length;
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "lparen", value: char, at: index });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rparen", value: char, at: index });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ kind: "comma", value: char, at: index });
      index += 1;
      continue;
    }

    return null; // caractere inesperado — recusa
  }

  tokens.push({ kind: "eof", value: "", at: expression.length });
  return tokens;
}

/* ------------------------------------------------------------------ AST --- */

type Node =
  | { type: "literal"; value: FormulaValue }
  | { type: "field"; name: string }
  | { type: "unary"; op: string; operand: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

/* ---------------------------------------------------------------- parser -- */

class Parser {
  private position = 0;
  private nodes = 0;
  private depth = 0;
  /** Motivo específico da recusa (ex.: função desconhecida), se houver. */
  error: string | null = null;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node | null {
    const node = this.parseOr();
    if (!node) return null;
    if (this.peek().kind !== "eof") return null;
    return node;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private enter(): boolean {
    this.depth += 1;
    this.nodes += 1;
    return this.depth <= FORMULA_MAX_DEPTH && this.nodes <= FORMULA_MAX_NODES;
  }

  private leave(): void {
    this.depth -= 1;
  }

  private matchOp(values: string[]): boolean {
    const token = this.peek();
    if (token.kind === "op" && values.includes(token.value)) {
      this.next();
      return true;
    }
    // palavras lógicas entram como "op" após normalização? — tratadas no lexer como word:
    if (token.kind === "word" && values.includes(token.value.toUpperCase())) {
      this.next();
      return true;
    }
    return false;
  }

  private matchWord(word: string): boolean {
    const token = this.peek();
    if (token.kind === "word" && token.value.toUpperCase() === word) {
      this.next();
      return true;
    }
    return false;
  }

  private parseOr(): Node | null {
    if (!this.enter()) return null;
    let left = this.parseAnd();
    while (left && (this.matchOp(["||"]) || this.matchWord("OR"))) {
      const right = this.parseAnd();
      if (!right) {
        this.leave();
        return null;
      }
      left = { type: "binary", op: "||", left, right };
      this.nodes += 1;
    }
    this.leave();
    return left;
  }

  private parseAnd(): Node | null {
    if (!this.enter()) return null;
    let left = this.parseNot();
    while (left && (this.matchOp(["&&"]) || this.matchWord("AND"))) {
      const right = this.parseNot();
      if (!right) {
        this.leave();
        return null;
      }
      left = { type: "binary", op: "&&", left, right };
      this.nodes += 1;
    }
    this.leave();
    return left;
  }

  private parseNot(): Node | null {
    if (this.matchWord("NOT")) {
      if (!this.enter()) return null;
      const operand = this.parseNot();
      this.leave();
      if (!operand) return null;
      return { type: "unary", op: "!", operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node | null {
    if (!this.enter()) return null;
    let left = this.parseAdditive();
    while (left) {
      const token = this.peek();
      const isComparison =
        token.kind === "op" &&
        ["=", "==", "!=", "<>", "<", ">", "<=", ">="].includes(token.value);
      if (!isComparison) break;
      this.next();
      const op =
        token.value === "=" || token.value === "=="
          ? "=="
          : token.value === "!=" || token.value === "<>"
            ? "!="
            : token.value;
      const right = this.parseAdditive();
      if (!right) {
        this.leave();
        return null;
      }
      left = { type: "binary", op, left, right };
      this.nodes += 1;
    }
    this.leave();
    return left;
  }

  private parseAdditive(): Node | null {
    if (!this.enter()) return null;
    let left = this.parseMultiplicative();
    while (left) {
      const token = this.peek();
      if (!(token.kind === "op" && (token.value === "+" || token.value === "-"))) break;
      this.next();
      const right = this.parseMultiplicative();
      if (!right) {
        this.leave();
        return null;
      }
      left = { type: "binary", op: token.value, left, right };
      this.nodes += 1;
    }
    this.leave();
    return left;
  }

  private parseMultiplicative(): Node | null {
    if (!this.enter()) return null;
    let left = this.parseUnary();
    while (left) {
      const token = this.peek();
      if (!(token.kind === "op" && (token.value === "*" || token.value === "/"))) break;
      this.next();
      const right = this.parseUnary();
      if (!right) {
        this.leave();
        return null;
      }
      left = { type: "binary", op: token.value, left, right };
      this.nodes += 1;
    }
    this.leave();
    return left;
  }

  private parseUnary(): Node | null {
    const token = this.peek();
    if (token.kind === "op" && token.value === "-") {
      this.next();
      if (!this.enter()) return null;
      const operand = this.parseUnary();
      this.leave();
      if (!operand) return null;
      return { type: "unary", op: "-", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node | null {
    const token = this.next();

    if (token.kind === "num") return { type: "literal", value: Number(token.value) };
    if (token.kind === "str") return { type: "literal", value: token.value };
    if (token.kind === "dur") {
      // duração vira ms de tempo útil (unidade "dia" = 8 h — UNIT_MS.day)
      const value = parseDurationMs(token.value);
      return value === null ? null : { type: "literal", value };
    }
    if (token.kind === "field") return { type: "field", name: token.value };

    if (token.kind === "word") {
      const upper = token.value.toUpperCase();
      if (upper === "TRUE") return { type: "literal", value: true };
      if (upper === "FALSE") return { type: "literal", value: false };

      if (this.peek().kind === "lparen") {
        if (!(FORMULA_FUNCTIONS as readonly string[]).includes(upper)) {
          this.error = `Função desconhecida: ${token.value}`;
          return null;
        }
        this.next(); // (
        const args: Node[] = [];
        if (this.peek().kind !== "rparen") {
          for (;;) {
            const arg = this.parseOr();
            if (!arg) return null;
            args.push(arg);
            if (this.peek().kind === "comma") {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.next().kind !== "rparen") return null;
        return { type: "call", name: upper, args };
      }
      return null; // palavra solta não é válida
    }

    if (token.kind === "lparen") {
      if (!this.enter()) return null;
      const inner = this.parseOr();
      this.leave();
      if (!inner || this.next().kind !== "rparen") return null;
      return inner;
    }

    return null;
  }
}

/* -------------------------------------------------------------- avaliador -- */

function toNumber(value: FormulaValue): number | null {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function truthy(value: FormulaValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "" && value !== "0" && value.toLowerCase() !== "false";
  return false;
}

function evaluateNode(node: Node, scope: Record<string, FormulaValue>): FormulaResult {
  switch (node.type) {
    case "literal":
      return { ok: true, value: node.value };

    case "field": {
      if (!(node.name in scope)) return fail(`Campo não encontrado: [${node.name}]`);
      return { ok: true, value: scope[node.name] ?? null };
    }

    case "unary": {
      const operand = evaluateNode(node.operand, scope);
      if (!operand.ok) return operand;
      if (node.op === "!") return { ok: true, value: !truthy(operand.value) };
      const number = toNumber(operand.value);
      if (number === null) return fail("Valor numérico esperado");
      return { ok: true, value: -number };
    }

    case "binary": {
      const left = evaluateNode(node.left, scope);
      if (!left.ok) return left;
      const right = evaluateNode(node.right, scope);
      if (!right.ok) return right;

      // lógicos (curto-circuito textual — a árvore já foi checada)
      if (node.op === "&&") return { ok: true, value: truthy(left.value) && truthy(right.value) };
      if (node.op === "||") return { ok: true, value: truthy(left.value) || truthy(right.value) };

      // comparação: textos com textos, senão números
      if (["==", "!=", "<", ">", "<=", ">="].includes(node.op)) {
        let comparison: number;
        if (typeof left.value === "string" && typeof right.value === "string") {
          comparison = left.value.localeCompare(right.value);
        } else {
          const a = toNumber(left.value);
          const b = toNumber(right.value);
          if (a === null || b === null) return fail("Valores não comparáveis");
          comparison = a - b;
        }
        switch (node.op) {
          case "==":
            return { ok: true, value: comparison === 0 };
          case "!=":
            return { ok: true, value: comparison !== 0 };
          case "<":
            return { ok: true, value: comparison < 0 };
          case ">":
            return { ok: true, value: comparison > 0 };
          case "<=":
            return { ok: true, value: comparison <= 0 };
          default:
            return { ok: true, value: comparison >= 0 };
        }
      }

      // aritmética; "+" concatena quando algum lado é texto
      if (node.op === "+" && (typeof left.value === "string" || typeof right.value === "string")) {
        return { ok: true, value: `${left.value ?? ""}${right.value ?? ""}` };
      }

      const a = toNumber(left.value);
      const b = toNumber(right.value);
      if (a === null || b === null) return fail("Valores numéricos esperados");

      switch (node.op) {
        case "+":
          return { ok: true, value: a + b };
        case "-":
          return { ok: true, value: a - b };
        case "*":
          return { ok: true, value: a * b };
        case "/":
          if (b === 0) return fail("Divisão por zero");
          return { ok: true, value: a / b };
        default:
          return fail(`Operador não suportado: ${node.op}`);
      }
    }

    case "call": {
      const args: FormulaValue[] = [];
      for (const arg of node.args) {
        const value = evaluateNode(arg, scope);
        if (!value.ok) return value;
        args.push(value.value);
      }
      return callFunction(node.name, args);
    }

    default:
      return fail("Expressão inválida");
  }
}

function callFunction(name: string, args: FormulaValue[]): FormulaResult {
  switch (name) {
    case "IIF": {
      if (args.length !== 3) return fail("IIF espera 3 argumentos (condição, sim, não)");
      return { ok: true, value: truthy(args[0]!) ? args[1]! : args[2]! };
    }
    case "ABS": {
      const value = args.length === 1 ? toNumber(args[0]!) : null;
      return value === null ? fail("ABS espera 1 número") : { ok: true, value: Math.abs(value) };
    }
    case "MIN":
    case "MAX": {
      if (args.length === 0) return fail(`${name} espera ao menos 1 número`);
      const numbers: number[] = [];
      for (const arg of args) {
        const value = toNumber(arg);
        if (value === null) return fail(`${name} espera apenas números`);
        numbers.push(value);
      }
      return { ok: true, value: name === "MIN" ? Math.min(...numbers) : Math.max(...numbers) };
    }
    case "ROUND": {
      if (args.length < 1 || args.length > 2) return fail("ROUND espera (número, casas?)");
      const value = toNumber(args[0]!);
      if (value === null) return fail("ROUND espera um número");
      const digits = args.length === 2 ? (toNumber(args[1]!) ?? 0) : 0;
      const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
      return { ok: true, value: Math.round(value * factor) / factor };
    }
    case "CONCAT": {
      if (args.length === 0) return fail("CONCAT espera ao menos 1 argumento");
      return { ok: true, value: args.map((arg) => (arg === null ? "" : String(arg))).join("") };
    }
    default:
      return fail(`Função desconhecida: ${name}`);
  }
}

/** Duração literal (`5d`, `40h`, `2 semanas`) em ms de tempo útil. */
function parseDurationMs(text: string): number | null {
  const match = text.match(DURATION_PATTERN);
  if (!match) return null;
  const amount = Number(match[1]!.replace(",", "."));
  const unit = match[2]!.toLowerCase();
  const perUnit: Record<string, number> = {
    d: 8 * 3_600_000,
    dd: 8 * 3_600_000,
    dia: 8 * 3_600_000,
    dias: 8 * 3_600_000,
    h: 3_600_000,
    hs: 3_600_000,
    hora: 3_600_000,
    horas: 3_600_000,
    min: 60_000,
    mins: 60_000,
    sem: 5 * 8 * 3_600_000,
    semana: 5 * 8 * 3_600_000,
    semanas: 5 * 8 * 3_600_000,
  };
  const factor = perUnit[unit];
  return factor === undefined ? null : amount * factor;
}

/**
 * Avalia a expressão com o `scope` (nome → valor) das referências `[Campo]`.
 * Recusa sem executar qualquer código externo.
 */
export function evaluateFormula(
  expression: string,
  scope: Record<string, FormulaValue> = {},
): FormulaResult {
  const text = expression.trim();
  if (text === "") return fail("Expressão vazia");
  if (text.length > FORMULA_MAX_LENGTH) {
    return fail(`Expressão muito longa (máximo de ${FORMULA_MAX_LENGTH} caracteres)`);
  }

  const tokens = tokenize(text);
  if (!tokens) return fail("Expressão inválida: sintaxe não reconhecida");

  const parser = new Parser(tokens);
  const ast = parser.parse();
  if (!ast) return fail(parser.error ?? "Expressão inválida: sintaxe não reconhecida");

  return evaluateNode(ast, scope);
}
