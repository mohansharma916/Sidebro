import { Controller, Get, Param, Query, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service.js';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly storageService: StorageService) {}

  @Get('overview')
  getOverview() {
    return this.storageService.getGlobalAnalytics();
  }

  @Get('coding-solutions')
  getCodingSolutions() {
    return this.storageService.getAllCodingSolutions();
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.storageService.searchArchive(q || '');
  }

  @Get('debug/:id')
  getDebugDump(@Param('id') id: string) {
    const dump = this.storageService.getSessionDebugDump(id);
    if (!dump.session) {
      throw new NotFoundException('Session not found in SQLite storage');
    }
    return dump;
  }

  @Get('export/:id/markdown')
  exportMarkdown(@Param('id') id: string, @Res() res: Response) {
    const dump = this.storageService.getSessionDebugDump(id);
    if (!dump.session) {
      throw new NotFoundException('Session not found');
    }

    let md = `# SideBro AI — Interview Debrief: ${dump.session.title}\n\n`;
    md += `**Date:** ${new Date(dump.session.createdAt).toLocaleString()}\n`;
    md += `**Type:** ${dump.session.type.toUpperCase()} • **Experience Level:** ${dump.session.experienceLevel.toUpperCase()}\n`;
    md += `**Duration:** ${Math.floor(dump.session.durationSeconds / 60)}m ${dump.session.durationSeconds % 60}s\n`;
    md += `**Status:** ${dump.session.status.toUpperCase()}\n\n`;

    if (dump.summary) {
      md += `## Analytics Overview\n`;
      md += `- **Total Questions:** ${dump.summary.totalQuestions}\n`;
      md += `- **Average Latency:** ${dump.summary.avgResponseLatencyMs}ms\n`;
      md += `- **Topics Discussed:** ${dump.summary.topicsDiscussed.join(', ')}\n`;
      md += `- **Topics to Review:** ${dump.summary.topicsToReview.join(', ') || 'None'}\n\n`;
    }

    md += `## Questions & Coding Solutions Log\n\n`;
    dump.questions.forEach((q, idx) => {
      const ans = dump.answers.find(a => a.questionId === q.id);
      md += `### ${idx + 1}. [${q.type}] ${q.questionText}\n`;
      if (ans) {
        md += `**Model:** \`${ans.model}\` • **1st Token:** ${ans.firstTokenLatencyMs || 0}ms • **Total Latency:** ${ans.totalLatencyMs || 0}ms\n\n`;
        md += `#### Direct Answer\n${ans.directAnswer}\n\n`;
        if (ans.keyPoints && ans.keyPoints.length > 0) {
          md += `#### Key Points\n`;
          ans.keyPoints.forEach(p => { md += `• ${p}\n`; });
          md += `\n`;
        }
        if (ans.exampleOrSnippet) {
          md += `#### Code / Implementation Blueprint\n\`\`\`typescript\n${ans.exampleOrSnippet}\n\`\`\`\n\n`;
        }
        if (ans.followUpQuestions && ans.followUpQuestions.length > 0) {
          md += `#### Anticipated Follow-up Questions\n`;
          ans.followUpQuestions.forEach((f, fIdx) => { md += `${fIdx + 1}. ${f}\n`; });
          md += `\n`;
        }
      } else {
        md += `*No answer recorded for this question.*\n\n`;
      }
    });

    if (dump.notes.length > 0) {
      md += `## Saved Notes\n\n`;
      dump.notes.forEach(n => {
        md += `- [${new Date(n.timestamp).toLocaleTimeString()}] ${n.text}\n`;
      });
      md += `\n`;
    }

    if (dump.transcripts.length > 0) {
      md += `## Raw Conversation Transcript\n\n`;
      dump.transcripts.forEach(t => {
        md += `**${t.speaker}** (${new Date(t.timestamp).toLocaleTimeString()}): ${t.text}\n\n`;
      });
      md += `\n`;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="interview-${dump.session.id}.md"`);
    res.send(md);
  }
}
