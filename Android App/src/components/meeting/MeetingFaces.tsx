import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Avatar } from '../ui';
import { fontSize, radius, spacing, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';
import { meetingFaces } from '../../lib/meeting-list';
import type { ApiMeeting } from '../../lib/types';

/**
 * Who's coming, as the website's card footer (meeting-card-parts.tsx People): the first three faces
 * overlapping, "+N" for the rest, and how many in words. The faces are pictures only; the words say it.
 */
export function MeetingFaces({ meeting }: { meeting: Pick<ApiMeeting, 'attendees' | 'attendeeCount'> }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const faces = meetingFaces(meeting);
  if (!faces.names.length && !faces.more) return <Text style={s.none}>{faces.text}</Text>;
  return (
    <View style={s.row}>
      {faces.names.length ? (
        <View style={s.faces} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {faces.names.map((n, i) => (
            // Each face on a solid backing, so an overlapped face doesn't show through the one in front.
            <View key={`${i}-${n}`} style={[s.backing, i > 0 && s.overlap]}>
              <Avatar name={n} size="sm" />
            </View>
          ))}
          {faces.more > 0 ? (
            <View style={[s.more, s.overlap]}>
              <Text style={s.moreText} allowFontScaling={false}>
                +{faces.more}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <Text style={s.text} numberOfLines={1}>
        {faces.text}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0, flexShrink: 1 },
    faces: { flexDirection: 'row', alignItems: 'center' },
    backing: { borderRadius: radius.pill, backgroundColor: c.surface },
    overlap: { marginLeft: -6 },
    more: {
      height: 24,
      minWidth: 24,
      paddingHorizontal: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.surface,
      backgroundColor: c.ground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreText: { fontSize: 10, ...font('600'), color: c.ink2 },
    text: { fontSize: fontSize.xs, color: c.ink2 },
    none: { fontSize: fontSize.xs, color: c.ink3, lineHeight: 24 },
  });
