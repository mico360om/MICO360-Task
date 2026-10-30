#!/usr/bin/env node
/**
 * Codemod (Stage 1, Task 15; widened in the final review): text and icons use the status TEXT
 * tones, never the fills. In every src/**\/*.{ts,tsx}, the value of a text colour (`color`,
 * `tintColor`, the tab bar's and header's tint colours, `placeholderTextColor`) — the whole value,
 * ternaries included — has each `c.<tone>` / `colors.<tone>` / `p.<tone>` for brand, danger,
 * success, warning or info turned into `<…>.<tone>Text`, the colour that reads at 4.5:1
 * (lib/contrast.test). Fills, borders and backgrounds keep the fill colours, and so does a
 * ProgressBar's `color` (its bar). The same rule as R3 in src/style-guard.test.ts.
 *
 *   node tools/codemods/status-text.js
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC = path.resolve(__dirname, '../../src');
const TEXT_COLOUR_PROPS = new Set(['color', 'tintColor', 'tabBarActiveTintColor', 'tabBarInactiveTintColor', 'headerTintColor', 'placeholderTextColor']);
const STATUS_FILL = /\b(c|colors|p)\.(brand|danger|success|warning|info)\b/g;
const FILL_COLOUR_PROPS = { ProgressBar: ['color'] };

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** [start, end] of every text-colour value in the file. */
function valueRanges(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && TEXT_COLOUR_PROPS.has(n.name.text)) {
      out.push([n.initializer.getStart(sf), n.initializer.getEnd()]);
    }
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && TEXT_COLOUR_PROPS.has(n.name.text) && n.initializer) {
      const element = n.parent.parent;
      const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(sf) : '';
      if (!(FILL_COLOUR_PROPS[tag] || []).includes(n.name.text)) out.push([n.initializer.getStart(sf), n.initializer.getEnd()]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

let files = 0;
let rewrites = 0;
for (const file of sourceFiles(SRC)) {
  if (file.includes(`${path.sep}testing${path.sep}`)) continue;
  let text = fs.readFileSync(file, 'utf8');
  const ranges = valueRanges(file, text).sort((a, b) => b[0] - a[0]);
  let count = 0;
  for (const [start, end] of ranges) {
    const value = text.slice(start, end);
    const next = value.replace(STATUS_FILL, (_m, palette, tone) => {
      count += 1;
      return `${palette}.${tone}Text`;
    });
    if (next !== value) text = text.slice(0, start) + next + text.slice(end);
  }
  if (count > 0) {
    fs.writeFileSync(file, text);
    files += 1;
    rewrites += count;
  }
}
console.log(`status-text: ${rewrites} rewritten in ${files} files`);
