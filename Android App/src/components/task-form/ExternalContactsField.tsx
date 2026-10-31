import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useColors } from '../../core/theme';
import { Button, IconButton } from '../ui';
import { FieldLabel } from '../meeting/sheet-kit';
import { ContactEditor } from './ContactEditor';
import { ExternalContactView } from '../task-detail/ExternalContactsCard';
import { EXTERNAL_CONTACT_WORDS, MAX_EXTERNAL_CONTACTS } from '../../lib/external-contacts';
import { editContactLabel, newContactRow, removeContactLabel, type ContactRow } from '../../lib/task-external-contacts';
import { spacing, fontSize, type Palette } from '../../lib/theme';

/**
 * New task's and Edit task's optional External contacts (the website's field): the people outside
 * the company responsible for the task, each added, edited or removed here and saved with the form
 * (a new task sends them with the create; Edit task saves what changed on Save changes). Typing a
 * name suggests earlier contacts of the project.
 */
export function ExternalContactsField({ rows, onChange, projectId, disabled = false }: { rows: ContactRow[]; onChange: (rows: ContactRow[]) => void; projectId: string; disabled?: boolean }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // The row being edited ('new': one being added), else none.
  const [editing, setEditing] = useState<string | null>(null);
  const full = rows.length >= MAX_EXTERNAL_CONTACTS;

  const confirmRemove = (row: ContactRow) =>
    Alert.alert(EXTERNAL_CONTACT_WORDS.confirmRemove, row.fields.name, [
      { text: EXTERNAL_CONTACT_WORDS.keep, style: 'cancel' },
      { text: EXTERNAL_CONTACT_WORDS.remove, style: 'destructive', onPress: () => onChange(rows.filter((r) => r.key !== row.key)) },
    ]);

  return (
    <View style={s.wrap}>
      <FieldLabel>{`${EXTERNAL_CONTACT_WORDS.heading} (optional)`}</FieldLabel>
      <Text style={s.hint}>{EXTERNAL_CONTACT_WORDS.hint}</Text>
      {rows.map((row) =>
        editing === row.key ? (
          <ContactEditor
            key={row.key}
            title={EXTERNAL_CONTACT_WORDS.editTitle}
            initial={row.fields}
            projectId={projectId}
            onSubmit={(fields) => {
              onChange(rows.map((r) => (r.key === row.key ? { ...r, fields } : r)));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            disabled={disabled}
          />
        ) : (
          <ExternalContactView
            key={row.key}
            contact={row.fields}
            right={
              <>
                <IconButton icon="kit.edit" label={editContactLabel(row.fields)} onPress={() => setEditing(row.key)} disabled={disabled || editing !== null} />
                <IconButton icon="ui.trash" label={removeContactLabel(row.fields)} onPress={() => confirmRemove(row)} disabled={disabled || editing !== null} color={c.dangerText} />
              </>
            }
          />
        ),
      )}
      {editing === 'new' ? (
        <ContactEditor
          title={EXTERNAL_CONTACT_WORDS.addTitle}
          initial={null}
          projectId={projectId}
          submitLabel={EXTERNAL_CONTACT_WORDS.add}
          onSubmit={(fields) => {
            onChange([...rows, newContactRow(fields)]);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
          disabled={disabled}
        />
      ) : full ? (
        <Text style={s.hint}>{EXTERNAL_CONTACT_WORDS.full}</Text>
      ) : (
        <Button title={EXTERNAL_CONTACT_WORDS.add} variant="secondary" onPress={() => setEditing('new')} disabled={disabled || editing !== null} accessibilityLabel={EXTERNAL_CONTACT_WORDS.addTitle} />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs, marginBottom: spacing.md },
    hint: { fontSize: fontSize.xs, color: c.ink2 },
  });
