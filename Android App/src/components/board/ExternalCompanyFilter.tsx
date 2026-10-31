import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';
import { ChoiceSheet } from '../my-tasks/ChoiceSheet';
import { EXTERNAL_CONTACT_WORDS } from '../../lib/external-contacts';
import { companyChoices, companyFilterLabel } from '../../lib/task-external-contacts';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

/**
 * "External company: Any company" (My Tasks and the boards): shows only the tasks with an external
 * contact from the company chosen. Offered only when some task has a contact with a company.
 */
export function ExternalCompanyFilter({ companies, value, onChange }: { companies: readonly string[]; value: string; onChange: (company: string) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  if (companies.length === 0 && !value) return null;
  const on = !!value;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${companyFilterLabel(value)}. Filter by ${EXTERNAL_CONTACT_WORDS.filter.toLowerCase()}`}
        style={({ pressed }) => [s.filter, on && s.on, pressed && s.pressed]}
      >
        <Text style={[s.text, on && s.textOn]} numberOfLines={1}>
          {companyFilterLabel(value)}
        </Text>
        <Icon name="ui.chevron" size={14} color={on ? c.brandText : c.ink2} />
      </Pressable>
      <ChoiceSheet visible={open} title={EXTERNAL_CONTACT_WORDS.filter} options={companyChoices(companies)} value={value} onChoose={onChange} onClose={() => setOpen(false)} />
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    filter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.line, borderRadius: radius.input, paddingHorizontal: spacing.md, backgroundColor: c.surface, alignSelf: 'flex-start', maxWidth: '100%' },
    on: { borderColor: c.brand, backgroundColor: c.brandWash },
    pressed: { opacity: 0.6 },
    text: { flexShrink: 1, fontSize: fontSize.sm, ...font('600'), color: c.ink },
    textOn: { color: c.brandText },
  });
