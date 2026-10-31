import { it, expect } from 'vitest';
import { signatureProblem } from '../../lib/signature-ink';
import { appSource as src } from '../../testing/web-source';

/**
 * Device check N9 (31 Oct): the client's optional signature showed "Signer’s name *" — a required
 * star although that signature may be left out. The name carries the star only when its signature is
 * required; an optional signature that is made still needs its signer's name (the check says so).
 */
it('the signer’s name is starred only when its signature is required', () => {
  const pad = src('components/inspections/SignaturePad.tsx');
  expect(pad).toMatch(/<TextField label=\{SIGN_WORDS\.signerName\} required=\{required\} /);
  expect(pad).not.toMatch(/<TextField label=\{SIGN_WORDS\.signerName\} required /);
});

it('an optional signature may be left out, but one that is made needs its signer’s name', () => {
  expect(signatureProblem(null, false)).toBeNull();
  expect(signatureProblem({ method: 'TYPED', name: '  ', image: null }, false)).toBe('Type the signer’s name.');
});
