import React from 'react';

/**
 * Strips all markdown symbols (**, *, `, #, bullet marks) for pure clean text
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/^###+\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[•\-\*]\s+/gm, '')
    .replace(/\*\*/g, '')
    .trim();
}

interface FormattedTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders text cleanly without raw markdown symbols leaking to the UI.
 * - Parses **bold** into highlighted strong elements
 * - Parses `code` into styled inline code badges
 * - Strips any stray or unpaired ** asterisks
 */
export const FormattedText: React.FC<FormattedTextProps> = ({ text, className, style }) => {
  if (!text) return null;

  // First clean any isolated triple or double asterisks that have no match
  const sanitized = text.replace(/(?<!\*)\*{2}(?!\*)/g, (match, offset, str) => {
    // If there's an even number of **, keep them for the regex split below
    return match;
  });

  // Split by markdown bold (**...**) and inline code (`...`)
  const parts = sanitized.split(/(\*\*.*?\*\*|`.*?`)/g);

  return (
    <span className={className} style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          const content = part.slice(2, -2).trim();
          return (
            <strong key={i} style={{ color: '#ffffff', fontWeight: 600 }}>
              {content}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
          const content = part.slice(1, -1);
          return (
            <code
              key={i}
              style={{
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                padding: '1px 5px',
                borderRadius: '4px',
                fontSize: '0.88em',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              {content}
            </code>
          );
        }
        // Remove any stray unpaired asterisks from the plain text segment
        const cleanPlain = part.replace(/\*\*/g, '');
        return cleanPlain;
      })}
    </span>
  );
};
