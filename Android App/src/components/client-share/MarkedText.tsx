import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '../../core/theme';
import { highlightNames } from '../../lib/name-highlight';
import { font } from '../../lib/typography';

/**
 * Text with the names of the project's people marked, as the website's client previews show them:
 * each name on the warning tint in ink (semi-bold), so staff see which names the client would read.
 */
export function MarkedText({ text, names, style }: { text: string; names: string[]; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  const pieces = highlightNames(text, names);
  return (
    <Text style={style}>
      {pieces.map((p, i) =>
        p.name ? (
          <Text key={i} style={[font('600'), { backgroundColor: c.warningSoft, color: c.ink }]}>
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}
