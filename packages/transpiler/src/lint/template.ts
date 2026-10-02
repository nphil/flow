/**
 * A deliberately small reader for the handful of Jinja shapes that have a plain Home Assistant
 * condition equivalent. It never guesses: a template is only recognised when every token of it
 * matches a known shape, otherwise the result is `null` and the template is left alone.
 */

type CompareOp = '==' | '!=' | '>=' | '<=' | '>' | '<';

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'punct'; value: string }
  | { kind: 'op'; value: CompareOp };

/** What a recognised template could be written as instead. */
export type NativeKind = 'state' | 'not-state' | 'numeric-state' | 'trigger' | 'time';

/** A template that is EXACTLY one of the shapes Flow can convert for you, with its parts. */
export type ExactTemplate =
  | { kind: 'state'; entityId: string; state: string; negated: boolean }
  | { kind: 'state-attribute'; entityId: string; attribute: string; value: string }
  | {
      kind: 'numeric-state';
      entityId: string;
      /** `>` becomes `above`, `<` becomes `below`. */
      direction: 'above' | 'below';
      threshold: number;
      /** The Jinja filter used to turn the state into a number. */
      cast: 'float' | 'int';
      /** The default given to the filter (`float(0)` -> 0), or null when none was given. */
      fallback: number | null;
    }
  | { kind: 'trigger-id'; id: string };

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /\d+(?:\.\d+)?/y;
const COMPARE_OPS: readonly CompareOp[] = ['==', '!=', '>=', '<=', '>', '<'];
const PUNCTUATION = '()[],.|-';

/** `strftime` formats that only read the clock/weekday, which a Time condition can express. */
const CLOCK_FORMATS: Record<string, true> = {
  '%H:%M': true,
  '%H:%M:%S': true,
  '%H': true,
  '%a': true,
  '%A': true,
  '%w': true,
};

function matchAt(pattern: RegExp, source: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(source)?.[0] ?? null;
}

