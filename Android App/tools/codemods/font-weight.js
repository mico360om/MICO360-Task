#!/usr/bin/env node
/**
 * Codemod (Stage 1, Task 15): a weight is a bundled face, never `fontWeight` (Android draws a fake
 * bold over a loaded face). In every src/**\/*.tsx, `fontWeight: '<w>'` (or "<w>", '100'…'900',
 * 'bold' = 700, 'normal' = 400, with or without `as const`) becomes `...font('<w>')`, and the file
 * gets `font` from lib/typography (merged into an import from there when it has one). Prints every
 * `fontWeight:` it can't rewrite (not a plain literal) for fixing by hand.
 *
 *   node tools/codemods/font-weight.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const TYPOGRAPHY = path.join(SRC, 'lib', 'typography');
const LITERAL = /fontWeight:\s*(['"])(100|200|300|400|500|600|700|800|900|bold|normal)\1(\s+as\s+const)?/g;
// The faces start at 400 (lib/typography FontWeight): a lighter weight is drawn as Regular.
const FACE = { bold: '700', normal: '400', 100: '400', 200: '400', 300: '400' };

function tsxFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function importPath(file) {
  let rel = path.relative(path.dirname(file), TYPOGRAPHY).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function addFontImport(text, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${escaped}';`);
  const m = existing.exec(text);
  if (m) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (names.includes('font')) return text;
    names.push('font');
    return text.slice(0, m.index) + `import { ${names.join(', ')} } from '${rel}';` + text.slice(m.index + m[0].length);
  }
  // After the last import statement at the top of the file.
  const imports = [...text.matchAll(/^import[\s\S]*?from\s+'[^']+';[^\n]*$/gm)];
  const last = imports[imports.length - 1];
  const at = last ? last.index + last[0].length : 0;
  return `${text.slice(0, at)}\nimport { font } from '${rel}';${text.slice(at)}`;
}

let files = 0;
let rewrites = 0;
const left = [];
for (const file of tsxFiles(SRC)) {
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  let count = 0;
  text = text.replace(LITERAL, (_m, _q, w) => {
    count += 1;
    return `...font('${FACE[w] ?? w}')`;
  });
  if (count > 0) {
    text = addFontImport(text, importPath(file));
    fs.writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text);
    files += 1;
    rewrites += count;
  }
  text.split('\n').forEach((line, i) => {
    if (/fontWeight\s*:/.test(line)) left.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${i + 1}: ${line.trim()}`);
  });
}
console.log(`font-weight: ${rewrites} rewritten in ${files} files`);
for (const l of left) console.log(`left for hand-fixing — ${l}`);
