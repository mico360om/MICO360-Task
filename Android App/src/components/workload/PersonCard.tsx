import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { WorkloadCell, WorkloadPerson } from '../../lib/planning-api';
import { cellLook, weekBarColor } from '../../lib/planning-look';
import { cellLabel, cellTone, dayHeading, DAY_COUNT_FONT_CAP, DAY_HEAD_FONT_CAP, weekBar } from '../../lib/workload';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Avatar, Card, ProgressBar } from '../ui';
import { capLines } from '../ui/text-lines';

/**
 * A day off's hatching (the website's hatch-off): stripes of a colour the day's words also read on
 * at 4.5:1 — ground-2 on a day off's surface-2, the surface on an amber day off with tasks due.
 */
export function Hatch({ color }: { color: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const d = useMemo(() => {
    const parts: string[] = [];
    for (let x = -size.h; x < size.w; x += 9) parts.push(`M${x} ${size.h} L${x + size.h} 0`);
    return parts.join(' ');
  }, [size]);
  return (
    <View style={hatch.box} pointerEvents="none" onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Path d={d} stroke={color} strokeWidth={4} />
        </Svg>
      ) : null}
    </View>
  );
}

const hatch = StyleSheet.create({ box: { ...StyleSheet.absoluteFillObject, borderRadius: radius.input, overflow: 'hidden' } });

/**
 * One person's week on Workload (a phone design in the website's style — it has no phone layout
 * here): their face and name, the week against its limit, their overdue tasks, and the seven days
 * as the server counts them. A day with tasks opens its list; a day off says "Off".
 */
export function PersonCard({ person, week, today, onOpenDay }: { person: WorkloadPerson; week: string; today: string; onOpenDay: (cell: WorkloadCell) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const bar = weekBar(person);
  return (
    <Card>
      <View style={s.head}>
        <Avatar name={person.name} src={person.avatarUrl} size="md" />
        <View style={s.flex}>
          <Text style={s.name} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={s.note}>
            {bar.text} · <Text style={bar.tone === 'over' ? s.overNote : null}>{bar.note}</Text>
          </Text>
        </View>
        <Text style={[s.overdue, person.overdue > 0 && s.overdueOn]}>Overdue {person.overdue}</Text>
      </View>
      <View style={s.bar}>
        <ProgressBar value={bar.pct} color={weekBarColor(c, bar.tone)} label={`${person.name}’s week: ${bar.text}, ${bar.note}`} />
      </View>
      <ScrollView key={week} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.days}>
        {person.days.map((cell) => {
          const tone = cellTone(cell);
          const look = cellLook(c, tone);
          // A day with nothing due (or an empty day off) has nothing to open, as on the website.
          const opens = tone !== 'off' && tone !== 'none';
          const isToday = cell.date === today;
          return (
            <Pressable
              key={cell.date}
              onPress={opens ? () => onOpenDay(cell) : undefined}
              accessibilityRole={opens ? 'button' : 'text'}
              accessibilityLabel={cellLabel(person.name, cell)}
              accessibilityHint={opens ? 'Shows the day’s tasks' : undefined}
              style={({ pressed }) => [s.day, isToday && s.todayColumn, opens && pressed && s.pressed]}
            >
              <Text style={[s.dayHead, isToday && s.todayText]} numberOfLines={capLines(2)} maxFontSizeMultiplier={DAY_HEAD_FONT_CAP}>
                {dayHeading(cell.date, today)}
              </Text>
              <View style={[s.cell, { backgroundColor: look.bg, borderColor: look.border }, tone === 'over' && s.cellOver]}>
                {look.hatched ? <Hatch color={tone === 'off' ? c.ground2 : c.surface} /> : null}
                <Text style={[s.count, { color: look.fg }]} maxFontSizeMultiplier={DAY_COUNT_FONT_CAP}>{cell.limit === 0 && cell.count === 0 ? 'Off' : cell.count}</Text>
                {tone === 'over' ? (
                  <View style={s.bang} importantForAccessibility="no-hide-descendants">
                    <Text style={s.bangText} allowFontScaling={false}>
                      !
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Card>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    flex: { flex: 1, minWidth: 0 },
    name: { ...typeStyle('bodyStrong'), ...font('700'), color: c.ink },
    note: { ...typeStyle('caption'), color: c.ink2 },
    overNote: { ...font('700'), color: c.dangerText },
    overdue: { ...typeStyle('caption'), ...font('700'), fontVariant: ['tabular-nums'], color: c.ink2 },
    overdueOn: { color: c.dangerText },
    bar: { marginTop: spacing.sm },
    days: { gap: 6, paddingTop: spacing.md },
    day: { width: 64, minHeight: 56, alignItems: 'center', gap: 4, paddingVertical: 4, borderRadius: radius.input },
    todayColumn: { backgroundColor: c.brandWash },
    pressed: { opacity: 0.8 },
    dayHead: { ...typeStyle('caption'), ...font('600'), fontSize: 11, lineHeight: 14, textAlign: 'center', color: c.ink2 },
    todayText: { color: c.brandText },
    cell: { width: 48, minHeight: 44, borderRadius: radius.input, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
    cellOver: { borderWidth: 2 },
    count: { ...font('700'), fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
    bang: { position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
    bangText: { ...font('700'), fontSize: 10, lineHeight: 12, color: c.onBrand },
  });
}
