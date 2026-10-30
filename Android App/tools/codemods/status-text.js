#!/usr/bin/env node
/**
 * Codemod (Stage 1, Task 15): text and icons use the status TEXT tones, never the fills. In every
 * src/**\/*.tsx, a text colour (`color`, `tintColor`, the tab bar's and header's tint colours,
 * `placeholderTextColor`) set to `c.<tone>` / `colors.<tone>` for brand, danger, success, warning
 * or info becomes `c.<tone>Text` — the colour that reads at 4.5:1 (lib/contrast.test). Fills,
 * borders and backgrounds keep the fill colours.
 *
 *   node tools/codemods/status-text.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const STATUS_TEXT = /(?<![A-Za-z])(color|tintColor|tabBarActiveTintColor|tabBarInactiveTintColor|headerTintColor|placeholderTextColor)(\s*[:=]\s*\{?\s*)(c|colors)\.(brand|danger|success|warning|info)\b/g;

function tsxFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

let files = 0;
let rewrites = 0;
for (const file of tsxFiles(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = text.replace(STATUS_TEXT, (_m, prop, gap, palette, tone) => {
    count += 1;
    return `${prop}${gap}${palette}.${tone}Text`;
  });
  if (count > 0) {
    fs.writeFileSync(file, next);
    files += 1;
    rewrites += count;
  }
}
console.log(`status-text: ${rewrites} rewritten in ${files} files`);
