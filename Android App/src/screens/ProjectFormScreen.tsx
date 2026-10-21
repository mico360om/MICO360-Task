import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert, AccessibilityInfo, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useDirectory, useProject, useProjects } from '../core/queries';
import { useCodeCheck, useSaveProject } from '../core/project-queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { Button, ErrorNote, Loader, TextField } from '../components/ui';
import { ChipChoice, InlinePicker } from '../components/meeting/sheet-kit';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { IdentityPicker } from '../components/project/IdentityPicker';
import { newIdempotencyKey } from '../lib/idempotency';
import { canEditProject } from '../lib/project-team';
import {
  CODE_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  PICTURE_TYPES,
  PROJECT_NUMBER_MAX,
  checkDraft,
  clientSuggestions,
  codeError,
  codeNote,
  draftOf,
  isDirty,
  nameChanged,
  pictureChoiceFor,
  picturePart,
  pictureProblem,
  priorityOptions,
  statusOptions,
  typedCode,
  type PictureChoice,
  type ProjectDraft,
} from '../lib/project-form';
import { displayName, type ApiProject } from '../lib/types';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * New project and Edit project (5b, administrators), as the website's form: the look (icon and
 * colour, or a picture), name and code, client, project number, description, status, priority and
 * owner. The code is suggested from the name until it is typed in, is checked as it is typed and
 * can't change later. Saving shows progress and can't be sent twice; what was typed stays after an
 * error; leaving with changes asks first. It needs a connection, as on the website.
 */
export function ProjectFormScreen({ route, navigation }: AppScreenProps<'ProjectForm'>) {
  const projectId = route.params?.projectId;
  const user = useSession()?.user ?? null;
  const projectQ = useProject(projectId ?? '');
  if (!canEditProject(user)) {
    return <Blocked text="Only an administrator can create or edit projects." />;
  }
  if (projectId && projectQ.isLoading) return <Loader />;
  if (projectId && !projectQ.data) {
    return <Blocked text="Couldn’t load this project. Check your connection and try again." onRetry={() => void projectQ.refetch()} />;
  }
  return <ProjectForm key={projectId ?? 'new'} project={projectQ.data ?? null} navigation={navigation} />;
}

function Blocked({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.ground, padding: spacing.lg }}>
      <ErrorNote message={text} onRetry={onRetry} />
    </View>
  );
}

