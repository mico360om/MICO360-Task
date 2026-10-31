import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useServices } from '../../core/providers';
import { useProjectTemplateDraft, useSaveProjectTemplate } from '../../core/template-queries';
import { openWebsitePage } from '../../adapters/website';
import { Button, Skeleton, TextField, Toggle } from '../ui';
import { Icon } from '../Icon';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { newIdempotencyKey } from '../../lib/idempotency';
import { keepsKey } from '../../lib/pending-keys';
import { roleCounts } from '../../lib/role-counts';
import { blockingProblem, personRoleNote, publishWarning, roleWontCount, rolesSummary, saveProjectLines, templateSaveReason, TEMPLATE_SAVE_WORDS as W } from '../../lib/template-words';
import { fontSize, radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';

const NAME_MAX = 191;
const ROLE_MAX = 80;
const DESCRIPTION_MAX = 20_000;

/**
 * "Save as template" for a project (whoever runs it): its board and its tasks — with their
 * checklists, and their due dates as days from the project's start — under a name, as the website's
 * SaveProjectTemplateDialog. Each person its tasks are assigned to can become a role ("Inspector"):
 * their tasks then name that role, and whoever makes a project from the template picks who fills
 * it. Left empty, their tasks are unassigned in the template. Shown while open (one key per opening).
 */
export function SaveProjectTemplateSheet({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const draftQ = useProjectTemplateDraft(projectId, true);
  const save = useSaveProjectTemplate(projectId);
  const key = useRef(newIdempotencyKey());
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>({});
  // Everyone can see a template: the saver may keep the tasks' descriptions out of it.
  const [withDescriptions, setWithDescriptions] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const saving = save.isPending;
  // What the server said about the project (anything else is treated as not read yet).
  const d = draftQ.data?.base && Array.isArray(draftQ.data.people) ? draftQ.data : undefined;
  const blocked = d ? blockingProblem(d) : null;
  const people = d?.people ?? [];
  const counts = roleCounts(d?.assignments ?? [], people.map((p) => p.id), roles);
  const assignedTo = (id: string) => (d?.assignments ?? []).filter((onTask) => onTask.includes(id)).length;
  const close = () => {
    if (!saving) onClose();
  };

  async function submit() {
    if (saving || !d || blocked) return;
    if (!name.trim()) {
      setNameError(W.nameMissing);
      return;
    }
    setBanner(null);
    try {
      const t = await save.mutateAsync({
        input: {
          name: name.trim(),
          description: description.trim() || null,
          roles: d.people.map((p) => ({ userId: p.id, name: (roles[p.id] ?? '').trim() })).filter((r) => r.name),
          includeDescriptions: withDescriptions,
        },
        key: key.current,
      });
      setSaved(t.name);
    } catch (e) {
      // A definite answer (a refusal): the next try is a new one. No answer, or still being saved: the same key, so it is never saved twice.
      if (!keepsKey(e)) key.current = newIdempotencyKey();
      setBanner(`${W.saveFailed}${templateSaveReason(e)}`);
    }
  }

  if (saved) {
    return (
      <Sheet
        visible
        title={W.projectTitle}
        onClose={onClose}
        footer={
          <>
            <Button title={W.openTemplates} variant="secondary" onPress={() => openWebsitePage(baseUrl, '/templates')} accessibilityHint="Opens on the website" style={s.footerButton} />
            <Button title={W.done} onPress={onClose} style={s.footerButton} />
          </>
        }
      >
        <TemplateSavedBody text={W.savedProject.replace('{name}', saved)} where={W.savedProjectWhere} />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      title={W.projectTitle}
      onClose={close}
      footer={<SheetButtons cancel={W.cancel} onCancel={close} confirm={W.save} onConfirm={() => void submit()} busy={saving} disabled={!d || !!blocked} />}
    >
      <SheetMessage text={banner} />
      <TextField
        label={W.name}
        required
        value={name}
        onChangeText={(v) => {
          setName(v);
          setNameError(null);
        }}
        maxLength={NAME_MAX}
        error={nameError}
        editable={!saving}
      />
      <TextField
        label={`${W.description} ${W.optional}`}
        value={description}
        onChangeText={setDescription}
        maxLength={DESCRIPTION_MAX}
        multiline
        placeholder={W.descriptionPlaceholder}
        style={s.description}
        textAlignVertical="top"
        editable={!saving}
      />

      {draftQ.isError && !d ? (
        <View style={s.problem}>
          <SheetMessage text={`${W.readFailed}${templateSaveReason(draftQ.error)}`} />
          <Button title={W.retry} variant="ghost" size="sm" onPress={() => void draftQ.refetch()} loading={draftQ.isRefetching} />
        </View>
      ) : !d ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={W.reading}>
          <Skeleton height={96} radius={radius.input} />
        </View>
      ) : (
        <>
          <View style={s.facts}>
            {saveProjectLines(d, withDescriptions).map((l) => (
              <Text key={l.text} style={[s.fact, l.tone === 'warning' && s.factWarning, l.tone === 'danger' && s.factDanger]} accessibilityRole={l.tone === 'danger' ? 'alert' : undefined}>
                {l.text}
              </Text>
            ))}
          </View>
          <View style={s.warn}>
            <Text style={s.warnText}>{publishWarning(withDescriptions ? W.projectWhat : W.projectWhatNoDescriptions)}</Text>
            <Toggle on={withDescriptions} onChange={setWithDescriptions} label={W.includeDescriptions} disabled={saving} />
          </View>
          {people.length ? (
            <View style={s.people}>
              <Text style={s.legend} accessibilityRole="header">
                {W.rolesHeading}
              </Text>
              <Text style={s.explain}>{W.rolesExplain}</Text>
              {people.map((p) => {
                const who = p.name ?? W.someoneLeft;
                const role = roles[p.id] ?? '';
                const note = personRoleNote(p.id, role, counts, assignedTo(p.id));
                return (
                  <View key={p.id} style={s.person}>
                    <Text style={s.personName} numberOfLines={1}>
                      {who}
                    </Text>
                    <Text style={[s.personNote, roleWontCount(role, counts) && s.personWarn]}>{note}</Text>
                    <TextField
                      accessibilityLabel={W.roleFor.replace('{name}', who)}
                      accessibilityHint={note}
                      value={role}
                      onChangeText={(v) => setRoles((r) => ({ ...r, [p.id]: v }))}
                      maxLength={ROLE_MAX}
                      placeholder={W.noRole}
                      editable={!saving}
                    />
                  </View>
                );
              })}
              <Text style={s.explain} accessibilityLiveRegion="polite">
                {rolesSummary(counts)}
              </Text>
            </View>
          ) : (
            <Text style={s.explain}>{W.nobodyAssigned}</Text>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Once saved: a tick, what was saved, and where it is listed. */
export function TemplateSavedBody({ text, where }: { text: string; where: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.saved}>
      <View style={s.tick}>
        <Icon name="misc.check" size={24} color={c.successText} />
      </View>
      <Text style={s.savedText} accessibilityLiveRegion="polite">
        {text}
      </Text>
      <Text style={s.explain}>{where}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    footerButton: { flex: 1 },
    description: { minHeight: 72, paddingTop: spacing.sm },
    facts: { gap: spacing.xs, borderRadius: radius.input, backgroundColor: c.ground, padding: spacing.md, marginBottom: spacing.md },
    fact: { fontSize: fontSize.sm, color: c.ink2 },
    factWarning: { color: c.warningText, ...font('500') },
    factDanger: { color: c.dangerText, ...font('500') },
    warn: { gap: spacing.xs, borderRadius: radius.input, borderWidth: 1, borderColor: c.warningSoft, backgroundColor: c.warningSoft, padding: spacing.md, marginBottom: spacing.md },
    warnText: { fontSize: fontSize.sm, ...font('500'), color: c.ink },
    problem: { gap: spacing.xs, alignItems: 'flex-start' },
    people: { gap: spacing.xs },
    legend: { ...typeStyle('subheading'), color: c.ink },
    explain: { fontSize: fontSize.sm, color: c.ink2 },
    person: { marginTop: spacing.sm },
    personName: { fontSize: fontSize.sm, color: c.ink },
    personNote: { ...typeStyle('caption'), color: c.ink3, marginBottom: spacing.xs },
    personWarn: { color: c.warningText, ...font('500') },
    saved: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
    tick: { width: 48, height: 48, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: c.successSoft },
    savedText: { ...typeStyle('subheading'), color: c.ink, textAlign: 'center' },
  });
