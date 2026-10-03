import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  HelpCircle,
  Zap,
  Download,
  CheckCircle2,
  AlertTriangle,
  FileText,
  PowerOff,
} from 'lucide-react';
import { PostSessionSummary } from '../types';

interface PostSessionViewProps {
  sessionId: string;
  onEndSession?: () => void;
  isSessionActive?: boolean;
}

export const PostSessionView: React.FC<PostSessionViewProps> = ({
  sessionId,
  onEndSession,
  isSessionActive,
}) => {
  const [summary, setSummary] = useState<PostSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = () => {
    fetch(`/api/sessions/${sessionId}/summary`)
      .then(res => res.json())
      .then(data => {
        setSummary(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('[PostSession] Failed to fetch summary:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSummary();
  }, [sessionId]);

  const handleExportMarkdown = () => {
    if (!summary) return;
    let md = `# SideBro AI - Interview Debrief\n`;
    md += `**Date:** ${new Date().toLocaleDateString()}\n`;
    md += `**Duration:** ${Math.floor(summary.durationSeconds / 60)}m ${summary.durationSeconds % 60}s\n`;
    md += `**Total Questions:** ${summary.totalQuestions}\n`;
    md += `**Average AI Latency:** ${summary.avgResponseLatencyMs}ms\n\n`;

    md += `## Topics Covered\n`;
    summary.topicsDiscussed.forEach(t => { md += `- ${t}\n`; });

    md += `\n## Topics to Review\n`;
    summary.topicsToReview.forEach(t => { md += `- ${t}\n`; });

    md += `\n## Questions & Answers Log\n`;
    summary.questions.forEach((q, idx) => {
      md += `\n### ${idx + 1}. [${q.type}] ${q.question}\n`;
      md += `> ${q.answerExcerpt}\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-summary-${sessionId}.md`;
    a.click();
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
        Generating post-session analysis...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
        No summary available yet.
      </div>
    );
  }

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header & Export controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
            Session Performance & Analytics
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            Post-session debrief, topic coverage, and review takeaways.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={handleExportMarkdown} className="btn btn-secondary btn-sm">
            <Download size={13} /> Export Report (.md)
          </button>
          {isSessionActive && onEndSession && (
            <button onClick={onEndSession} className="btn btn-danger btn-sm">
              <PowerOff size={13} /> End Session Now
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards (PRD Section 50) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        {/* Duration */}
        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #00f2fe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.74rem', marginBottom: '4px' }}>
            <Clock size={13} color="#00f2fe" /> DURATION
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
            {formatDuration(summary.durationSeconds)}
          </div>
        </div>

        {/* Questions */}
        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #10b981' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.74rem', marginBottom: '4px' }}>
            <HelpCircle size={13} color="#10b981" /> QUESTIONS
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
            {summary.totalQuestions}
          </div>
        </div>

        {/* Avg Latency */}
        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #a855f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.74rem', marginBottom: '4px' }}>
            <Zap size={13} color="#a855f7" /> 1ST TOKEN LATENCY
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
            {summary.avgResponseLatencyMs}ms
          </div>
        </div>

        {/* Notes */}
        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #f59e0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.74rem', marginBottom: '4px' }}>
            <FileText size={13} color="#f59e0b" /> SAVED NOTES
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
            {summary.notesCount}
          </div>
        </div>
      </div>

      {/* Topics Covered & Topics To Review */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        {/* Topics Discussed */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <CheckCircle2 size={16} color="#10b981" />
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              Topics Covered
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {summary.topicsDiscussed.map((t, idx) => (
              <span key={idx} className="chip active" style={{ fontSize: '0.76rem' }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Topics To Review */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <AlertTriangle size={16} color="#f59e0b" />
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              Topics To Review
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {summary.topicsToReview.length > 0 ? (
              summary.topicsToReview.map((t, idx) => (
                <span key={idx} className="badge badge-system" style={{ fontSize: '0.76rem' }}>
                  {t}
                </span>
              ))
            ) : (
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                All topics well balanced.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Questions & Suggested Answers History */}
      <div className="glass-panel" style={{ padding: '22px' }}>
        <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
          Questions Asked & AI Responses Log
        </h3>

        {summary.questions.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.84rem' }}>No questions detected in this session yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {summary.questions.map((q, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '10px',
                  padding: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#00f2fe', fontWeight: 700, fontSize: '0.8rem' }}>Q{idx + 1}.</span>
                  <span className="badge badge-technical" style={{ fontSize: '0.68rem' }}>{q.type}</span>
                  <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>{q.question}</span>
                </div>
                <p style={{ fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5, paddingLeft: '22px' }}>
                  {q.answerExcerpt}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy & Data Retention (PRD Section 54) */}
      <div className="glass-panel" style={{ padding: '20px', borderTop: '2px solid #10b981' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc' }}>
                Privacy & Data Retention (PRD Section 54)
              </span>
              <span style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: 600,
              }}>
                Zero Audio Storage Active
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px' }}>
              Raw audio is discarded immediately following transcription. You have full ownership to purge transcripts.
            </p>
          </div>

          <button
            onClick={async () => {
              if (window.confirm('Are you sure you want to permanently delete this session transcript and memory?')) {
                await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
                window.location.href = '/';
              }
            }}
            className="btn btn-danger btn-sm"
          >
            Delete Session & Transcripts
          </button>
        </div>
      </div>
    </div>
  );
};
