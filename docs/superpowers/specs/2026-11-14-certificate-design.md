# Learning Hub certificate: new design (short design)

14 Nov 2026. The owner sent a picture of a certificate and asked: "use similar design for the certificate".

## The picture (what to match)
- **Page:** A4 landscape, white to very light grey background. Large red, semi-transparent angled shapes in the top-left corner and down the right side.
- **Top left:** the MICO360 logo.
- **Heading:** "CERTIFICATE" very large, bold, black; "OF COMPLETION" below it, bold, brand red, all caps.
- **Opening line:** "THIS CERTIFIES THAT", small, widely spaced capitals.
- **Name:** the learner's name, large, red, in a handwriting (script) font.
- **Course:** "has successfully completed", then the course title, large and bold.
- **Issuer block:** the company name in bold, then "Issued through MICO360 Tasks · Learning Hub", then a thin red line.
- **Detail rows (label / value):**
  - Completed and issued (date);
  - Quiz score;
  - Expires;
  - Certificate ID.
- **Bottom right:** a red laurel wreath with the QR code in its middle, and "Scan to verify" under it.

## What today's certificate already has
`training-certificate-pdf.ts`, one A4 portrait page using pdfkit:
- the learner's company name and logo (else the site's);
- learner, course, completion day, quiz score (when the course has one), expiry, code;
- the verify link and QR;
- an optional "Issued by" with a signature picture;
- a status strip for revoked or expired.

The on-screen certificate (`CertificateView.tsx`, framed in 1.23.32) shows the same facts. **No new data is needed.**

## Design
1. **PDF:** one A4 landscape page, laid out like the picture. **Everything is drawn as vector shapes; no picture is copied.**
   - **Angled shapes:** brand red #8B1E1E with a few lighter tints and opacity.
   - **Laurel wreath:** our own drawing, made of leaf shapes along two arcs, in brand red.
   - **QR code:** the real one, dark on white, in the wreath's centre, at least 30 mm, so phones scan it reliably.
   - **Logo:** the learner's company logo if it has one, else the MICO360 logo, as today.
2. **Fonts:**
   - Heading ("CERTIFICATE"): Archivo Black/ExtraBold, the site's heading font.
   - Body and labels: IBM Plex Sans, as today.
   - **Name:** a free script font (**Great Vibes**, SIL Open Font License) in brand red.
   - **Arabic names (my call):** names with Arabic letters use the existing Noto Naskh Arabic, red and large, because a script font has no Arabic letters. Very long names shrink to fit one line.
3. **Issuer block:**
   - the company name, as today: the learner's company, else the site's;
   - "Issued through MICO360 Tasks · Learning Hub";
   - the red line.
4. **Detail rows:**
   - Completed and issued;
   - Quiz score, only when the course has quizzes, as today;
   - Expires ("Never" when no expiry);
   - Certificate ID;
   - "Issued by" (name, title) as one more row when a course has an issuer. The signature picture, if set, sits small above that row.
5. **Revoked or expired (my call):** a large faint diagonal "REVOKED" / "EXPIRED" stamp across the page, plus the reason and date in the detail rows. Today this is a strip.
6. **On-screen certificate:** the same design in the browser, scaled to fit the width. On a phone it shows the whole certificate small; "Download certificate (PDF)" and "Check it online" stay below it.
   - Same for the client guide certificate in the portal.
   - /verify keeps its own simple page.
7. **Everything else unchanged:** codes, the verify link, which certificates exist, expiry rules, existing certificates. Older certificates simply print in the new design when downloaded.

## Approaches
- **Chosen:** redraw the existing PDF and on-screen certificate with vector shapes and the site's fonts, plus one script font.
- **Rejected:** use the owner's picture as a background image. The QR placeholder and names would never line up, and it isn't print-sharp.
- **Rejected:** a design tool or HTML-to-PDF engine. That adds a heavy dependency.

## Needs the owner's OK
- **Adding one font package**, `@expo-google-fonts/great-vibes` (the script font, free OFL licence), from the official npm registry. The server already uses fonts from the same `@expo-google-fonts` family. The release tamper check verifies its fingerprint. The website serves the same font file for the on-screen certificate.

## Proof
- **Unit tests:** layout fits on one landscape page for long and short names, Latin and Arabic, with and without a score, expiry, issuer or signature; revoked and expired stamps.
- **QR:** read back from the PDF and the screen by the existing QR reader, opening /verify.
- **Visual check:** PDF rendered to an image and compared with the owner's picture. On-screen at 1440 and 375, light and dark (the certificate itself stays light, like paper).
- **Tests and checks:** Learning Hub e2e, suites, one fresh reviewer, and the battery groups for the Learning Hub.
- **Release:** after 1.23.34 (Up next), as 1.23.35.
