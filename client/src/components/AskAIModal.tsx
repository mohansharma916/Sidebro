import React, { useState } from 'react';
import { Send, Sparkles, MessageSquare, Terminal } from 'lucide-react';

interface AskAIModalProps {
  onAsk: (questionText: string) => void;
  isOpen?: boolean;
}

export const AskAIModal: React.FC<AskAIModalProps> = ({ onAsk }) => {
  const [input, setInput] = useState('');

  const quickPrompts = [
    "Give me code example",
    "Explain simply",
    "What are the trade-offs?",
    "Compare with old architecture",
    "Give STAR response",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onAsk(input.trim());
    setInput('');
  };

  const handleSelectQuickPrompt = (prompt: string) => {
    onAsk(prompt);
  };

  return (
    <div className="glass-panel" style={{ padding: '14px 18px', marginTop: '16px' }}>
      {/* Quick Prompts Row (PRD Section 41) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        overflowX: 'auto',
        paddingBottom: '8px',
        marginBottom: '10px',
      }}>
        <span style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Sparkles size={11} color="#00f2fe" /> Quick:
        </span>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSelectQuickPrompt(p)}
            className="chip"
            style={{ fontSize: '0.74rem', padding: '4px 10px' }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Manual Input Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="text"
          placeholder="Ask AI anything about the conversation..."
          value={input}
          onChange={e => setInput(e.target.value)}
          style={{
            flex: 1,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '10px',
            padding: '10px 14px',
            color: '#f8fafc',
            fontSize: '0.88rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="btn btn-primary"
          style={{ padding: '10px 16px', opacity: input.trim() ? 1 : 0.5 }}
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
};
