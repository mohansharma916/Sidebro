import React, { useState } from 'react';
import { Save, Check, FileText, Briefcase, Plus, BookOpen } from 'lucide-react';
import { ContextProfile } from '../types';

interface ContextProfileViewProps {
  initialProfile?: ContextProfile;
  onSaveProfile: (profile: ContextProfile) => void;
  onClose?: () => void;
}

export const ContextProfileView: React.FC<ContextProfileViewProps> = ({
  initialProfile,
  onSaveProfile,
  onClose,
}) => {
  const [profile, setProfile] = useState<ContextProfile>(
    initialProfile || {
      id: `profile-${Date.now()}`,
      name: 'Senior React Native Interview Profile',
      role: 'Staff Mobile & Fullstack Engineer',
      experience: '6 Years',
      resumeText: '',
      jobDescriptionText: '',
      projectNotesText: '',
      preferredLanguage: 'TypeScript',
    }
  );

  const [saved, setSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: '780px', margin: '32px auto', padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
            Context Profile & Knowledge Base
          </h2>
          <p style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
            Ground the AI assistant in your authentic achievements, projects, and target role requirements.
          </p>
        </div>

        {onClose && (
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '28px' }}>
        {/* Profile Name & Role */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              Profile Name
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={e => setProfile({ ...profile, name: e.target.value })}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: '0.88rem',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              Target Role & Experience
            </label>
            <input
              type="text"
              value={profile.role}
              onChange={e => setProfile({ ...profile, role: e.target.value })}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: '0.88rem',
              }}
            />
          </div>
        </div>

        {/* Resume Text */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 600, color: '#38bdf8', marginBottom: '6px' }}>
            <FileText size={14} /> Resume & Work Experience
          </label>
          <textarea
            rows={6}
            value={profile.resumeText}
            onChange={e => setProfile({ ...profile, resumeText: e.target.value })}
            placeholder="Paste your resume or key background points here..."
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '12px',
              color: '#f8fafc',
              fontSize: '0.84rem',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </div>

        {/* Job Description */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 600, color: '#c084fc', marginBottom: '6px' }}>
            <Briefcase size={14} /> Job Description / Role Requirements
          </label>
          <textarea
            rows={5}
            value={profile.jobDescriptionText}
            onChange={e => setProfile({ ...profile, jobDescriptionText: e.target.value })}
            placeholder="Paste the job requirements, tech stack details, and focus areas..."
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '12px',
              color: '#f8fafc',
              fontSize: '0.84rem',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </div>

        {/* Project Notes & Accomplishments */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>
            <BookOpen size={14} /> Project Accomplishments & STAR Stories
          </label>
          <textarea
            rows={5}
            value={profile.projectNotesText}
            onChange={e => setProfile({ ...profile, projectNotesText: e.target.value })}
            placeholder="Key metrics, incident resolutions, architectural accomplishments to cite during behavioral or system design questions..."
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '12px',
              color: '#f8fafc',
              fontSize: '0.84rem',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Saved Profile Successfully' : 'Save Context Profile'}
        </button>
      </form>
    </div>
  );
};
