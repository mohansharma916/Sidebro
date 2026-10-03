import { ContextProfile } from './types.js';

export interface DocumentChunk {
  id: string;
  source: 'resume' | 'jobDescription' | 'projectNotes' | 'manual';
  content: string;
  keywords: string[];
}

export class ContextEngine {
  private profiles: Map<string, ContextProfile> = new Map();
  private profileChunks: Map<string, DocumentChunk[]> = new Map();

  constructor() {
    // Seed default sample profile for instant demonstration
    this.seedDefaultProfile();
  }

  private seedDefaultProfile() {
    const defaultProfile: ContextProfile = {
      id: 'default-profile',
      name: 'Senior React Native & Fullstack Lead',
      role: 'Senior Staff Software Engineer',
      experience: '6 Years',
      preferredLanguage: 'TypeScript',
      resumeText: `
Summary:
Senior Software Engineer with 6+ years of experience architecting high-scale mobile and web applications with React Native, TypeScript, React, Node.js, and Distributed Cloud Systems.

Work Experience:
- Staff Mobile Engineer @ Apex Streaming (2022 - Present):
  * Spearheaded migration from legacy React Native Bridge to JSI and TurboModules architecture, reducing startup time by 42% and memory footprint by 35%.
  * Architected offline-first playback caching engine using SQLite and MMKV key-value store handling 12M monthly active users with 99.98% crash-free rate.
  * Designed end-to-end WebSocket real-time messaging pipeline processing 85,000 events/sec with sub-50ms delivery.

- Senior Frontend Engineer @ CloudSphere (2019 - 2022):
  * Re-architected core dashboard with React, Next.js, and React Query, improving Web Vitals LCP from 3.8s to 0.9s.
  * Managed team of 8 engineers, introduced automated CI/CD pipelines, Vitest unit testing, and Playwright E2E suites.

Technical Skills:
- Languages: TypeScript, JavaScript (ESNext), Python, SQL, C++ (JSI wrappers).
- Frameworks: React, React Native (Fabric, TurboModules, Hermes), Next.js, Node.js, Express, Fastify.
- Databases & Systems: PostgreSQL, Redis, Apache Kafka, DynamoDB, Docker, AWS (ECS, Lambda, S3).
      `.trim(),
      jobDescriptionText: `
Role: Senior Staff Mobile/Fullstack Architect
Requirements:
- Deep expertise in React Native new architecture (Fabric, TurboModules, JSI, Hermes).
- Hands-on experience scaling distributed real-time systems, WebSockets, and state synchronization.
- Strong knowledge of performance profiling (Systrace, Flipper, Chrome DevTools), memory leak debugging.
- Excellent communication and leadership skills with experience mentoring senior engineers and leading architectural RFCs.
      `.trim(),
      projectNotesText: `
Key Project Accomplishments:
1. Video OTT Playback Engine: Resolved critical frame drop issue on low-end Android devices by replacing standard FlatList with FlashList, optimizing image memoization, and offloading heavy JSON transforms to C++ background threads via JSI.
2. Production Incident Handling: When AWS Redis cache experienced severe memory eviction during Black Friday traffic spike, rapidly diagnosed cache-stampede vulnerability, implemented probabilistic early expiration (XFetch algorithm) and distributed mutex locking, restoring 100% service availability in 18 minutes.
3. Micro-frontend Design: Decoupled monolithic dashboard into federated micro-frontends with Module Federation, cutting build times by 65%.
      `.trim(),
    };

    this.saveProfile(defaultProfile);
  }

  public saveProfile(profile: ContextProfile): void {
    this.profiles.set(profile.id, profile);
    this.processAndChunkProfile(profile);
  }

  public getProfile(id: string): ContextProfile | undefined {
    return this.profiles.get(id);
  }

  public getAllProfiles(): ContextProfile[] {
    return Array.from(this.profiles.values());
  }

  public deleteProfile(id: string): boolean {
    this.profileChunks.delete(id);
    return this.profiles.delete(id);
  }

  /**
   * Splits profile text into searchable chunks and computes keyword frequency
   */
  private processAndChunkProfile(profile: ContextProfile): void {
    const chunks: DocumentChunk[] = [];

    const addChunksFromText = (
      text: string,
      source: 'resume' | 'jobDescription' | 'projectNotes'
    ) => {
      if (!text) return;
      // Split on double newlines or bullet points
      const paragraphs = text.split(/\n\s*\n|\n(?=[•\-\*]\s)/).filter(p => p.trim().length > 25);
      paragraphs.forEach((p, idx) => {
        const cleanContent = p.trim();
        const keywords = this.extractKeywords(cleanContent);
        chunks.push({
          id: `${profile.id}-${source}-${idx}`,
          source,
          content: cleanContent,
          keywords,
        });
      });
    };

    addChunksFromText(profile.resumeText, 'resume');
    addChunksFromText(profile.jobDescriptionText, 'jobDescription');
    addChunksFromText(profile.projectNotesText, 'projectNotes');

    this.profileChunks.set(profile.id, chunks);
  }

  /**
   * Tokenizes text and removes stop words
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'with', 'by',
      'about', 'of', 'from', 'as', 'that', 'this', 'it', 'or', 'are', 'was', 'were', 'be',
      'been', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'should', 'would'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9#+]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return Array.from(new Set(words));
  }

  /**
   * Retrieves top relevant chunks for a question using TF-IDF style keyword relevance
   */
  public retrieveContext(
    profileId: string | undefined,
    questionText: string,
    topK = 3
  ): { chunk: DocumentChunk; score: number }[] {
    if (!profileId) {
      profileId = 'default-profile';
    }

    const chunks = this.profileChunks.get(profileId);
    if (!chunks || chunks.length === 0) return [];

    const questionKeywords = this.extractKeywords(questionText);
    if (questionKeywords.length === 0) return [];

    const scoredChunks = chunks.map(chunk => {
      let score = 0;
      for (const qWord of questionKeywords) {
        if (chunk.keywords.includes(qWord)) {
          // Exact match
          score += 3;
        } else if (chunk.keywords.some(kw => kw.includes(qWord) || qWord.includes(kw))) {
          // Partial match
          score += 1.5;
        }
      }

      // Bonus for source relevance (projectNotes have rich STAR stories)
      if (chunk.source === 'projectNotes' && score > 0) score += 1;

      return { chunk, score };
    });

    return scoredChunks
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
