import { useState, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { fieldA11y } from '../../lib/a11y';
import { useColors } from '../../core/theme';
import { useKeepAboveKeyboard } from '../KeyboardAware';

/**
 * The website's Field: a label, an 8-radius box whose border turns brand while you type and red
 * with an error, and the error read out with the field.
 */
export function TextField({
  label,
  error,
  required,
  style,
  inputRef,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { label?: string; error?: string | null; required?: boolean; inputRef?: Ref<TextInput> }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  // Inside a KeyboardAwareScrollView, typing keeps the label, box and error above the keyboard.
  const keep = useKeepAboveKeyboard();
  // TalkBack names the field after its visible label and reads the error with it (MOB-10).
  const a11y = fieldA11y({
    label,
    placeholder: props.placeholder,
    required,
    error,
    explicitLabel: props.accessibilityLabel,
  });
  const border = error ? c.danger : focused ? c.brand : c.line;
  return (
    <View ref={keep.ref} collapsable={false} style={styles.wrap}>
      {label ? (
        <Text style={[typeStyle('label'), styles.label, { color: c.ink }]} importantForAccessibility="no">
          {label}
          {required ? <Text style={{ color: c.dangerText }}> *</Text> : null}
        </Text>
      ) : null}
      <TextInput
        ref={inputRef}
        placeholderTextColor={c.ink3}
        style={[styles.input, { borderColor: border, color: c.ink, backgroundColor: c.surface }, style]}
        {...props}
        {...a11y}
        onFocus={(e) => {
          setFocused(true);
          keep.onFocus();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          keep.onBlur();
          onBlur?.(e);
        }}
      />
      {error ? (
        <Text style={[typeStyle('caption'), styles.error, { color: c.dangerText }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { marginBottom: 4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    fontFamily: typeStyle('body').fontFamily,
    fontSize: 15,
  },
  error: { marginTop: 4 },
});