/** Splits a Jinja expression into tokens; null when it uses anything this reader does not know. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const end = source.indexOf(char, index + 1);
      if (end === -1) return null;
      const text = source.slice(index + 1, end);
      if (text.includes('\\')) return null;
      tokens.push({ kind: 'string', value: text });
      index = end + 1;
      continue;
    }
    const op = COMPARE_OPS.find((candidate) => source.startsWith(candidate, index));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      index += op.length;
      continue;
    }
    const number = matchAt(NUMBER, source, index);
    if (number !== null) {
      tokens.push({ kind: 'number', value: Number(number) });
      index += number.length;
      continue;
    }
    const identifier = matchAt(IDENTIFIER, source, index);
    if (identifier !== null) {
      tokens.push({ kind: 'ident', value: identifier });
      index += identifier.length;
      continue;
    }
    if (!PUNCTUATION.includes(char)) return null;
    tokens.push({ kind: 'punct', value: char });
    index += 1;
  }
  return tokens;
}

/** `{{ expr }}` as `expr`; null for anything else (several blocks, `{% %}` logic, plain text). */
function singleExpression(template: string): string | null {
  const match = /^\s*\{\{-?([\s\S]*?)-?\}\}\s*$/.exec(template);
  const inner = match?.[1];
  if (inner === undefined || /\{\{|\}\}|\{%|\{#/.test(inner)) return null;
  return inner;
}

function expressionTokens(template: string): Token[] | null {
  const expression = singleExpression(template);
  return expression === null ? null : tokenize(expression);
}

/** Cursor over a token list. Every reader method consumes only when it matches. */
class Reader {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  get done(): boolean {
    return this.index >= this.tokens.length;
  }

  word(name: string): boolean {
    const token = this.tokens[this.index];
    if (token?.kind !== 'ident' || token.value !== name) return false;
    this.index += 1;
    return true;
  }

  punct(value: string): boolean {
    const token = this.tokens[this.index];
    if (token?.kind !== 'punct' || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  peekPunct(value: string): boolean {
    const token = this.tokens[this.index];
    return token?.kind === 'punct' && token.value === value;
  }

  text(): string | null {
    const token = this.tokens[this.index];
    if (token?.kind !== 'string') return null;
    this.index += 1;
    return token.value;
  }

  /** A number, with an optional leading minus sign. */
  num(): number | null {
    const negative = this.peekPunct('-');
    const token = this.tokens[this.index + (negative ? 1 : 0)];
    if (token?.kind !== 'number') return null;
    this.index += negative ? 2 : 1;
    return negative ? -token.value : token.value;
  }

  compare(): CompareOp | null {
    const token = this.tokens[this.index];
    if (token?.kind !== 'op') return null;
    this.index += 1;
    return token.value;
  }

  /** `[ 'a', 5, ... ]`, possibly empty. */
  list(): boolean {
    if (!this.punct('[')) return false;
    if (this.punct(']')) return true;
    do {
      if (this.text() === null && this.num() === null) return false;
    } while (this.punct(','));
    return this.punct(']');
  }
}

// ---------------------------------------------------------------------------
// Exact shapes (these can be converted automatically)
// ---------------------------------------------------------------------------

function readState(tokens: readonly Token[]): ExactTemplate | null {
  const reader = new Reader(tokens);
  const negated = reader.word('not');
  if (!(reader.word('is_state') && reader.punct('('))) return null;
  const entityId = reader.text();
  if (entityId === null || !reader.punct(',')) return null;
  const state = reader.text();
  if (state === null || !reader.punct(')') || !reader.done) return null;
  return { kind: 'state', entityId, state, negated };
}

function readStateAttribute(tokens: readonly Token[]): ExactTemplate | null {
  const reader = new Reader(tokens);
  if (!(reader.word('is_state_attr') && reader.punct('('))) return null;
  const entityId = reader.text();
  if (entityId === null || !reader.punct(',')) return null;
  const attribute = reader.text();
  if (attribute === null || !reader.punct(',')) return null;
  const value = reader.text();
  if (value === null || !reader.punct(')') || !reader.done) return null;
  return { kind: 'state-attribute', entityId, attribute, value };
}

function readNumericState(tokens: readonly Token[]): ExactTemplate | null {
  const reader = new Reader(tokens);
  if (!(reader.word('states') && reader.punct('('))) return null;
  const entityId = reader.text();
  if (entityId === null || !reader.punct(')') || !reader.punct('|')) return null;

  let cast: 'float' | 'int';
  if (reader.word('float')) cast = 'float';
  else if (reader.word('int')) cast = 'int';
  else return null;

  let fallback: number | null = null;
  if (reader.punct('(')) {
    fallback = reader.num();
    if (fallback === null || !reader.punct(')')) return null;
  }

  const op = reader.compare();
  if (op !== '>' && op !== '<') return null;
  const threshold = reader.num();
  if (threshold === null || !reader.done) return null;
  return {
    kind: 'numeric-state',
    entityId,
    direction: op === '>' ? 'above' : 'below',
    threshold,
    cast,
    fallback,
  };
}

function readTriggerId(tokens: readonly Token[]): ExactTemplate | null {
  const reader = new Reader(tokens);
  const isIdEquals =
    reader.word('trigger') && reader.punct('.') && reader.word('id') && reader.compare() === '==';
  const id = isIdEquals ? reader.text() : null;
  return id !== null && reader.done ? { kind: 'trigger-id', id } : null;
}

/** The template as one of the exactly-convertible shapes, or null. */
export function matchExactTemplate(template: string): ExactTemplate | null {
  const tokens = expressionTokens(template);
  if (!tokens) return null;
  return (
    readState(tokens) ??
    readNumericState(tokens) ??
    readTriggerId(tokens) ??
    readStateAttribute(tokens)
  );
}

// ---------------------------------------------------------------------------
// Recognised-but-not-convertible shapes (message only)
// ---------------------------------------------------------------------------

function statesOf(reader: Reader): boolean {
  return reader.word('states') && reader.punct('(') && reader.text() !== null && reader.punct(')');
}

/** `| float`, `| float(0)`, `| int(0)` */
function readNumberCast(reader: Reader): boolean {
  if (!reader.punct('|') || !(reader.word('float') || reader.word('int'))) return false;
  return reader.punct('(') ? reader.num() !== null && reader.punct(')') : true;
}

function readNumberComparison(reader: Reader): boolean {
  return reader.compare() !== null && reader.num() !== null && reader.done;
}

/** `== 'text'` / `!= 'text'` (any of the two). */
function readEqualsText(reader: Reader): boolean {
  const op = reader.compare();
  return (op === '==' || op === '!=') && reader.text() !== null && reader.done;
}

/** `in [...]`; `negated` demands (true) or forbids (false) the `not` before `in`, undefined allows both. */
function readInList(reader: Reader, negated?: boolean): boolean {
  const hasNot = reader.word('not');
  if (negated !== undefined && hasNot !== negated) return false;
  return reader.word('in') && reader.list() && reader.done;
}

/** `is_state('a', 'b')` or `is_state('a', ['b', 'c'])` */
function isStateCall(reader: Reader): boolean {
  return (
    reader.word('is_state') &&
    reader.punct('(') &&
    reader.text() !== null &&
    reader.punct(',') &&
    (reader.text() !== null || reader.list()) &&
    reader.punct(')') &&
    reader.done
  );
}

function isStateAttrCall(reader: Reader): boolean {
  return (
    reader.word('is_state_attr') &&
    reader.punct('(') &&
    reader.text() !== null &&
    reader.punct(',') &&
    reader.text() !== null &&
    reader.punct(',') &&
    (reader.text() !== null || reader.num() !== null) &&
    reader.punct(')') &&
    reader.done
  );
}

function statesEquals(reader: Reader, op: '==' | '!='): boolean {
  return statesOf(reader) && reader.compare() === op && reader.text() !== null && reader.done;
}

function statesInList(reader: Reader, negated: boolean): boolean {
  return statesOf(reader) && readInList(reader, negated);
}

/** Runs `read`, allowing the whole value expression to sit in one pair of parentheses. */
function inParens(reader: Reader, read: () => boolean): boolean {
  if (!reader.punct('(')) return read();
  return read() && reader.punct(')');
}

/** `states('a') | float(0) > 5`, also written `(states('a') | float(0)) > 5`. */
function statesCompared(reader: Reader): boolean {
  const readValue = () => statesOf(reader) && readNumberCast(reader);
  return inParens(reader, readValue) && readNumberComparison(reader);
}

function readStateAttrCall(reader: Reader): boolean {
  return (
    reader.word('state_attr') &&
    reader.punct('(') &&
    reader.text() !== null &&
    reader.punct(',') &&
    reader.text() !== null &&
    reader.punct(')')
  );
}

/** `state_attr('a', 'brightness') | int(0) > 100` (the cast and the parentheses are optional). */
function stateAttrCompared(reader: Reader): boolean {
  const readValue = () =>
    readStateAttrCall(reader) && (!reader.peekPunct('|') || readNumberCast(reader));
  return inParens(reader, readValue) && readNumberComparison(reader);
}

function triggerIdCompared(reader: Reader): boolean {
  if (!(reader.word('trigger') && reader.punct('.') && reader.word('id'))) return false;
  return readEqualsText(reader) || readInList(reader);
}

/** `now().hour >= 22`, `now().weekday() in [5, 6]`, `now().strftime('%H:%M') > '22:00'` */
function nowCompared(reader: Reader): boolean {
  if (!(reader.word('now') && reader.punct('(') && reader.punct(')') && reader.punct('.'))) {
    return false;
  }
  if (reader.word('hour') || reader.word('minute')) return readNumberComparison(reader);
  if (reader.word('weekday') || reader.word('isoweekday')) {
    if (!(reader.punct('(') && reader.punct(')'))) return false;
    return readInList(reader) || readNumberComparison(reader);
  }
  if (reader.word('strftime') && reader.punct('(')) {
    const format = reader.text();
    if (format === null || !Object.hasOwn(CLOCK_FORMATS, format) || !reader.punct(')')) {
      return false;
    }
    return reader.compare() !== null && reader.text() !== null && reader.done;
  }
  return false;
}

const ATOM_SHAPES: ReadonlyArray<{ kind: NativeKind; matches: (reader: Reader) => boolean }> = [
  { kind: 'state', matches: isStateCall },
  { kind: 'state', matches: isStateAttrCall },
  { kind: 'state', matches: (reader) => statesEquals(reader, '==') },
  { kind: 'not-state', matches: (reader) => statesEquals(reader, '!=') },
  { kind: 'state', matches: (reader) => statesInList(reader, false) },
  { kind: 'not-state', matches: (reader) => statesInList(reader, true) },
  { kind: 'numeric-state', matches: statesCompared },
  { kind: 'numeric-state', matches: stateAttrCompared },
  { kind: 'trigger', matches: triggerIdCompared },
  { kind: 'time', matches: nowCompared },
];

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punct' && token.value === value;
}

/** True when the first `(` closes at the very last token, i.e. `( ... )` wraps the whole list. */
function isWrapped(tokens: readonly Token[]): boolean {
  if (!isPunct(tokens[0], '(') || !isPunct(tokens[tokens.length - 1], ')')) return false;
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    if (isPunct(token, '(')) depth += 1;
    else if (isPunct(token, ')')) depth -= 1;
    if (depth === 0 && index < tokens.length - 1) return false;
  }
  return depth === 0;
}

/** Splits at the top-level `and` / `or` (not inside brackets); null when brackets do not balance. */
function splitOnLogic(tokens: readonly Token[]): Token[][] | null {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (isPunct(token, '(') || isPunct(token, '[')) depth += 1;
    if (isPunct(token, ')') || isPunct(token, ']')) depth -= 1;
    if (depth < 0) return null;
    const isLogic = token.kind === 'ident' && (token.value === 'and' || token.value === 'or');
    if (depth === 0 && isLogic) parts.push([]);
    else parts[parts.length - 1]?.push(token);
  }
  return depth === 0 ? parts : null;
}

function classifyPart(
  body: readonly Token[],
  negated: boolean,
  nesting: number
): NativeKind[] | null {
  if (isWrapped(body)) return classifyTokens(body.slice(1, -1), nesting + 1);
  const shape = ATOM_SHAPES.find((candidate) => candidate.matches(new Reader(body)));
  if (!shape) return null;
  // A leading `not` turns "is in this state" into "is not in this state".
  return [negated && shape.kind === 'state' ? 'not-state' : shape.kind];
}

function classifyTokens(tokens: readonly Token[], nesting = 0): NativeKind[] | null {
  const parts = splitOnLogic(tokens);
  if (!parts || nesting > 8) return null;

  const kinds: NativeKind[] = [];
  for (const part of parts) {
    const first = part[0];
    const negated = first?.kind === 'ident' && first.value === 'not';
    const found = classifyPart(negated ? part.slice(1) : part, negated, nesting);
    if (!found) return null;
    kinds.push(...found);
  }
  return [...new Set(kinds)];
}

/**
 * The kinds of plain condition a template could be written as, or null when ANY part of it is
 * something else (so a template mixing a time check with custom logic is never reported).
 */
export function classifyTemplate(template: string): NativeKind[] | null {
  const tokens = expressionTokens(template);
  return tokens ? classifyTokens(tokens) : null;
}

/** True when the template is one expression that calls the named function (e.g. `is_state`). */
export function templateCalls(template: string, name: string): boolean {
  const tokens = expressionTokens(template);
  if (!tokens) return false;
  return tokens.some(
    (token, index) =>
      token.kind === 'ident' && token.value === name && isPunct(tokens[index + 1], '(')
  );
}
