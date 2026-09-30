// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// source-scan.js — tiny, dependency-free JS source scanner used by the static
// guard tests (determinism lint, canvas save/restore balance).
//
// It is NOT a parser.  It blanks comments and string/template contents (keeping
// every offset intact), then finds function bodies by brace matching.  That is
// enough for the two questions we ask of it — "which function is this call in?"
// and "does this function's save() count equal its restore() count?" — and every
// consumer has a negative control proving it can actually fail.

/** Replace comments and string/template contents with spaces; offsets are preserved. */
export function stripNoise(src) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'")
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => '"' + " ".repeat(m.length - 2) + '"')
    .replace(/`(?:\\.|[^`\\])*`/g, blankTemplate);
}

/** Blank the literal text of a template string but KEEP code inside ${ ... } (it really runs). */
function blankTemplate(m) {
  let out = "`", depth = 0;
  for (let i = 1; i < m.length - 1; i++) {
    const c = m[i];
    if (depth === 0) {
      if (c === "$" && m[i + 1] === "{") { out += "${"; depth = 1; i++; continue; }
      out += c === "\n" ? "\n" : " ";
    } else {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      out += c;
    }
  }
  return out + "`";
}

/** All `function name(...) { ... }` spans (nested ones included) in already-stripped source. */
export function functionSpans(clean) {
  const spans = [];
  const re = /(^|\n)[ \t]*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m;
  while ((m = re.exec(clean))) {
    const open = clean.indexOf("{", m.index + m[0].length);
    if (open < 0) continue;
    let depth = 0, j = open;
    for (; j < clean.length; j++) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") { depth--; if (depth === 0) break; }
    }
    spans.push({ name: m[2], start: m.index, open, end: j });
  }
  return spans;
}

/** Innermost function containing `offset`, or null (top level). */
export function enclosingFunction(spans, offset) {
  let best = null;
  for (const s of spans) {
    if (offset >= s.open && offset <= s.end && (!best || s.end - s.open < best.end - best.open)) best = s;
  }
  return best;
}

/** Every match of `regex` (global) in `src`, each tagged with its enclosing function name. */
export function findInFunctions(src, regex) {
  const clean = stripNoise(src);
  const spans = functionSpans(clean);
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  const out = [];
  let m;
  while ((m = re.exec(clean))) {
    const fn = enclosingFunction(spans, m.index);
    out.push({ index: m.index, line: clean.slice(0, m.index).split("\n").length, fn: fn ? fn.name : null });
  }
  return out;
}

/** Functions whose ctx.save() and ctx.restore() counts differ. */
export function unbalancedCanvasFunctions(src) {
  const clean = stripNoise(src);
  const out = [];
  for (const s of functionSpans(clean)) {
    const body = clean.slice(s.open, s.end + 1);
    const saves = (body.match(/\bctx\.save\(\)/g) || []).length;
    const restores = (body.match(/\bctx\.restore\(\)/g) || []).length;
    if (saves !== restores) out.push({ fn: s.name, saves, restores, line: clean.slice(0, s.start + 1).split("\n").length });
  }
  return out;
}
