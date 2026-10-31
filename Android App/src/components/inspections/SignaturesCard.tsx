import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { dateTimeText, instantDayText } from '../../lib/day-words';
import { SIGNATURE_LABEL } from '../../lib/inspection-rules';
import type { InspectionDetail } from '../../lib/inspection-types';
import { INSPECTION_WORDS } from '../../lib/inspection-words';
import { SIGNATURE_COLORS, radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Card, SectionTitle } from '../ui';

/**
 * A finished inspection's signatures, as the website shows them: each drawn one as its picture on
 * white (the typed name in italics otherwise), who signed and when, the roles not signed, and when
 * it was finished. `children`: what goes under them (Show to client).
 */
export function SignaturesCard({ detail, timeZone, children }: { detail: InspectionDetail; timeZone: string; children?: React.ReactNode }) {
  const c = useColors();
  const missing = detail.signatureRoles.allowed.filter((r) => !detail.signatures.some((sig) => sig.role === r));
  return (
    <Card>
      <SectionTitle>{INSPECTION_WORDS.signatures}</SectionTitle>
      <View style={s.list}>
        {detail.signatures.map((sig) => (
          <View key={sig.role} style={[s.item, { borderColor: c.line }]}>
            <View style={[s.paper, { backgroundColor: SIGNATURE_COLORS.paper }]}>
              {sig.image ? (
                <Image source={{ uri: sig.image }} resizeMode="contain" style={s.image} accessibilityLabel={`${SIGNATURE_LABEL[sig.role]} signature of ${sig.name}`} />
              ) : (
                <Text style={[s.typed, { color: SIGNATURE_COLORS.ink }]} importantForAccessibility="no">
                  {sig.name}
                </Text>
              )}
            </View>
            <Text style={[typeStyle('body'), { color: c.ink }]}>
              <Text style={font('600')}>{`${SIGNATURE_LABEL[sig.role]}:`}</Text>
              {` ${sig.name}`}
            </Text>
            <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{`Signed ${dateTimeText(sig.signedAt, timeZone)}${sig.method === 'TYPED' ? INSPECTION_WORDS.typedName : ''}`}</Text>
          </View>
        ))}
        {missing.map((r) => (
          <View key={r} style={[s.item, s.dashed, { borderColor: c.line }]}>
            <Text style={[typeStyle('body'), { color: c.ink2 }]}>
              <Text style={font('600')}>{`${SIGNATURE_LABEL[r]}:`}</Text>
              {` ${INSPECTION_WORDS.notSigned}`}
            </Text>
          </View>
        ))}
      </View>
      {detail.finishedAt ? <Text style={[typeStyle('caption'), s.gap, { color: c.ink2 }]}>{INSPECTION_WORDS.finishedAt.replace('{at}', dateTimeText(detail.finishedAt, timeZone))}</Text> : null}
      {children ? <View style={s.gap}>{children}</View> : null}
    </Card>
  );
}

/** Signatures a reopen took off: kept here and in the staff report (the client sees only the current one). */
export function EarlierRevisionsCard({ detail, timeZone }: { detail: InspectionDetail; timeZone: string }) {
  const c = useColors();
  if (!detail.earlierRevisions?.length) return null;
  return (
    <Card>
      <SectionTitle>{INSPECTION_WORDS.earlierRevisions}</SectionTitle>
      <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{INSPECTION_WORDS.earlierRevisionsHint}</Text>
      <View style={[s.list, s.gap]}>
        {detail.earlierRevisions.map((r) => (
          <View key={r.number} style={[s.item, { borderColor: c.line }]}>
            <Text style={[typeStyle('body'), font('600'), { color: c.ink }]}>
              {`Revision ${r.number}`}
              <Text style={[font('400'), { color: c.ink2 }]}>{` · reopened on ${instantDayText(r.reopenedAt, timeZone)}`}</Text>
            </Text>
            {r.signatures.map((sig) => (
              <Text key={sig.role} style={[typeStyle('caption'), { color: c.ink2 }]}>
                {`${SIGNATURE_LABEL[sig.role]}: ${sig.name} · signed ${dateTimeText(sig.signedAt, timeZone)}${sig.method === 'TYPED' ? INSPECTION_WORDS.typedName : ''}`}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  list: { gap: spacing.md },
  item: { borderWidth: 1, borderRadius: radius.input, padding: spacing.sm, gap: 2 },
  dashed: { borderStyle: 'dashed' },
  paper: { height: 80, borderRadius: radius.badge, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  image: { width: '100%', height: 64 },
  typed: { fontSize: 20, lineHeight: 26, fontStyle: 'italic', fontFamily: 'serif' },
  gap: { marginTop: spacing.sm },
});
