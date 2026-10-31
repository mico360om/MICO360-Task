/**
 * Helpers for the drift tests: the website's files beside the app (`Web Portal/…` in the same
 * checkout) and the app's own files. Test-only — nothing in the app imports this folder.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import ts from 'typescript';

/** The website's folder beside `Android App/` (absent when the app is checked out alone). */
export const PORTAL: string = resolve(__dirname, '../../../Web Portal');
const APP = resolve(__dirname, '../..');
const APP_SRC = resolve(APP, 'src');

export function webPath(rel: string): string {
  return resolve(PORTAL, rel);
}

/** True only when every one of the website files is there (drift tests skip themselves otherwise). */
export function hasWeb(...rels: string[]): boolean {
  return rels.every((rel) => existsSync(webPath(rel)));
}

export function readWeb(rel: string): string {
  return readFileSync(webPath(rel), 'utf8');
}

/**
 * Run a website TypeScript module and return its exports, without its dependencies: a relative
 * import named in `imports` (specifier → website path) is loaded the same way; any other import
 * comes back as an empty object.
 */
export function loadWebTs(rel: string, imports: Record<string, string> = {}): Record<string, unknown> {
  const { code } = transformSync(readWeb(rel), { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} as Record<string, unknown> };
  const load = (spec: string) => (imports[spec] ? loadWebTs(imports[spec]!, imports) : {});
  new Function('module', 'exports', 'require', code)(mod, mod.exports, load);
  return mod.exports;
}

