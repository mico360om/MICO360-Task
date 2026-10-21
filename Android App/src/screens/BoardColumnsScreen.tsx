import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, Alert, AccessibilityInfo, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectColumns, useProjectMembers } from '../core/queries';
import { useColumnActions } from '../core/board-queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { Button, ErrorNote, Loader, TextField } from '../components/ui';
import { ChipChoice, SheetMessage } from '../components/meeting/sheet-kit';
import { COLUMN_COLORS, COLUMN_TEXT, columnNameProblem, manageColumnsGate, orderedColumns } from '../lib/board-columns';
import { CATEGORY_LABEL } from '../lib/task-status';
import { colorName, customColor } from '../lib/project-identity';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiColumn, ColumnCategory } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

const STATUSES: ColumnCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];

/**
 * Manage columns (4b), as the website's: every column, hidden ones too, in board order — its
 * colour, its name, the status it stands for, whether it shows on the board, up and down, and
 * Delete (a column that still has tasks can't be deleted: the server says so). Then "Add a column".
 * For an administrator or a manager of the project (the server's rule, which has the last word). It
 * needs a connection, as on the website.
 */
export function BoardColumnsScreen({ route }: AppScreenProps<'BoardColumns'>) {
  const { projectId } = route.params;
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const user = useSession()?.user ?? null;
  const columnsQ = useProjectColumns(projectId);
  const membersQ = useProjectMembers(projectId);
  const actions = useColumnActions(projectId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<TextInput>(null);
  const columns = useMemo(() => orderedColumns(columnsQ.data ?? []), [columnsQ.data]);

  if (columnsQ.isLoading || membersQ.isLoading) return <Loader />;
  // The server's rule; offline with the team not kept here it can't be checked — said so, never a refusal (4b review #13).
  const gate = manageColumnsGate(user, membersQ.data ?? [], { membersKnown: !!membersQ.data });
  if (gate !== 'ok') {
    return (
      <View style={s.safe}>
        <View style={s.body}>
          {gate === 'refused' ? <ErrorNote message={COLUMN_TEXT.refused} /> : <ErrorNote message={COLUMN_TEXT.needsConnection} onRetry={() => void membersQ.refetch()} retrying={membersQ.isRefetching} />}
        </View>
      </View>
    );
  }

  /** One change at a time; what went wrong is said at the top (and spoken). */
  async function act(run: () => Promise<string | null>, done?: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const why = await run();
    setBusy(false);
    setProblem(why);
    AccessibilityInfo.announceForAccessibility(why ?? done ?? 'Saved.');
  }

  function add() {
    const bad = columnNameProblem(newName);
    if (bad) {
      setNameError(bad);
      nameRef.current?.focus();
      return;
    }
    const name = newName.trim();
    void act(async () => {
      const why = await actions.add(name);
      if (!why) setNewName('');
      return why;
    }, `Added ${name}.`);
  }

  function confirmDelete(col: ApiColumn) {
    Alert.alert('Delete column?', `Delete “${col.name}”? A column that still has tasks can’t be deleted — move them to another column first.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void act(() => actions.remove(col.id), `Deleted ${col.name}.`) },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {problem ? <SheetMessage text={problem} /> : null}
        {columnsQ.isError && !columnsQ.data ? <ErrorNote message="Couldn’t load the columns. Check your connection and try again." onRetry={() => void columnsQ.refetch()} retrying={columnsQ.isRefetching} /> : null}

        {columns.map((col, i) => (
          <ColumnRow
            key={col.id}
            col={col}
            first={i === 0}
            last={i === columns.length - 1}
            busy={busy}
            s={s}
            onRename={(name) => void act(() => actions.rename(col.id, name), `Renamed to ${name}.`)}
            onColour={(color) => void act(() => actions.recolour(col.id, color), `${col.name} is now ${colorName(color)}.`)}
            onCategory={(category) => void act(() => actions.setCategory(col.id, category), `${col.name} now stands for ${CATEGORY_LABEL[category]}.`)}
            onEnabled={(enabled) => void act(() => actions.setEnabled(col.id, enabled), enabled ? `${col.name} shows on the board.` : `${col.name} is hidden from the board.`)}
            onMove={(dir) => void act(() => actions.move(columns, col.id, dir), `Moved ${col.name} ${dir}.`)}
            onDelete={() => confirmDelete(col)}
          />
        ))}

        <View style={s.add}>
          <TextField
            inputRef={nameRef}
            label="Add a column"
            required
            value={newName}
            onChangeText={(v) => {
              setNewName(v);
              if (nameError) setNameError(null);
            }}
            placeholder="e.g. In Review"
            error={nameError}
            onSubmitEditing={add}
            returnKeyType="done"
            maxLength={191}
          />
          <Button title="＋ Add column" onPress={add} loading={busy} />
          <Text style={s.note}>{COLUMN_TEXT.addNote}</Text>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function ColumnRow({
  col,
  first,
  last,
  busy,
  s,
  onRename,
  onColour,
  onCategory,
  onEnabled,
  onMove,
  onDelete,
}: {
  col: ApiColumn;
  first: boolean;
  last: boolean;
  busy: boolean;
  s: Styles;
  onRename: (name: string) => void;
  onColour: (color: string) => void;
  onCategory: (category: ColumnCategory) => void;
  onEnabled: (enabled: boolean) => void;
  onMove: (dir: 'up' | 'down') => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(col.name);
  const [colours, setColours] = useState(false);
  const [custom, setCustom] = useState('');
  useEffect(() => setName(col.name), [col.name]);
  const saveName = () => {
    const v = name.trim();
    if (!v) return setName(col.name);
    if (v !== col.name) onRename(v);
  };
  const shown = col.enabled !== false;
  return (
    <View style={[s.row, !shown && s.rowHidden]}>
      <View style={s.rowTop}>
        <Pressable
          onPress={() => setColours((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Colour of ${col.name}: ${colorName(col.color)}`}
          accessibilityHint={colours ? 'Hides the colours' : 'Shows the colours to choose from'}
          accessibilityState={{ expanded: colours }}
          style={[s.swatch, { backgroundColor: col.color }]}
        />
        <View style={s.flex}>
          <TextField
            label={undefined}
            accessibilityLabel={`Name of ${col.name}`}
            value={name}
            onChangeText={setName}
            onBlur={saveName}
            onSubmitEditing={saveName}
            returnKeyType="done"
            maxLength={191}
            editable={!busy}
          />
        </View>
      </View>

      {colours ? (
        <View style={s.colours}>
          {COLUMN_COLORS.map((opt) => {
            const on = opt.value.toUpperCase() === col.color.toUpperCase();
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setColours(false);
                  if (!on) onColour(opt.value);
                }}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={opt.name}
                accessibilityState={{ selected: on, checked: on, disabled: busy }}
                style={[s.colour, { backgroundColor: opt.value }, on && s.colourOn]}
              />
            );
          })}
          <View style={s.customRow}>
            <View style={s.flex}>
              <TextField label="Or a colour code" value={custom} onChangeText={setCustom} placeholder="#1E5A8B" autoCapitalize="characters" autoCorrect={false} maxLength={7} />
            </View>
            <Button
              title="Use"
              variant="secondary"
              disabled={!customColor(custom) || busy}
              onPress={() => {
                const hex = customColor(custom);
                if (!hex) return;
                setColours(false);
                setCustom('');
                onColour(hex);
              }}
            />
          </View>
        </View>
      ) : null}

      <ChipChoice<ColumnCategory>
        label={`Status of ${col.name}`}
        options={STATUSES.map((cat) => ({ value: cat, label: CATEGORY_LABEL[cat] ?? cat }))}
        value={col.category}
        onChange={(cat) => {
          if (cat !== col.category) onCategory(cat);
        }}
        disabled={busy}
      />

      <View style={s.rowBottom}>
        <View style={s.visible}>
          <Switch value={shown} onValueChange={onEnabled} disabled={busy} accessibilityLabel={`Show ${col.name} on the board`} />
          <Text style={s.visibleText} importantForAccessibility="no">
            {shown ? 'Visible' : 'Hidden'}
          </Text>
        </View>
        <View style={s.moves}>
          <IconBtn glyph="▲" label={`Move ${col.name} up`} disabled={first || busy} onPress={() => onMove('up')} s={s} />
          <IconBtn glyph="▼" label={`Move ${col.name} down`} disabled={last || busy} onPress={() => onMove('down')} s={s} />
          <IconBtn glyph="🗑" label={`Delete ${col.name}`} disabled={busy} onPress={onDelete} s={s} danger />
        </View>
      </View>
    </View>
  );
}

function IconBtn({ glyph, label, disabled, onPress, s, danger }: { glyph: string; label: string; disabled?: boolean; onPress: () => void; s: Styles; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.iconBtn, danger && s.iconDanger, pressed && s.pressed, disabled && s.disabled]}
    >
      <Text style={[s.iconText, danger && s.iconTextDanger]}>{glyph}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    flex: { flex: 1 },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.35 },
    row: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.md, gap: spacing.sm },
    rowHidden: { opacity: 0.75 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    swatch: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: c.line },
    colours: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    colour: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
    colourOn: { borderColor: c.ink },
    customRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, width: '100%' },
    rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
    visible: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    visibleText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    moves: { flexDirection: 'row', gap: spacing.xs },
    iconBtn: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
    iconDanger: { borderColor: c.dangerSoft, backgroundColor: c.dangerSoft },
    iconText: { fontSize: fontSize.md, color: c.ink2, fontWeight: '700' },
    iconTextDanger: { color: c.danger },
    add: { gap: spacing.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.lg, padding: spacing.md, backgroundColor: c.surface },
    note: { fontSize: fontSize.sm, color: c.ink3 },
  });