function ProjectForm({ project, navigation }: { project: ApiProject | null; navigation: AppScreenProps<'ProjectForm'>['navigation'] }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const save = useSaveProject();
  const projectsQ = useProjects();
  const dirQ = useDirectory();

  // After "create" succeeds but its picture doesn't, the form carries on editing the new project.
  const [saved, setSaved] = useState<ApiProject | null>(project);
  const editing = !!saved;
  const [initial, setInitial] = useState<ProjectDraft>(() => draftOf(project));
  const [draft, setDraft] = useState<ProjectDraft>(() => draftOf(project));
  const [picture, setPicture] = useState<PictureChoice>({ kind: 'keep' });
  const [codeTouched, setCodeTouched] = useState(editing);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [serverCodeError, setServerCodeError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [pictureIssue, setPictureIssue] = useState<string | null>(null);
  const busy = useRef(false);
  const left = useRef(false);
  const key = useRef(newIdempotencyKey());
  const nameRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  const codeQ = useCodeCheck(draft.code, !editing);
  const check = !editing && codeQ.data && codeQ.data.code === draft.code ? codeQ.data : null;
  const codeErr = errors.code ?? codeError(draft.code, { editing, check, serverError: serverCodeError });
  const note = codeNote({ editing, code: draft.code, error: codeErr, check });
  const dirty = isDirty(initial, draft, picture);
  const set = (patch: Partial<ProjectDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const clients = useMemo(() => clientSuggestions(projectsQ.data ?? [], draft.clientName), [projectsQ.data, draft.clientName]);
  const owners = useMemo(
    () => [{ value: '', label: 'No owner' }, ...(dirQ.data ?? []).filter((u) => u.active !== false || u.id === draft.ownerId).map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }))],
    [dirQ.data, draft.ownerId],
  );
  const look = {
    name: draft.name || 'New project',
    color: draft.color,
    icon: draft.icon,
    // A newly picked picture shows from the phone; the preview shows the saved one otherwise.
    imageUrl: picture.kind === 'remove' ? null : picture.kind === 'new' ? null : saved?.imageUrl ?? null,
  };
  const hasPicture = picture.kind === 'new' || (picture.kind === 'keep' && !!saved?.imageUrl);

  // Leaving with changes not saved asks first; while saving, it waits.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (left.current || !dirty) return;
        e.preventDefault();
        if (busy.current) {
          Alert.alert('Still saving', 'Wait a moment until the project is saved.');
          return;
        }
        Alert.alert('Discard your changes?', 'What you entered for this project hasn’t been saved.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, dirty],
  );

  function onName(name: string) {
    const suggesting = !codeTouched && !editing;
    setDraft((d) => nameChanged(d, name, { codeTouched, editing }));
    if (errors.name || (suggesting && (errors.code || serverCodeError))) {
      setErrors((e) => ({ ...e, name: undefined, ...(suggesting ? { code: undefined } : {}) }));
      if (suggesting) setServerCodeError(null);
    }
  }
  function onCode(text: string) {
    setCodeTouched(true);
    set({ code: typedCode(text) });
    setErrors((e) => ({ ...e, code: undefined }));
    setServerCodeError(null);
  }

  async function pickPicture() {
    setPictureIssue(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: PICTURE_TYPES, copyToCacheDirectory: true, multiple: false });
    } catch {
      setPictureIssue('Couldn’t open your files. Please try again.');
      return;
    }
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    const problem = pictureProblem(asset);
    if (problem) {
      setPictureIssue(problem);
      return;
    }
    setPicture((cur) => pictureChoiceFor({ kind: 'new', part: picturePart(asset) }, cur, saved?.imageUrl));
    AccessibilityInfo.announceForAccessibility(`${asset.name ?? 'The picture'} will be the project’s picture when you save.`);
  }

  async function submit() {
    if (busy.current) return;
    const problems = checkDraft(draft, { editing, check });
    setErrors(problems);
    if (problems.name) return nameRef.current?.focus();
    if (problems.code) return codeRef.current?.focus();
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const out = await save({ saved, initial, draft, picture, idempotencyKey: key.current });
      if (out.kind === 'done') {
        left.current = true;
        AccessibilityInfo.announceForAccessibility(editing ? 'Changes saved.' : 'Project created.');
        if (editing) navigation.goBack();
        else navigation.replace('ProjectDetail', { projectId: out.project.id, projectName: out.project.name });
        return;
      }
      if (out.kind === 'code-taken') {
        key.current = newIdempotencyKey();
        setServerCodeError(out.message);
        codeRef.current?.focus();
        return;
      }
      if (out.kind === 'failed') {
        // A refusal was answered: the next try is a new one. With no answer, the same key is sent again.
        if (!out.retryable) key.current = newIdempotencyKey();
        setBanner(out.message);
        return;
      }
      // Partly saved: keep editing the project, with the picture still here to try again.
      key.current = newIdempotencyKey();
      const now = draftOf(out.project);
      setSaved(out.project);
      setCodeTouched(true);
      setInitial(editing ? draft : now);
      if (!editing) setDraft(now);
      setBanner(out.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {banner ? <ErrorNote message={banner} /> : null}

        <View style={s.identity}>
          <View accessible accessibilityRole="image" accessibilityLabel={hasPicture ? 'Project picture preview: a picture' : 'Project picture preview'}>
            {picture.kind === 'new' ? <PickedPreview uri={picture.part.uri} s={s} /> : <ProjectAvatar project={look} size="2xl" />}
          </View>
          <Button title="Change icon or image" variant="secondary" onPress={() => setLookOpen((o) => !o)} accessibilityLabel={lookOpen ? 'Hide icon and image choices' : 'Change icon or image'} style={s.lookButton} />
        </View>

        {lookOpen ? (
          <IdentityPicker
            color={draft.color}
            icon={draft.icon}
            hasPicture={hasPicture}
            pictureProblem={pictureIssue}
            onColor={(color) => set({ color })}
            onIcon={(icon) => set({ icon })}
            onPick={() => void pickPicture()}
            onRemovePicture={() => setPicture((cur) => pictureChoiceFor({ kind: 'remove' }, cur, saved?.imageUrl))}
            disabled={saving}
          />
        ) : null}

        <TextField
          label="Name"
          required
          inputRef={nameRef}
          value={draft.name}
          onChangeText={onName}
          maxLength={NAME_MAX}
          placeholder="e.g. Rig Inspection Portal"
          error={errors.name}
          editable={!saving}
        />

        <View>
          <TextField
            label="Code"
            required
            inputRef={codeRef}
            value={draft.code}
            onChangeText={onCode}
            maxLength={CODE_MAX}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="RIP"
            editable={!editing && !saving}
            style={editing ? s.readOnly : undefined}
            accessibilityHint={note.text}
          />
          <View style={s.codeNote} accessibilityLiveRegion="polite">
            <Text style={[s.note, note.tone === 'error' ? s.noteError : note.tone === 'success' ? s.noteOk : null]}>{note.text}</Text>
            {note.suggestion ? (
              <Pressable onPress={() => onCode(note.suggestion!)} accessibilityRole="button" accessibilityLabel={`Use ${note.suggestion}`} hitSlop={8} style={s.use}>
                <Text style={s.useText}>Use {note.suggestion}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View>
          <TextField label="Client (optional)" value={draft.clientName} onChangeText={(t) => set({ clientName: t })} maxLength={NAME_MAX} placeholder={clients.length ? 'Type or pick a client' : 'e.g. Petroleum Development Oman'} editable={!saving} />
          {clients.length ? (
            <View style={s.clients}>
              {clients.map((name) => (
                <Pressable key={name} onPress={() => set({ clientName: name })} accessibilityRole="button" accessibilityLabel={`Client: ${name}`} style={({ pressed }) => [s.clientChip, pressed && s.pressed]}>
                  <Text style={s.clientText}>{name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View>
          <TextField label="Project number (optional)" value={draft.number} onChangeText={(t) => set({ number: t })} maxLength={PROJECT_NUMBER_MAX} autoCorrect={false} placeholder="e.g. PDO-2026-014" editable={!saving} />
          <Text style={s.note}>The client’s job or contract number, if there is one.</Text>
        </View>

        <TextField
          label="Description (optional)"
          value={draft.description}
          onChangeText={(t) => set({ description: t })}
          maxLength={DESCRIPTION_MAX}
          multiline
          placeholder="What the project is for, its scope and goals"
          style={s.description}
          textAlignVertical="top"
          editable={!saving}
        />

        <ChipChoice label="Status" options={statusOptions(initial.status)} value={draft.status} onChange={(v) => set({ status: v })} disabled={saving} />
        <ChipChoice label="Priority" options={priorityOptions()} value={draft.priority} onChange={(v) => set({ priority: v })} disabled={saving} />

        <View>
          <InlinePicker label="Owner (optional)" options={owners} value={draft.ownerId} onChange={(v) => set({ ownerId: v })} placeholder="No owner" disabled={saving} />
          <Text style={s.note}>New tasks in this project are assigned to the owner unless you pick someone else — and anyone can reassign a task later.</Text>
        </View>
      </KeyboardAwareScrollView>
      <View style={s.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} disabled={saving} style={s.cancel} />
        <Button title={saving ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create project'} onPress={() => void submit()} loading={saving} style={s.submit} />
      </View>
    </SafeAreaView>
  );
}

/** A picked picture, as it will look (square, cropped to fit). */
function PickedPreview({ uri, s }: { uri: string; s: ReturnType<typeof makeStyles> }) {
  return <Image source={{ uri }} style={s.picked} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    pressed: { opacity: 0.7 },
    identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
    lookButton: { flexGrow: 1 },
    picked: { width: 96, height: 96, borderRadius: 24 },
    readOnly: { backgroundColor: c.ground, color: c.ink2 },
    codeNote: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: -spacing.sm },
    note: { fontSize: fontSize.sm, color: c.ink2 },
    noteError: { color: c.danger, fontWeight: '600' },
    noteOk: { color: c.success, fontWeight: '600' },
    use: { minHeight: 40, justifyContent: 'center' },
    useText: { fontSize: fontSize.sm, fontWeight: '800', color: c.brand, textDecorationLine: 'underline' },
    clients: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: -spacing.sm },
    clientChip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    clientText: { fontSize: fontSize.sm, color: c.ink },
    description: { minHeight: 110, paddingTop: spacing.sm },
    footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface },
    cancel: { flex: 1 },
    submit: { flex: 2 },
  });
