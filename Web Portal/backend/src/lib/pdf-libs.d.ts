/**
 * Minimal type declarations for the two untyped libraries the PDF text engine
 * (`pdf-text.ts`) uses. Only the members we actually call are declared.
 */

declare module 'fontkit' {
  export interface FontkitGlyph {
    id: number;
    codePoints: number[];
    advanceWidth: number;
  }
  export interface FontkitGlyphRun {
    glyphs: FontkitGlyph[];
    /** Resolved from the script of the first strong character: Arabic/Hebrew → 'rtl'. */
    direction: 'ltr' | 'rtl';
    /** Total advance in font units (unitsPerEm per em). */
    advanceWidth: number;
  }
  export interface FontkitFont {
    postscriptName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): FontkitGlyph;
    layout(text: string, features?: string[] | Record<string, boolean>): FontkitGlyphRun;
  }
  export function create(buffer: Buffer, postscriptName?: string): FontkitFont;
}

declare module 'bidi-js' {
  export interface BidiParagraph {
    start: number;
    end: number;
    level: number;
  }
  export interface EmbeddingLevels {
    paragraphs: BidiParagraph[];
    levels: Uint8Array;
  }
  export interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): EmbeddingLevels;
    getReorderedIndices(text: string, levels: EmbeddingLevels, start?: number, end?: number): number[];
    getMirroredCharacter(char: string): string | null;
    getBidiCharTypeName(char: string): string;
  }
  export default function bidiFactory(): Bidi;
}
