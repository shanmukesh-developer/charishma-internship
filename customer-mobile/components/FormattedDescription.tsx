// A product description shown the way the admin typed it (owner, 29 Oct 2026: "description is in this order but
// app showing weird one"): the text used to be squashed into one paragraph. Lines are kept:
//  - "Ingredients (Typical):"   a line ending in ":"  -> a small heading; the lines under it -> a bullet list
//  - "Spicy Level: Hot"         a short "Label: value" -> the label in bold, then the value
//  - anything else                                    -> a paragraph (blank lines separate paragraphs)
// A leading "Description:" heading is dropped (the section is already called Product details).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'row'; label: string; value: string }
  | { kind: 'para'; text: string };

/** Parses the admin's text into blocks (exported for tests / other screens). */
export function descriptionBlocks(raw: string): Block[] {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const out: Block[] = [];
  let underHeading = false;
  for (const line of lines) {
    if (!line) continue; // blank lines (often between list items) never end a list
    // Markdown pasted from an editor: "### Title" is a heading, "1. item" / "- item" a list item, **bold** kept.
    const md = line.match(/^#{1,6}\s+(.+)$/);
    if (md) {
      const text = md[1].replace(/\*\*|__/g, '').replace(/:$/, '').trim();
      if (text && !(!out.length && /^description$/i.test(text))) { out.push({ kind: 'heading', text }); underHeading = true; }
      continue;
    }
    const numbered = line.match(/^\d{1,2}[.)]\s+(.+)$/);
    if (numbered) { out.push({ kind: 'bullet', text: numbered[1] }); continue; }
    const clean = line.replace(/^[-•·]\s*/, '').replace(/^\*\s+/, '');
    const bare = clean.replace(/\*\*|__/g, '').trim();
    if (/:$/.test(bare) && bare.length <= 60) {
      const text = bare.slice(0, -1).trim();
      if (!out.length && /^description$/i.test(text)) continue;
      out.push({ kind: 'heading', text });
      underHeading = true;
      continue;
    }
    // "Label: value", also written "**Label:** value" (the bold marks are matched on a bare copy of the line).
    const m = bare.match(/^([^:]{2,34}):\s+(.+)$/);
    if (m && !/^https?$/i.test(m[1])) {
      out.push({ kind: 'row', label: m[1].trim(), value: m[2].trim() });
      underHeading = false;
      continue;
    }
    // Under a heading, short lines are list items; a full sentence (long, or ending in a full stop) is a paragraph
    // and ends the list.
    const shortItem = clean.length <= 70 && !/[.!?]$/.test(clean);
    if (/^[-•·]\s|^\*\s/.test(line) || (underHeading && shortItem)) { out.push({ kind: 'bullet', text: clean }); continue; }
    underHeading = false;
    out.push({ kind: 'para', text: clean });
  }
  return out;
}

/** True when the text has structure worth keeping (line breaks or Markdown); a one-line text stays a simple paragraph. */
export const isStructured = (raw: string) => /\n|\*\*|^#{1,6}\s/.test(String(raw || '').trim());

/** The text without any Markdown / list marks, lines joined: for 1-3 line previews (menu rows, store header). */
export function plainDescription(raw: string): string {
  return descriptionBlocks(raw)
    .map((b) => (b.kind === 'row' ? `${b.label}: ${b.value}` : b.text))
    .join(' · ')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first paragraph only (a store's short intro), Markdown removed. */
export function firstParagraph(raw: string): string {
  const first = descriptionBlocks(raw).find((b) => b.kind === 'para');
  return first && first.kind === 'para' ? first.text.replace(/\*\*|__/g, '').trim() : plainDescription(raw);
}

/** "**bold** text" -> bold runs inside the surrounding Text. */
function Inline({ text, strong }: { text: string; strong: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => (/^(\*\*|__).+(\*\*|__)$/.test(part)
        ? <Text key={i} style={{ fontWeight: '600', color: strong }}>{part.slice(2, -2)}</Text>
        : <Text key={i}>{part.replace(/\*\*|__/g, '')}</Text>))}
    </>
  );
}

export default function FormattedDescription({ text, color, strong }: { text: string; color: string; strong: string }) {
  const blocks = descriptionBlocks(text);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') return <Text key={i} style={[st.heading, { color: strong, marginTop: i ? 8 : 0 }]}>{b.text}</Text>;
        if (b.kind === 'bullet') {
          return (
            <View key={i} style={st.bulletRow}>
              <Text style={[st.dot, { color }]}>{'•'}</Text>
              <Text style={[st.body, { color, flex: 1 }]}><Inline text={b.text} strong={strong} /></Text>
            </View>
          );
        }
        if (b.kind === 'row') {
          return (
            <Text key={i} style={[st.body, { color, marginTop: i ? 2 : 0 }]}>
              <Text style={{ color: strong, fontWeight: '600' }}>{b.label}: </Text><Inline text={b.value} strong={strong} />
            </Text>
          );
        }
        return <Text key={i} style={[st.body, { color }]}><Inline text={b.text} strong={strong} /></Text>;
      })}
    </View>
  );
}

const st = StyleSheet.create({
  heading: { fontSize: 13.5, fontWeight: '600' },
  body: { fontSize: 13.5, fontWeight: '400', lineHeight: 20 },
  bulletRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  dot: { fontSize: 13.5, lineHeight: 20 },
});
