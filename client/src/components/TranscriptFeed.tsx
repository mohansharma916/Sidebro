import React, { useState, useRef, useEffect } from 'react';
import { Search, User, Bot, Sparkles, ArrowDown } from 'lucide-react';
import { TranscriptItem } from '../types';

interface TranscriptFeedProps {
  transcripts: TranscriptItem[];
  onAskAboutItem?: (text: string) => void;
}

export const TranscriptFeed: React.FC<TranscriptFeedProps> = ({
  transcripts,
  onAskAboutItem,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const filteredTranscripts = transcripts.filter(t =>
    t.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts, autoScroll]);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
      {/* Search & Auto-Scroll Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '0 4px',
      }}>
        {/* Search Input */}
        <div style={{
          position: 'relative',
          flex: 1,
          maxWidth: '320px',
        }}>
          <Search size={14} color="#64748b" style={{ position: 'absolute', left: '12px', top: '10px' }} />
          <input
            type="text"
            placeholder="Search transcript..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '7px 12px 7px 34px',
              color: '#f8fafc',
              fontSize: '0.84rem',
              outline: 'none',
            }}
          />
        </div>

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`chip ${autoScroll ? 'active' : ''}`}
          style={{ fontSize: '0.74rem' }}
        >
          <ArrowDown size={12} /> Auto-scroll {autoScroll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Transcript Chat Bubbles (PRD Section 27) */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        maxHeight: '620px',
        paddingRight: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {filteredTranscripts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
            <p style={{ fontSize: '0.88rem' }}>No transcript recorded yet.</p>
            <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>
              Audio from your microphone and system audio will appear here in real time.
            </p>
          </div>
        ) : (
          filteredTranscripts.map(t => {
            const isYou = t.speaker === 'YOU';
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isYou ? 'flex-end' : 'flex-start',
                }}
              >
                {/* Speaker Label & Time */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '4px',
                  fontSize: '0.72rem',
                  color: '#64748b',
                }}>
                  {isYou ? (
                    <>
                      <span>{formatTimestamp(t.timestamp)}</span>
                      <span style={{ color: '#00f2fe', fontWeight: 600 }}>YOU (Mic)</span>
                      <User size={12} color="#00f2fe" />
                    </>
                  ) : (
                    <>
                      <Bot size={12} color="#f59e0b" />
                      <span style={{ color: '#f59e0b', fontWeight: 600 }}>OTHER (Speaker)</span>
                      <span>{formatTimestamp(t.timestamp)}</span>
                    </>
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: '85%',
                    background: isYou
                      ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.12) 0%, rgba(14, 165, 233, 0.16) 100%)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isYou
                      ? '1px solid rgba(0, 242, 254, 0.3)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: isYou ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    padding: '12px 16px',
                    position: 'relative',
                  }}
                >
                  <p style={{
                    fontSize: '0.92rem',
                    color: isYou ? '#e0f2fe' : '#f1f5f9',
                    lineHeight: 1.5,
                  }}>
                    {t.text}
                  </p>

                  {/* Ask AI shortcut on hover/touch */}
                  {!isYou && onAskAboutItem && (
                    <button
                      onClick={() => onAskAboutItem(t.text)}
                      style={{
                        marginTop: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(0, 242, 254, 0.1)',
                        border: '1px solid rgba(0, 242, 254, 0.25)',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '0.72rem',
                        color: '#00f2fe',
                        cursor: 'pointer',
                      }}
                    >
                      <Sparkles size={11} /> Generate Answer
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
