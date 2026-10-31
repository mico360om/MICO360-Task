import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useServices } from '../../core/providers';
import { useSaveTaskTemplate } from '../../core/template-queries';
import { openWebsitePage } from '../../adapters/website';
import { Button, TextField, Toggle } from '../ui';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { TemplateSavedBody } from './SaveProjectTemplateSheet';
import { newIdempotencyKey } from '../../lib/idempotency';
import { keepsKey } from '../../lib/pending-keys';
import { publishWarning, saveTaskLine, templateSaveReason, TEMPLATE_SAVE_WORDS as W } from '../../lib/template-words';
import { fontSize, radius, spacing, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

const NAME_MAX = 191;

/**
 * "Save as template" for a task (whoever runs its project), as the website's SaveTaskTemplateDialog:
 * its title, description, priority and checklist, under a name. Its dates, people and project
 * aren't saved. Shown while open (one key per opening).
 */
export function SaveTaskTemplateSheet({
  taskId,
  taskTitle,
  description,
  checklistCount,
  onClose,
}: {
  taskId: string;
  taskTitle: string;
  /** The task's description (with none, there is nothing to leave out). */
  description: string | null | undefined;
  checklistCount: number;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const save = useSaveTaskTemplate(taskId);
  const key = useRef(newIdempotencyKey());
  const [name, setName] = useState(taskTitle);
  const [withDescription, setWithDescription] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const saving = save.isPending;
  const hasDescription = !!description?.trim();
  const close = () => {
    if (!saving) onClose();
  };

  async function submit() {
    if (saving) return;
    setBanner(null);
    try {
      const t = await save.mutateAsync({ input: { name: name.trim() || taskTitle, includeDescription: withDescription }, key: key.current });
      setSaved(t.name);
    } catch (e) {
      if (!keepsKey(e)) key.current = newIdempotencyKey();
      setBanner(`${W.saveFailed}${templateSaveReason(e)}`);
    }
  }

  if (saved) {
    return (
      <Sheet
        visible
        title={W.taskTitle}
        onClose={onClose}
        footer={
          <>
            <Button title={W.openTemplates} variant="secondary" onPress={() => openWebsitePage(baseUrl, '/templates?tab=tasks')} accessibilityHint="Opens on the website" style={s.footerButton} />
            <Button title={W.done} onPress={onClose} style={s.footerButton} />
          </>
        }
      >
        <TemplateSavedBody text={W.savedTask.replace('{name}', saved)} where={W.savedTaskWhere} />
      </Sheet>
    );
  }

  return (
    <Sheet visible title={W.taskTitle} onClose={close} footer={<SheetButtons cancel={W.cancel} onCancel={close} confirm={W.save} onConfirm={() => void submit()} busy={saving} />}>
      <SheetMessage text={banner} />
      <Text style={s.line}>{saveTaskLine({ description, checklistCount }, withDescription)}</Text>
      <View style={s.warn}>
        <Text style={s.warnText}>{publishWarning(withDescription && hasDescription ? W.taskWhat : W.taskWhatNoDescription)}</Text>
        {hasDescription ? <Toggle on={withDescription} onChange={setWithDescription} label={W.includeDescription} disabled={saving} /> : null}
      </View>
      <TextField label={W.name} value={name} onChangeText={setName} maxLength={NAME_MAX} editable={!saving} accessibilityHint={W.taskNameHint} />
      <Text style={s.hint} importantForAccessibility="no">
        {W.taskNameHint}
      </Text>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    footerButton: { flex: 1 },
    line: { fontSize: fontSize.sm, color: c.ink2, marginBottom: spacing.md },
    warn: { gap: spacing.xs, borderRadius: radius.input, borderWidth: 1, borderColor: c.warningSoft, backgroundColor: c.warningSoft, padding: spacing.md, marginBottom: spacing.md },
    warnText: { fontSize: fontSize.sm, ...font('500'), color: c.ink },
    hint: { fontSize: fontSize.xs, color: c.ink2, marginTop: -spacing.sm },
  });