/** A JSX element as `loadWebTsx` builds it. */
export interface JsxNode {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

const FRAGMENT = '#fragment';

const flatChildren = (xs: unknown[]): unknown[] =>
  (xs.flat(Infinity) as unknown[]).filter((c) => c !== null && c !== undefined && c !== false && c !== true);

function jsx(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): JsxNode {
  return { type, props: props ?? {}, children: flatChildren(children) };
}

/** Every import of a TSX module: any property is a function that does nothing. */
const stubModule = (): unknown => new Proxy({}, { get: () => () => undefined });

/**
 * Run a website TSX module without React: its JSX becomes plain `{ type, props, children }` nodes
 * (`type` '#fragment' for <>…</>), every import is a stub. `expose` also returns module-level
 * consts that are not exported (Sidebar's `I`) as `__exposed`.
 */
export function loadWebTsx(rel: string, opts: { expose?: string[] } = {}): Record<string, unknown> {
  let { code } = transformSync(readWeb(rel), { loader: 'tsx', jsx: 'transform', jsxFactory: '__h', jsxFragment: '__f', format: 'cjs' });
  if (opts.expose?.length) code += `\nmodule.exports.__exposed = { ${opts.expose.join(', ')} };`;
  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', '__h', '__f', code)(mod, mod.exports, stubModule, jsx, FRAGMENT);
  return mod.exports;
}

type Shape = import('../lib/icons').Shape;

const isFilled = (fill: unknown) => fill !== undefined && fill !== null && fill !== 'none';

/** What may sit inside an <svg> besides the shapes the app draws: a group and the svg's title. */
const SVG_WRAPPERS = new Set([FRAGMENT, 'g', 'title']);

/**
 * The drawing in a JSX tree from `loadWebTsx`: function components are called with their props
 * (children included), fragments and the `svg` unwrapped; path/circle/rect come back with numbers.
 * Also the svg's stroke width, viewBox and whether it is filled. Any other element inside an svg
 * (line, polyline, polygon, ellipse…) throws: the app's Icon can't draw it, so it is never skipped.
 */
export function svgShapes(node: unknown): { shapes: Shape[]; strokeWidth?: number; viewBox?: string; filled?: boolean } {
  const out: { shapes: Shape[]; strokeWidth?: number; viewBox?: string; filled?: boolean } = { shapes: [] };
  const visit = (n: unknown, inSvg = false): void => {
    if (Array.isArray(n)) return n.forEach((k) => visit(k, inSvg));
    if (typeof n === 'function') return visit((n as () => unknown)(), inSvg);
    if (!n || typeof n !== 'object') return;
    const { type, props, children } = n as JsxNode;
    if (typeof type === 'function') {
      return visit((type as (p: object) => unknown)({ ...props, children: children.length === 1 ? children[0] : children }), inSvg);
    }
    if (inSvg && typeof type === 'string' && !['path', 'circle', 'rect'].includes(type) && !SVG_WRAPPERS.has(type)) {
      throw new Error(`svgShapes: <${type}> inside an svg — the app's Icon draws path, circle and rect only (lib/icons Shape)`);
    }
    if (type === 'svg') {
      if (props.strokeWidth !== undefined && out.strokeWidth === undefined) out.strokeWidth = Number(props.strokeWidth);
      if (typeof props.viewBox === 'string' && out.viewBox === undefined) out.viewBox = props.viewBox;
      if (isFilled(props.fill)) out.filled = true;
    } else if (type === 'path') {
      const s: Shape = { el: 'path', d: String(props.d) };
      if (isFilled(props.fill)) s.fill = true;
      if (props.fillOpacity !== undefined) s.fillOpacity = Number(props.fillOpacity);
      out.shapes.push(s);
    } else if (type === 'circle') {
      const s: Shape = { el: 'circle', cx: Number(props.cx), cy: Number(props.cy), r: Number(props.r) };
      if (isFilled(props.fill)) s.fill = true;
      out.shapes.push(s);
    } else if (type === 'rect') {
      const s: Shape = { el: 'rect', x: Number(props.x), y: Number(props.y), width: Number(props.width), height: Number(props.height) };
      if (props.rx !== undefined) s.rx = Number(props.rx);
      out.shapes.push(s);
    }
    children.forEach((k) => visit(k, inSvg || type === 'svg'));
  };
  visit(node);
  return out;
}

/**
 * Every <svg> written in a website TSX file, each read by svgShapes — without running the file
 * (TypeScript's parser): for icons drawn inline inside a component that can't be called on its
 * own (it has hooks). Attributes are read when literal ("2", {2.2}, "currentColor"); a computed
 * one comes back as its source text, so it never equals a number by accident.
 */
export function svgDrawingsIn(rel: string): Array<ReturnType<typeof svgShapes>> {
  const sf = ts.createSourceFile(rel, readWeb(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const value = (init: ts.JsxAttributeValue | undefined): unknown => {
    if (!init) return true;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isNumericLiteral(e)) return Number(e.text);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
      return `{${e.getText(sf)}}`;
    }
    return `{${init.getText(sf)}}`;
  };
  const node = (el: ts.JsxElement | ts.JsxSelfClosingElement): JsxNode => {
    const open = ts.isJsxElement(el) ? el.openingElement : el;
    const props: Record<string, unknown> = {};
    for (const a of open.attributes.properties) if (ts.isJsxAttribute(a)) props[a.name.getText(sf)] = value(a.initializer);
    const children = ts.isJsxElement(el) ? el.children.filter((c): c is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)).map(node) : [];
    return { type: open.tagName.getText(sf), props, children };
  };
  const out: Array<ReturnType<typeof svgShapes>> = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf) === 'svg') {
      out.push(svgShapes(node(n)));
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** A path under `Android App/`. */
export function appPath(rel: string): string {
  return resolve(APP, rel);
}

/** The text of a file under `Android App/src` (`../App.tsx` reaches the app folder). */
export function appSource(rel: string): string {
  return readFileSync(resolve(APP_SRC, rel), 'utf8');
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Every app source file — `.ts`/`.tsx` under `src`, without tests and `src/testing` — as [path from src, text]. */
export function appSources(): Array<[rel: string, text: string]> {
  return walk(APP_SRC, [])
    .map((full) => relative(APP_SRC, full).split(sep).join('/'))
    .filter((rel) => !rel.startsWith('testing/'))
    .sort()
    .map((rel) => [rel, appSource(rel)]);
}

/** The SHA-256 of a file's bytes, as hex. */
export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
