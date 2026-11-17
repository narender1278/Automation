import React, { useState } from 'react';
import { FileText, Copy, Check, ArrowRight, Zap } from 'lucide-react';
import type { ContentIdea, ScriptData } from '../types/studio';

interface Stage3ScriptProps {
  ideas: ContentIdea[];
  script: ScriptData | null;
  topic: string;
  targetAudience: string;
  durationMinutes: number;
  storySource: string;
  onChangeTopic: (val: string) => void;
  onChangeTargetAudience: (val: string) => void;
  onChangeDurationMinutes: (val: number) => void;
  onChangeStorySource: (val: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  onSendToVisuals: () => void;
  onSendToPackaging: () => void;
}

const DURATIONS = [2, 3, 5, 8];
const STORY_SOURCES = [
  'Historical Turning Point',
  'Mythological Parable',
  'Original Imaginary Fable',
  'Hybrid Story + Practical Lesson',
];

export function Stage3Script({
  ideas,
  script,
  topic,
  targetAudience,
  durationMinutes,
  storySource,
  onChangeTopic,
  onChangeTargetAudience,
  onChangeDurationMinutes,
  onChangeStorySource,
  isGenerating,
  onGenerate,
  onSendToVisuals,
  onSendToPackaging,
}: Stage3ScriptProps) {
  const [copied, setCopied] = useState(false);

  const handleSelectIdea = (ideaId: string) => {
    const found = ideas.find((i) => i.id === ideaId);
    if (!found) return;
    onChangeTopic(found.title);
    onChangeTargetAudience(found.targetViewer);
  };

  const handleCopyScript = async () => {
    if (!script) return;
    const text = [
      `HOOK (0:00–0:10)\n${script.hook10Seconds}`,
      ...script.sections.map(
        (s, i) =>
          `\nSECTION ${i + 1}: ${s.sectionTitle} (${s.estimatedSeconds}s)\n${s.narration}\n[Pattern Interrupt: ${s.patternInterrupt}]\n[Transition: ${s.transitionLine}]`,
      ),
      `\nCLOSING\n${script.closingCallToAction}`,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Fixed Left Config Rail (320px) */}
      <aside className="flex w-[320px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-5">
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Script Parameters
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Faceless spoken-word script with a 10-second hook, pattern interrupts, and zero filler.
            </p>
          </div>

          {ideas.length > 0 && (
            <div>
              <label
                htmlFor="pick-idea-select"
                className="block text-xs font-medium text-slate-300"
              >
                Load From Stage 2 Top List
              </label>
              <select
                id="pick-idea-select"
                defaultValue=""
                onChange={(e) => handleSelectIdea(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
              >
                <option value="" disabled>
                  Choose from generated or shortlisted ideas...
                </option>
                {ideas.map((idea) => (
                  <option key={idea.id} value={idea.id}>
                    #{idea.rankIndex} · {idea.shortlisted ? '[Saved] ' : ''}{idea.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="script-topic" className="block text-xs font-medium text-slate-300">
              Story Topic / Title
            </label>
            <textarea
              id="script-topic"
              rows={3}
              value={topic}
              onChange={(e) => onChangeTopic(e.target.value)}
              placeholder="e.g., The Potter Who Fired His Own Mistakes Into Strength"
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="script-audience" className="block text-xs font-medium text-slate-300">
              Target Audience
            </label>
            <input
              id="script-audience"
              type="text"
              value={targetAudience}
              onChange={(e) => onChangeTargetAudience(e.target.value)}
              placeholder="e.g., Exam aspirants & young creators"
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-300">Video Length</span>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {DURATIONS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => onChangeDurationMinutes(mins)}
                  className={`font-mono-tabular rounded py-1.5 text-xs font-medium transition-colors ${
                    durationMinutes === mins
                      ? 'bg-amber-500 text-slate-950'
                      : 'border border-white/10 bg-[#0B0F19] text-slate-300 hover:text-slate-100'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="story-source" className="block text-xs font-medium text-slate-300">
              Storytelling Mode
            </label>
            <select
              id="story-source"
              value={storySource}
              onChange={(e) => onChangeStorySource(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
            >
              {STORY_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={onSendToVisuals}
            disabled={!script}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-[#182032] px-4 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-40 whitespace-nowrap"
          >
            Direct 3D Visuals & Lip-Sync
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onSendToPackaging}
            disabled={!script}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-[#0B0F19] px-4 py-2 text-xs font-medium text-slate-300 hover:border-white/25 hover:text-slate-100 disabled:opacity-40 whitespace-nowrap"
          >
            Analyze Titles & Thumbnails
          </button>
        </div>
      </aside>

      {/* Fixed Main Script Workspace */}
      <section className="flex-1 overflow-y-auto p-6">
        {isGenerating && !script ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="h-28 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            <div className="h-44 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            <div className="h-44 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
          </div>
        ) : !script ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <FileText className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Write Your Faceless Story Script
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Enter a topic on the left or choose one from your 30-idea list to generate a
              structured {durationMinutes}-minute spoken narration with a 10-second hook and
              pattern interrupts.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Generate {durationMinutes}-Minute Script
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Script Header Metrics */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-100">
                  {script.topic}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {script.targetAudience} ·{' '}
                  <span className="font-mono-tabular text-slate-300">
                    {script.durationMinutes} min
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono-tabular text-slate-300">
                    ~{script.estimatedWordCount} words
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyScript}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#182032] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/40 whitespace-nowrap"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy Full Script'}
              </button>
            </div>

            {/* 10-Second Hook */}
            <div className="rounded-lg border border-amber-500/35 bg-[#121826] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                  0:00 – 0:10 · Opening Hook
                </span>
                <span className="font-mono-tabular text-xs text-slate-400">10s</span>
              </div>
              <p className="mt-2.5 text-[15px] leading-[1.65] text-slate-100">
                {script.hook10Seconds}
              </p>
            </div>

            {/* Narrative Sections */}
            <div className="space-y-4">
              {script.sections.map((section, idx) => (
                <article
                  key={idx}
                  className="rounded-lg border border-white/10 bg-[#121826] p-5 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <h4 className="font-display text-sm font-semibold text-slate-100">
                      {String(idx + 1).padStart(2, '0')}. {section.sectionTitle}
                    </h4>
                    <span className="font-mono-tabular text-xs text-slate-400">
                      {section.estimatedSeconds}s
                    </span>
                  </div>

                  <p className="text-[15px] leading-[1.65] text-slate-200 whitespace-pre-line">
                    {section.narration}
                  </p>

                  <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 text-xs">
                    <div className="rounded bg-[#0B0F19] p-3 border border-white/10">
                      <span className="flex items-center gap-1.5 font-semibold text-amber-400">
                        <Zap className="h-3 w-3" />
                        Pattern Interrupt
                      </span>
                      <p className="mt-1 text-slate-300">{section.patternInterrupt}</p>
                    </div>
                    <div className="rounded bg-[#0B0F19] p-3 border border-white/10">
                      <span className="font-semibold text-slate-300">Smooth Transition</span>
                      <p className="mt-1 text-slate-400">{section.transitionLine}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* Closing CTA */}
            <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Closing Reflection & CTA
              </span>
              <p className="mt-2 text-[15px] leading-[1.65] text-slate-200">
                {script.closingCallToAction}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
