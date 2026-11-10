/**
 * Writes every sample PDF (see samples.ts) to a folder, with the lines each page draws (text, place,
 * size), for the before/after comparison. The pictures are prepared the way the routes prepare them.
 *
 *   npx tsx tests/unit/pdf/render-samples.ts <out-folder>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectPdf } from '../../../src/lib/pdf-inspect';
import { readProjectPicture } from '../../../src/lib/pdf-image';
import { createImageShrinker } from '../../../src/lib/image-shrink';
import { PDF_PICTURE_BOX } from '../../../src/lib/pdf-document';
import { SAMPLE_NAMES, samplePdfs, samplePictures } from './samples';

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: render-samples.ts <out-folder>');
  mkdirSync(out, { recursive: true });
  const raw = await samplePictures();
  const shrinker = createImageShrinker();
  // As the routes do (1.23.10): a project's picture and a company's logo through readProjectPicture,
  // sized for the box the header prints them in; a drawn signature cleaned when it is saved.
  const prepare = (b: Buffer, box: { width: number; height: number }) => readProjectPicture('/uploads/x.png', async () => b, shrinker.toPrintable, (x) => shrinker.toDocumentPicture(x, box));
  const pictures = { project: await prepare(raw.project!, PDF_PICTURE_BOX.mark), logo: await prepare(raw.logo!, PDF_PICTURE_BOX.logo), signature: await shrinker.toPrintable(raw.signature!) };
  const pdfs = samplePdfs(pictures);
  for (const name of SAMPLE_NAMES) {
    const pdf = pdfs[name]();
    writeFileSync(join(out, `${name}.pdf`), pdf);
    const { lines } = inspectPdf(pdf);
    writeFileSync(join(out, `${name}.lines.json`), JSON.stringify(lines.map((page) => page.map((l) => ({ text: l.text, x: +l.x.toFixed(2), y: +l.y.toFixed(2), size: l.size })))));
    console.log(`${name}: ${lines.length} page(s), ${(pdf.length / 1024).toFixed(1)} KB`);
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
