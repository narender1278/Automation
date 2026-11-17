import { StudioProject } from '../types/studio';

export function buildProjectMarkdown(project: StudioProject): string {
  const lines: string[] = [];
  lines.push(`# ${project.title}`);
  lines.push(`Niche: Motivational Storytelling (Imaginary, Historical & Mythological Short Stories)`);
  lines.push(`Last Updated: ${new Date(project.updatedAt).toLocaleString()}`);
  lines.push('');

  if (project.nicheStrategy) {
    const ns = project.nicheStrategy;
    lines.push('## 01. The Profitable Niche');
    lines.push(ns.nicheSummary);
    lines.push('');
    lines.push('### Audience Breakdown');
    ns.audienceBreakdown.forEach((a) => {
      lines.push(`- **${a.segment}**: ${a.mindset} (Desire: ${a.coreDesire})`);
    });
    lines.push('');
    lines.push('### Ranked Options');
    ns.rankedOptions.forEach((opt) => {
      lines.push(`${opt.rank}. **${opt.title}** — ${opt.summary} (${opt.effortLevel}, ${opt.monetizationFit})`);
    });
    lines.push('');
    lines.push(`**Strongest Recommendation:** ${ns.strongestRecommendation.optionTitle} — ${ns.strongestRecommendation.rationale}`);
    lines.push('');
  }

  if (project.contentIdeas.length > 0) {
    lines.push('## 02. Content Ideas & Shortlist');
    project.contentIdeas.forEach((idea) => {
      lines.push(
        `${idea.rankIndex}. **${idea.shortlisted ? '[Shortlisted] ' : ''}[${idea.category}] ${idea.title}** (${idea.recommendedFormat}) — Topic: ${idea.centralTopic} | Viewer: ${idea.targetViewer} | Why Watch: ${idea.reasonPeopleWatch}`,
      );
    });
    lines.push('');
  }

  if (project.scriptStage) {
    const s = project.scriptStage;
    lines.push('## 03. Faceless Video Script');
    lines.push(`**Topic:** ${s.topic} | **Audience:** ${s.targetAudience} | **Duration:** ${s.durationMinutes} min`);
    lines.push('');
    lines.push('### 10-Second Hook');
    lines.push(s.hook10Seconds);
    lines.push('');
    s.sections.forEach((sec, idx) => {
      lines.push(`### Section ${idx + 1}: ${sec.sectionTitle} (${sec.estimatedSeconds}s)`);
      lines.push(sec.narration);
      lines.push(`- *Pattern Interrupt:* ${sec.patternInterrupt}`);
      lines.push(`- *Transition:* ${sec.transitionLine}`);
      lines.push('');
    });
    lines.push('### Closing');
    lines.push(s.closingCallToAction);
    lines.push('');
  }

  if (project.visualPlan) {
    const vp = project.visualPlan;
    lines.push('## 04. 3D Visual & Scene Production Plan');
    lines.push(`- **Palette:** ${vp.styleBible.colorPalette}`);
    lines.push(`- **Lighting:** ${vp.styleBible.lightingDirection}`);
    lines.push(`- **Visual Style:** ${vp.styleBible.visualStyle}`);
    lines.push('');
    vp.scenes.forEach((sc) => {
      lines.push(`### Scene ${sc.sceneNumber}: ${sc.title} (${sc.durationSeconds}s)`);
      lines.push(`- **3D Choreography:** Action=${sc.action}, Camera=${sc.cameraPreset}, Lighting=${sc.lightingMood}, Set=${sc.stageSet}, Voice=${sc.voiceName}`);
      lines.push(`- **Narration Cue:** ${sc.narrationCue}`);
      lines.push(`- **Visual Description:** ${sc.visualDescription}`);
      lines.push(`- **AI Image Prompt:** ${sc.imagePrompt}`);
      lines.push(`- **AI Video Prompt:** ${sc.videoPrompt}`);
      lines.push(`- **B-Roll:** ${sc.brollSuggestion}`);
      lines.push(`- **On-Screen Text:** ${sc.onScreenText}`);
      lines.push('');
    });
  }

  if (project.packagingLab) {
    const pk = project.packagingLab;
    lines.push('## 05. Titles & Thumbnail Concepts');
    lines.push('### Top 3 Ranked Combinations');
    pk.topThree.forEach((t) => {
      lines.push(`${t.rank}. **${t.title}** + *${t.thumbnailConceptName}* — ${t.whyStrongest}`);
    });
    lines.push('');
    lines.push('### All 10 Titles');
    pk.titles.forEach((t) => {
      lines.push(`${t.rank}. ${t.title} (${t.angle}) — ${t.curiosityMechanism}`);
    });
    lines.push('');
    lines.push('### 5 Thumbnail Blueprints');
    pk.thumbnails.forEach((th) => {
      lines.push(`- **${th.conceptName}**: Text "${th.shortText}" | Subject: ${th.subject} | Background: ${th.background} | Composition: ${th.composition} | Colors: ${th.colors.join(', ')}`);
    });
    lines.push('');
  }

  if (project.growthPlan) {
    const gp = project.growthPlan;
    lines.push('## 06. 60-Day Growth Plan');
    lines.push(`Commitment: ${gp.hoursPerDay} hrs/day | Budget: ${gp.budget}`);
    lines.push('');
    gp.weeklyMilestones.forEach((wk) => {
      lines.push(`### Week ${wk.weekNumber}: ${wk.phaseTitle}`);
      lines.push(`- **Research:** ${wk.research}`);
      lines.push(`- **Scripting:** ${wk.scripting}`);
      lines.push(`- **Production:** ${wk.production}`);
      lines.push(`- **Publishing:** ${wk.publishing}`);
      lines.push(`- **Shorts:** ${wk.shorts}`);
      lines.push(`- **Engagement:** ${wk.engagement}`);
      lines.push('');
    });
    lines.push(`*Note:* ${gp.disclaimer}`);
  }

  return lines.join('\n');
}
