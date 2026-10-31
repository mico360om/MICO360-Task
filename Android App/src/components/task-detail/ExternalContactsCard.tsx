import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { useColors } from '../../core/theme';
import { Button, IconButton } from '../ui';
import { Icon } from '../Icon';
import { SectionCard } from './kit';
import { ContactEditor } from '../task-form/ContactEditor';
import { EXTERNAL_CONTACT_WORDS, MAX_EXTERNAL_CONTACTS, contactRoleLine, mailHref, phoneHref, type ExternalContactDraft, type ExternalContactFields } from '../../lib/external-contacts';
import { callLabel, contactFailureText, contactPatch, editContactLabel, emailLabel, isContactGone, removeContactLabel } from '../../lib/task-external-contacts';
import { newIdempotencyKey } from '../../lib/idempotency';
import { spacing, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

/** Said when the phone has no app to write or call with. */
const noApp = (what: string) => Alert.alert(`Couldn’t ${what}`, 'This phone has no app for it.');

/**
 * One external contact as the task shows it: the name, "company · designation", the email and the
 * phone number as links (tap to write or to call), and the remarks. `right` holds its Edit and
 * Remove buttons.
 */
export function ExternalContactView({ contact: c, right }: { contact: ExternalContactFields; right?: React.ReactNode }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const role = contactRoleLine(c);
  const write = () => Linking.openURL(mailHref(c.email) ?? '').catch(() => noApp('write an email'));
  const call = () => Linking.openURL(phoneHref(c.phone) ?? '').catch(() => noApp('call'));
  return (
    <View style={s.contact}>
      <View style={s.head}>
        <View style={s.who}>
          <Text style={s.name}>{c.name}</Text>
          {role ? <Text style={s.role}>{role}</Text> : null}
        </View>
        {right ? <View style={s.buttons}>{right}</View> : null}
      </View>
      {c.email ? (
        <Pressable onPress={() => void write()} accessibilityRole="link" accessibilityLabel={emailLabel(c)} style={({ pressed }) => [s.link, pressed && s.pressed]}>
          <Icon name="kit.mail" size={15} color={colors.brandText} />
          <Text style={s.linkText}>{c.email}</Text>
        </Pressable>
      ) : null}
      {c.phone ? (
        <Pressable onPress={() => void call()} accessibilityRole="link" accessibilityLabel={callLabel(c)} style={({ pressed }) => [s.link, pressed && s.pressed]}>
          <Text style={s.linkLabel}>{EXTERNAL_CONTACT_WORDS.labels.phone}</Text>
          <Text style={s.linkText}>{c.phone}</Text>
        </Pressable>
      ) : null}
      {c.remarks ? <Text style={s.remarks}>{c.remarks}</Text> : null}
    </View>
  );
}

/**
 * The task's External contacts (the website's section): the people outside the company responsible
 * for it, kept apart from its assignees. Anyone who can open the task may add one, edit one or
 * remove one (after "Remove this contact?"); the server has the last word and its refusal is shown.
 * Changes need a connection. A change sends only the fields that changed from what was shown; a new
 * contact goes under one key until it is added (a retry after a lost answer adds it once); a
 * contact someone else removed meanwhile counts as removed (each change refreshes the task).
 */
export function ExternalContactsCard({
  contacts,
  projectId,
  onAdd,
  onSave,
  onRemove,
}: {
  contacts: (ExternalContactFields & { id: string })[];
  projectId: string;
  onAdd: (contact: ExternalContactFields, idempotencyKey: string) => Promise<unknown>;
  /** Only the fields that changed. */
  onSave: (id: string, patch: ExternalContactDraft) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // The contact being edited ('new': one being added), else none — and none once that contact is gone.
  const [editing, setEditing] = useState<string | null>(null);
  const open = editing === 'new' || contacts.some((x) => x.id === editing) ? editing : null;
  // The new contact's key: one for each contact being added, the same on every try of it.
  const addKey = useRef(newIdempotencyKey());
  const startAdding = () => {
    addKey.current = newIdempotencyKey();
    setEditing('new');
  };
  const full = contacts.length >= MAX_EXTERNAL_CONTACTS;

  const add = async (fields: ExternalContactFields) => {
    await onAdd(fields, addKey.current);
    setEditing(null);
  };
  const save = async (contact: ExternalContactFields & { id: string }, fields: ExternalContactFields) => {
    const patch = contactPatch(contact, fields);
    if (Object.keys(patch).length > 0) await onSave(contact.id, patch);
    setEditing(null);
  };

  const confirmRemove = (contact: ExternalContactFields & { id: string }) =>
    Alert.alert(EXTERNAL_CONTACT_WORDS.confirmRemove, contactRoleLine(contact) ? `${contact.name} · ${contactRoleLine(contact)}` : contact.name, [
      { text: EXTERNAL_CONTACT_WORDS.keep, style: 'cancel' },
      {
        text: EXTERNAL_CONTACT_WORDS.remove,
        style: 'destructive',
        // Someone else removed it already: it is gone (the refreshed task no longer shows it).
        onPress: () =>
          void onRemove(contact.id).catch((e) => {
            if (!isContactGone(e)) Alert.alert(EXTERNAL_CONTACT_WORDS.removeFailed, contactFailureText(e, 'Please try again.'));
          }),
      },
    ]);

  return (
    <SectionCard title={contacts.length ? `${EXTERNAL_CONTACT_WORDS.heading} (${contacts.length})` : EXTERNAL_CONTACT_WORDS.heading}>
      <Text style={s.hint}>{EXTERNAL_CONTACT_WORDS.hint}</Text>
      {contacts.length === 0 && open !== 'new' ? <Text style={s.none}>{EXTERNAL_CONTACT_WORDS.none}</Text> : null}
      {contacts.map((contact) =>
        open === contact.id ? (
          <ContactEditor
            key={contact.id}
            title={EXTERNAL_CONTACT_WORDS.editTitle}
            initial={contact}
            projectId={projectId}
            onSubmit={(fields) => save(contact, fields)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <ExternalContactView
            key={contact.id}
            contact={contact}
            right={
              <>
                <IconButton icon="kit.edit" label={editContactLabel(contact)} onPress={() => setEditing(contact.id)} disabled={open !== null} />
                <IconButton icon="ui.trash" label={removeContactLabel(contact)} onPress={() => confirmRemove(contact)} disabled={open !== null} color={c.dangerText} />
              </>
            }
          />
        ),
      )}
      {open === 'new' ? (
        <ContactEditor
          title={EXTERNAL_CONTACT_WORDS.addTitle}
          initial={null}
          projectId={projectId}
          submitLabel={EXTERNAL_CONTACT_WORDS.add}
          onSubmit={add}
          onCancel={() => setEditing(null)}
        />
      ) : full ? (
        <Text style={s.hint}>{EXTERNAL_CONTACT_WORDS.full}</Text>
      ) : (
        <Button title={EXTERNAL_CONTACT_WORDS.add} variant="secondary" onPress={startAdding} disabled={open !== null} accessibilityLabel={EXTERNAL_CONTACT_WORDS.addTitle} />
      )}
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    hint: { fontSize: fontSize.xs, color: c.ink2 },
    none: { fontSize: fontSize.sm, color: c.ink3 },
    contact: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.sm, gap: 2 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    who: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
    name: { fontSize: fontSize.md, ...font('700'), color: c.ink },
    role: { fontSize: fontSize.sm, color: c.ink2 },
    buttons: { flexDirection: 'row', alignItems: 'center' },
    link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, alignSelf: 'flex-start' },
    pressed: { opacity: 0.6 },
    linkLabel: { fontSize: fontSize.xs, ...font('700'), color: c.ink3 },
    linkText: { fontSize: fontSize.sm, ...font('600'), color: c.brandText, textDecorationLine: 'underline' },
    remarks: { fontSize: fontSize.sm, color: c.ink2 },
  });
