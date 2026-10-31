import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { REPORT_CLIENT_WORDS as W, clientResultLine, clientRow, revisionLine } from '../../lib/inspection-client';
import type { ClientInspection } from '../../lib/inspection-types';
import { SIGNATURE_COLORS, radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { MarkedText } from '../client-share/MarkedText';

/**
 * A finished inspection as the client will see it (the staff preview before "Show to client"), as
 * the website's: the result, the failed items, every section's items, the signatures with the
 * signers' names and the roles not signed. The project's people's names are marked in the notes.
 */
export function ClientInspectionBody({ inspection: x, names }: { inspection: ClientInspection; names: string[] }) {
  const c = useColors();
  const failed = x.sections.flatMap((sec) => sec.items.filter((i) => i.result === 'Fail'));
  const revision = revisionLine(x);
  return (
    <View style={s.stack}>
      {revision ? <Text style={[typeStyle('caption'), font('600'), { color: c.ink2 }]}>{revision}</Text> : null}
      <Text style={[typeStyle('body'), { color: c.ink2 }]}>
        <Text style={[font('600'), { color: x.counts.failed ? c.dangerText : c.successText }]}>{x.result}</Text>
        {clientResultLine(x).slice(x.result.length)}
      </Text>
      {failed.length ? (
        <View>
          <Text style={[typeStyle('body'), font('600'), { color: c.ink }]}>{W.failedItems}</Text>
          {failed.map((i, k) => (
            <Text key={k} style={[typeStyle('body'), { color: c.ink }]}>
              {`• ${i.label}${i.reading ? ` — ${i.reading}${i.limits ? ` (allowed ${i.limits})` : ''}` : ''}`}
              {i.note ? (
                <>
                  {' — '}
                  <MarkedText text={i.note} names={names} />
                </>
              ) : null}
            </Text>
          ))}
        </View>
      ) : null}
      {x.sections.map((sec, si) => (
        <View key={si}>
          <Text style={[typeStyle('body'), font('600'), { color: c.ink }]}>{sec.title}</Text>
          <View style={[s.table, { borderColor: c.line }]}>
            {sec.items.map((i, ii) => {
              const row = clientRow(i);
              const tone = i.result === 'Fail' ? c.dangerText : i.result === 'Pass' ? c.successText : c.ink2;
              return (
                <View key={ii} style={[s.row, ii > 0 && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={s.grow}>
                    <Text style={[typeStyle('body'), { color: c.ink }]}>{i.label}</Text>
                    {row.reading ? <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{row.reading}</Text> : null}
                    {i.note ? <MarkedText text={i.note} names={names} style={[typeStyle('caption'), { color: c.ink2 }]} /> : null}
                  </View>
                  <View style={s.result}>
                    {i.result === 'Fail' ? <Icon name="ui.close" size={12} color={tone} /> : i.result === 'Pass' ? <Icon name="misc.check" size={12} color={tone} /> : null}
                    <Text style={[s.resultText, { color: tone }]}>{row.result.toUpperCase()}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <View>
        <Text style={[typeStyle('body'), font('600'), { color: c.ink }]}>{W.signatures}</Text>
        <View style={s.sigs}>
          {x.signatures.map((sig, k) => (
            <View key={k} style={[s.sig, { borderColor: c.line }]}>
              <View style={[s.paper, { backgroundColor: SIGNATURE_COLORS.paper }]}>
                {sig.image ? (
                  <Image source={{ uri: sig.image }} resizeMode="contain" style={s.image} accessibilityLabel={`${sig.role} signature of ${sig.name}`} />
                ) : (
                  <Text style={[s.typed, { color: SIGNATURE_COLORS.ink }]} importantForAccessibility="no">
                    {sig.name}
                  </Text>
                )}
              </View>
              <Text style={[typeStyle('caption'), { color: c.ink }]}>
                <Text style={font('600')}>{`${sig.role}:`}</Text>
                {` ${sig.name}`}
              </Text>
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{`Signed ${sig.signedOn}${sig.typed ? W.typedName : ''}`}</Text>
            </View>
          ))}
          {x.unsigned.map((role) => (
            <View key={role} style={[s.sig, s.dashed, { borderColor: c.line }]}>
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>
                <Text style={font('600')}>{`${role}:`}</Text>
                {` ${W.notSigned}`}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: spacing.md },
  table: { marginTop: spacing.xs, borderWidth: 1, borderRadius: radius.input },
  row: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  grow: { flex: 1 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultText: { ...font('700'), fontSize: 11, letterSpacing: 0.4 },
  sigs: { gap: spacing.sm, marginTop: spacing.xs },
  sig: { borderWidth: 1, borderRadius: radius.input, padding: spacing.sm },
  dashed: { borderStyle: 'dashed' },
  paper: { height: 64, borderRadius: radius.badge, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  image: { width: '100%', height: 56 },
  typed: { fontSize: 18, lineHeight: 24, fontStyle: 'italic', fontFamily: 'serif' },
});
