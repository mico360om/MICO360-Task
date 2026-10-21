import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Image, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { PREVIEW_TEXT, previewFailureText, type OfficePreview, type PreviewMode } from '../../lib/file-preview';
import { formatFileSize, type ApiAttachment } from '../../lib/attachments';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

type View_ = { text?: { text: string; cut: boolean }; office?: OfficePreview; error?: string };

/**
 * A task's file shown inside the app (4d), as the website's preview: a picture as itself; text and
 * CSV as plain text; a Word document's paragraphs, a workbook's sheets (a tab each, as a table you
 * can scroll across) or a deck's slides. "Download" opens the file as before; Back closes the
 * preview only.
 */
export function FilePreviewSheet({
  file,
  mode,
  href,
  loadText,
  loadOffice,
  onDownload,
  onClose,
}: {
  file: ApiAttachment | null;
  mode: PreviewMode | null;
  /** The file's address on this server (pictures). */
  href: string | null;
  loadText: (a: ApiAttachment) => Promise<{ text: string; cut: boolean }>;
  loadOffice: (a: ApiAttachment) => Promise<OfficePreview | null>;
  onDownload: (a: ApiAttachment) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>({});
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    setView({});
    setSheet(0);
    if (!file || !mode || mode === 'image') return;
    let live = true;
    const load = mode === 'office' ? loadOffice(file).then((office) => (office ? { office } : { error: PREVIEW_TEXT.failed })) : loadText(file).then((text) => ({ text }));
    load.then(
      (v) => live && setView(v),
      (e: unknown) => live && setView({ error: previewFailureText(e) }),
    );
    return () => {
      live = false;
    };
  }, [file, mode, loadText, loadOffice]);

  if (!file || !mode) return null;
  const loading = mode !== 'image' && !view.text && !view.office && !view.error;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <View style={s.head}>
          <View style={s.flex}>
            <Text style={s.name} numberOfLines={1} accessibilityRole="header">
              {file.filename}
            </Text>
            <Text style={s.size}>{formatFileSize(file.sizeBytes)}</Text>
          </View>
          <Button title="Download" variant="secondary" onPress={() => onDownload(file)} accessibilityLabel={`Download ${file.filename}`} />
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close preview" style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={s.body}>
          {view.error ? (
            <Text style={s.error} accessibilityRole="alert">
              {view.error}
            </Text>
          ) : loading ? (
            <ActivityIndicator style={s.loading} color={c.brand} accessibilityLabel="Loading the preview" />
          ) : mode === 'image' ? (
            href ? <Image source={{ uri: href }} style={s.image} resizeMode="contain" accessibilityLabel={file.filename} /> : <Text style={s.error}>{PREVIEW_TEXT.failed}</Text>
          ) : view.text ? (
            <ScrollView contentContainerStyle={s.pad}>
              <Text style={s.mono} selectable>
                {view.text.text}
              </Text>
              {view.text.cut ? <Text style={s.note}>{PREVIEW_TEXT.cut}</Text> : null}
            </ScrollView>
          ) : view.office ? (
            <OfficeView preview={view.office} sheet={sheet} onSheet={setSheet} s={s} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function OfficeView({ preview, sheet, onSheet, s }: { preview: OfficePreview; sheet: number; onSheet: (i: number) => void; s: Styles }) {
  if (preview.kind === 'document') {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        {preview.paragraphs.length === 0 ? <Text style={s.note}>{PREVIEW_TEXT.noText}</Text> : null}
        {preview.paragraphs.map((t, i) => (
          <Text key={i} style={s.para} selectable>
            {t}
          </Text>
        ))}
        {preview.truncated ? <Text style={s.note}>{PREVIEW_TEXT.cut}</Text> : null}
      </ScrollView>
    );
  }
  if (preview.kind === 'slides') {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        {preview.slides.map((sl) => (
          <View key={sl.number} style={s.slide}>
            <Text style={s.slideNo} accessibilityRole="header">
              Slide {sl.number}
            </Text>
            {sl.lines.length === 0 ? <Text style={s.note}>{PREVIEW_TEXT.noSlideText}</Text> : null}
            {sl.lines.map((l, i) => (
              <Text key={i} style={s.para} selectable>
                {l}
              </Text>
            ))}
          </View>
        ))}
        {preview.truncated ? <Text style={s.note}>{PREVIEW_TEXT.moreRows}</Text> : null}
      </ScrollView>
    );
  }
  const current = preview.sheets[Math.min(sheet, preview.sheets.length - 1)];
  return (
    <View style={s.flex}>
      {preview.sheets.length > 1 ? (
        <ScrollView horizontal style={s.tabs} contentContainerStyle={s.tabsRow} accessibilityRole="tablist">
          {preview.sheets.map((sh, i) => (
            <Pressable key={`${sh.name}${i}`} onPress={() => onSheet(i)} accessibilityRole="tab" accessibilityState={{ selected: i === sheet }} style={[s.tab, i === sheet && s.tabOn]}>
              <Text style={[s.tabText, i === sheet && s.tabTextOn]}>{sh.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {!current || current.rows.length === 0 ? (
        <Text style={[s.note, s.pad]}>{PREVIEW_TEXT.emptySheet}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.pad}>
          <ScrollView horizontal>
            <View accessibilityLabel={current.name}>
              {current.rows.map((row, r) => (
                <View key={r} style={[s.tr, r === 0 && s.th]}>
                  {row.map((cell, ci) => (
                    <Text key={ci} style={s.td} numberOfLines={2}>
                      {cell}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
          {current.truncated ? <Text style={s.note}>{PREVIEW_TEXT.moreRows}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, backgroundColor: c.surface },
    flex: { flex: 1 },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.line },
    name: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    size: { fontSize: fontSize.xs, color: c.ink3 },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontSize: fontSize.lg, color: c.ink2, fontWeight: '700' },
    body: { flex: 1, backgroundColor: c.ground },
    loading: { marginTop: spacing.xxl },
    error: { padding: spacing.lg, fontSize: fontSize.sm, color: c.danger, fontWeight: '600' },
    image: { flex: 1, width: '100%' },
    pad: { padding: spacing.md, gap: spacing.sm },
    mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: c.ink },
    para: { fontSize: fontSize.sm, color: c.ink, lineHeight: 20 },
    note: { fontSize: fontSize.xs, color: c.ink3 },
    slide: { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, backgroundColor: c.surface, padding: spacing.sm, gap: 4 },
    slideNo: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink3, textTransform: 'uppercase' },
    tabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: c.line },
    tabsRow: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
    tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
    tabOn: { backgroundColor: c.surface },
    tabText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    tabTextOn: { color: c.ink, fontWeight: '800' },
    tr: { flexDirection: 'row' },
    th: { backgroundColor: c.surface },
    td: { width: 140, borderWidth: 0.5, borderColor: c.line, paddingHorizontal: 6, paddingVertical: 4, fontSize: fontSize.xs, color: c.ink },
  });
