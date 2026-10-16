import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ClipboardList, Copy, X } from 'lucide-react';
import { AnswerSource, GeneratedAnswer } from '../types';
import { FormattedText } from './FormattedText';

export type CodingSource = Exclude<AnswerSource, 'voice'>;

/** One coding panel: the latest answer for its source plus a transient status (capturing, errors). */
export interface CodingLane {
  answer: GeneratedAnswer | null;
  status: string | null;
}

export type CodingLanes = Record<CodingSource, CodingLane>;

export const EMPTY_CODING_LANES: CodingLanes = {
  clipboard: { answer: null, status: null },
  screen: { answer: null, status: null },
};

const SOURCE_META: Record<CodingSource, { label: string; color: string; Icon: typeof Camera }> = {
  clipboard: { label: 'From Clipboard', color: '#a78bfa', Icon: ClipboardList },
  screen: { label: 'From Screenshot', color: '#f59e0b', Icon: Camera },
};

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string; lang: string };

/** Splits streamed markdown into headings, bullets, paragraphs and fenced code (an unclosed fence is still code). */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let code: { lang: string; lines: string[] } | null = null;
  for (const line of lines) {
    const fence = line.trim().match(/^```\s*([\w+#.-]*)/);
    if (fence) {
      if (code) {
        blocks.push({ kind: 'code', text: code.lines.join('\n'), lang: code.lang });
        code = null;
      } else {
        code = { lang: fence[1], lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) blocks.push({ kind: 'heading', text: trimmed.replace(/^#+\s*/, '') });
    else if (/^[•\-*]\s+/.test(trimmed)) blocks.push({ kind: 'bullet', text: trimmed.replace(/^[•\-*]\s+/, '') });
    else blocks.push({ kind: 'text', text: trimmed });
  }
  if (code) blocks.push({ kind: 'code', text: code.lines.join('\n'), lang: code.lang });
  return blocks;
}

interface CodingAnswerPanelProps {
  source: CodingSource;
  lane: CodingLane;
  onDismiss: () => void;
  compact?: boolean;
}

/**
 * Coding solution for a copied problem or a screenshot. Rendered next to (never instead of) the
 * voice answer, and only while it has something to show.
 */
export const CodingAnswerPanel: React.FC<CodingAnswerPanelProps> = ({ source, lane, onDismiss, compact }) => {
  const { answer, status } = lane;
  const { label, color, Icon } = SOURCE_META[source];
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Bring a freshly started solution into view; the voice answer above keeps streaming untouched.
  useEffect(() => {
    if (answer?.id) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [answer?.id]);

  if (!answer && !status) return null;

  const blocks = parseBlocks(answer?.fullContent || '');
  const code = answer?.exampleOrSnippet || blocks.find(b => b.kind === 'code')?.text;
  const preview = source === 'clipboard' && answer ? answer.questionText : '';

  const handleCopyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fontSize = compact ? '0.78rem' : '0.86rem';

  return (
    <div
      ref={rootRef}
      style={{
        background: 'rgba(10, 15, 24, 0.85)',
        border: `1px solid ${color}55`,
        borderRadius: '10px',
        padding: compact ? '10px' : '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <Icon size={14} color={color} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          {answer && (
            <span style={{ fontSize: '0.62rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {answer.isComplete ? answer.model : 'Solving…'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {code && (
            <button
              onClick={handleCopyCode}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: copied ? '#10b981' : '#94a3b8',
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '0.65rem',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy code'}</span>
            </button>
          )}
          <button
            onClick={onDismiss}
            title="Hide this panel"
            style={{
              display: 'flex',
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              padding: '2px',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {status && (
        <div style={{ fontSize: '0.75rem', color: status.startsWith('⚠') ? '#f87171' : '#94a3b8' }}>{status}</div>
      )}

      {preview && (
        <div
          style={{
            fontSize: '0.7rem',
            color: '#94a3b8',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '6px',
            padding: '6px 8px',
            maxHeight: '3.2em',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}
        >
          {preview}
        </div>
      )}

      {answer && (
        <div style={{ fontSize, lineHeight: 1.5, color: '#e2e8f0' }}>
          {blocks.length === 0 && !answer.isComplete && (
            <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Reading the problem…</div>
          )}
          {blocks.map((block, idx) => {
            switch (block.kind) {
              case 'heading':
                return (
                  <div
                    key={idx}
                    style={{
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color,
                      margin: idx === 0 ? '0 0 4px' : '10px 0 4px',
                    }}
                  >
                    {block.text}
                  </div>
                );
              case 'bullet':
                return (
                  <div key={idx} style={{ display: 'flex', gap: '6px', margin: '2px 0', color: '#cbd5e1' }}>
                    <span style={{ color }}>•</span>
                    <span><FormattedText text={block.text} /></span>
                  </div>
                );
              case 'code':
                return (
                  <pre
                    key={idx}
                    style={{
                      background: '#040711',
                      border: `1px solid ${color}33`,
                      borderRadius: '6px',
                      padding: '8px',
                      fontSize: compact ? '0.7rem' : '0.76rem',
                      fontFamily: 'var(--font-mono, monospace)',
                      color: '#e2e8f0',
                      overflowX: 'auto',
                      margin: '6px 0',
                      whiteSpace: 'pre',
                    }}
                  >
                    <code>{block.text}</code>
                  </pre>
                );
              default:
                return (
                  <div key={idx} style={{ margin: '2px 0' }}>
                    <FormattedText text={block.text} />
                  </div>
                );
            }
          })}
        </div>
      )}
    </div>
  );
};
