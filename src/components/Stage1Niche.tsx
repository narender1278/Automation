import React from 'react';
import { Award, ArrowRight, ShieldAlert, Users, Layers, Banknote } from 'lucide-react';
import type { NicheStrategy } from '../types/studio';

interface Stage1NicheProps {
  strategy: NicheStrategy | null;
  focusNote: string;
  onChangeFocusNote: (val: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  onProceedToIdeas: () => void;
}

export function Stage1Niche({
  strategy,
  focusNote,
  onChangeFocusNote,
  isGenerating,
  onGenerate,
  onProceedToIdeas,
}: Stage1NicheProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Fixed Left Configuration Rail (320px) */}
      <aside className="flex w-[320px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-5">
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Locked Niche Brief
            </h2>
            <p className="mt-2 rounded-md border border-white/10 bg-[#0B0F19] p-3 text-xs leading-relaxed text-slate-300">
              Motivating people and aspirants by telling short stories—both imaginary,
              mythological, and historical.
            </p>
          </div>

          <div>
            <label
              htmlFor="niche-focus-note"
              className="block text-xs font-medium text-slate-300"
            >
              Optional Audience Emphasis
            </label>
            <textarea
              id="niche-focus-note"
              rows={4}
              value={focusNote}
              onChange={(e) => onChangeFocusNote(e.target.value)}
              placeholder="e.g., Focus on competitive exam aspirants, young builders, and overcoming setbacks..."
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div className="border-t border-white/10 pt-4 text-xs text-slate-400 space-y-1.5">
            <p className="font-medium text-slate-300">Guardrails Enforced</p>
            <p>· Zero invented statistics or fake RPM figures</p>
            <p>· Ranked strategy options with clearest winner</p>
            <p>· Feeds directly into Stage 2 & Stage 6</p>
          </div>
        </div>

        <div className="pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onProceedToIdeas}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-[#182032] px-4 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 hover:text-amber-300 whitespace-nowrap"
          >
            Continue to Daily Ideas
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </aside>

      {/* Fixed Main Workspace */}
      <section className="flex-1 overflow-y-auto p-6">
        {isGenerating && !strategy ? (
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-52 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
              <div className="h-52 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            </div>
          </div>
        ) : !strategy ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <Award className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Analyze Your Profitable Niche
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Generate a full YouTube strategist breakdown for your motivational short-story
              channel, including ranked sub-niches, audience psychology, challenges, and
              monetization paths.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Analyze Niche Strategy
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            {/* Strongest Recommendation Banner */}
            <div className="rounded-lg border border-amber-500/30 bg-[#121826] p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                  Strongest Recommended Path
                </span>
                <span className="text-xs text-slate-400">Qualitative Strategy · Zero Invented Stats</span>
              </div>
              <h3 className="mt-1.5 font-display text-xl font-bold text-slate-100">
                {strategy.strongestRecommendation.optionTitle}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {strategy.strongestRecommendation.rationale}
              </p>
              <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">
                <span className="font-semibold text-amber-400">Immediate Focus: </span>
                {strategy.strongestRecommendation.firstStepFocus}
              </p>
            </div>

            {/* Niche Overview */}
            <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Strategic Positioning
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {strategy.nicheSummary}
              </p>
            </div>

            {/* Ranked Options Table */}
            <div className="rounded-lg border border-white/10 bg-[#121826] overflow-hidden">
              <div className="border-b border-white/10 px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Ranked Sub-Niche & Format Options
                </h3>
              </div>
              <div className="divide-y divide-white/10">
                {strategy.rankedOptions.map((opt) => (
                  <div key={opt.rank} className="grid grid-cols-12 gap-4 px-5 py-3.5 text-xs">
                    <div className="col-span-1 font-mono-tabular font-semibold text-amber-400">
                      #{opt.rank}
                    </div>
                    <div className="col-span-4">
                      <p className="font-semibold text-slate-100">{opt.title}</p>
                      <p className="mt-0.5 text-slate-400">
                        {opt.effortLevel} · {opt.monetizationFit}
                      </p>
                    </div>
                    <div className="col-span-7 space-y-1 text-slate-300">
                      <p>{opt.summary}</p>
                      <p className="text-slate-400">{opt.whyRanked}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Audience + Content Opportunities */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <Users className="h-4 w-4 text-amber-400" />
                  Target Audience Segments
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {strategy.audienceBreakdown.map((seg, i) => (
                    <div key={i} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-xs font-semibold text-slate-100">{seg.segment}</p>
                      <p className="mt-1 text-xs text-slate-300">{seg.mindset}</p>
                      <p className="mt-1 text-xs text-slate-400">Desire: {seg.coreDesire}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <Layers className="h-4 w-4 text-amber-400" />
                  Content Opportunities
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {strategy.contentOpportunities.map((opp, i) => (
                    <div key={i} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-xs font-semibold text-slate-100">
                        {opp.pillar} <span className="text-slate-400">· {opp.storySource}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-300">{opp.angle}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Challenges + Monetization */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  Operational Challenges & Mitigations
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {strategy.challenges.map((c, i) => (
                    <div key={i} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-xs font-semibold text-slate-100">{c.challenge}</p>
                      <p className="mt-1 text-xs text-slate-300">{c.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <Banknote className="h-4 w-4 text-amber-400" />
                  Monetization Methods
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {strategy.monetizationMethods.map((m, i) => (
                    <div key={i} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-xs font-semibold text-slate-100">
                        {m.method} <span className="text-slate-400">· {m.readinessStage}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-300">{m.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
