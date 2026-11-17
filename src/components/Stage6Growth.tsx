import React from 'react';
import { CalendarDays, BarChart3, CheckSquare, ShieldCheck } from 'lucide-react';
import type { GrowthPlan } from '../types/studio';

interface Stage6GrowthProps {
  growthPlan: GrowthPlan | null;
  hoursPerDay: number;
  budget: string;
  onChangeHoursPerDay: (val: number) => void;
  onChangeBudget: (val: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}

export function Stage6Growth({
  growthPlan,
  hoursPerDay,
  budget,
  onChangeHoursPerDay,
  onChangeBudget,
  isGenerating,
  onGenerate,
}: Stage6GrowthProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Fixed Left Config Rail (320px) */}
      <aside className="flex w-[320px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-5">
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              60-Day Launch Constraints
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Tailors weekly research, scripting, 3D production, publishing, Shorts, and engagement
              milestones to your capacity.
            </p>
          </div>

          <div>
            <label
              htmlFor="hours-per-day"
              className="flex items-center justify-between text-xs font-medium text-slate-300"
            >
              <span>Hours Available Per Day</span>
              <span className="font-mono-tabular text-amber-400">{hoursPerDay} hrs/day</span>
            </label>
            <input
              id="hours-per-day"
              type="range"
              min={0.5}
              max={8}
              step={0.5}
              value={hoursPerDay}
              onChange={(e) => onChangeHoursPerDay(Number(e.target.value))}
              className="mt-2 w-full accent-amber-500"
            />
          </div>

          <div>
            <label htmlFor="launch-budget" className="block text-xs font-medium text-slate-300">
              Monthly Production Budget
            </label>
            <input
              id="launch-budget"
              type="text"
              value={budget}
              onChange={(e) => onChangeBudget(e.target.value)}
              placeholder="e.g., $0 (Free browser tools) or $25/mo"
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div className="rounded border border-white/10 bg-[#0B0F19] p-3.5 text-xs space-y-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
              Policy Guardrail
            </span>
            <p className="leading-relaxed text-slate-400">
              Includes official YouTube Partner Program thresholds without guaranteeing
              monetization or revenue.
            </p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 text-xs text-slate-400">
          Use Export Production Bible in the sidebar to save all 6 stages together.
        </div>
      </aside>

      {/* Fixed Main Roadmap Workspace */}
      <section className="flex-1 overflow-y-auto p-6">
        {isGenerating && !growthPlan ? (
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            <div className="h-64 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
          </div>
        ) : !growthPlan ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <CalendarDays className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Build Your 60-Day Launch Roadmap
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Generate an 8-week execution plan calibrated to {hoursPerDay} hrs/day and {budget}.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Build 60-Day Growth Plan
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            {/* Upload Schedule + Disclaimer */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-[#121826] p-4">
                <span className="text-xs font-semibold text-amber-400">Long-Form Cadence</span>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  {growthPlan.uploadSchedule.longFormCadence}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#121826] p-4">
                <span className="text-xs font-semibold text-amber-400">Shorts Cadence</span>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  {growthPlan.uploadSchedule.shortsCadence}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#121826] p-4">
                <span className="text-xs font-semibold text-slate-300">Routine Guidance</span>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {growthPlan.uploadSchedule.bestRoutineNote}
                </p>
              </div>
            </div>

            {/* 8-Week Milestones */}
            <div className="rounded-lg border border-white/10 bg-[#121826] overflow-hidden">
              <div className="border-b border-white/10 px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  8-Week Execution Milestones
                </h3>
              </div>
              <div className="divide-y divide-white/10">
                {growthPlan.weeklyMilestones.map((wk) => (
                  <div key={wk.weekNumber} className="p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono-tabular text-xs font-semibold text-amber-400">
                        WEEK {String(wk.weekNumber).padStart(2, '0')}
                      </span>
                      <h4 className="font-display text-sm font-semibold text-slate-100">
                        {wk.phaseTitle}
                      </h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Research</span>
                        <p className="mt-1 text-slate-400">{wk.research}</p>
                      </div>
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Scripting</span>
                        <p className="mt-1 text-slate-400">{wk.scripting}</p>
                      </div>
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Production</span>
                        <p className="mt-1 text-slate-400">{wk.production}</p>
                      </div>
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Publishing</span>
                        <p className="mt-1 text-slate-400">{wk.publishing}</p>
                      </div>
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Shorts</span>
                        <p className="mt-1 text-slate-400">{wk.shorts}</p>
                      </div>
                      <div className="rounded border border-white/10 bg-[#0B0F19] p-3">
                        <span className="font-semibold text-slate-200">Engagement</span>
                        <p className="mt-1 text-slate-400">{wk.engagement}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Workflow + Key Analytics */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <CheckSquare className="h-4 w-4 text-amber-400" />
                  Repeatable Production Workflow
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {growthPlan.productionWorkflow.map((step) => (
                    <div key={step.stepNumber} className="py-3 first:pt-0 last:pb-0 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-100">
                          {step.stepNumber}. {step.stepName}
                        </span>
                        <span className="font-mono-tabular text-amber-400">
                          {step.timeAllocation}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-400">{step.details}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#121826] p-5">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
                  <BarChart3 className="h-4 w-4 text-amber-400" />
                  Key Analytics & Weekly Reviews
                </h3>
                <div className="mt-3 divide-y divide-white/10">
                  {growthPlan.keyAnalytics.map((k, idx) => (
                    <div key={idx} className="py-3 first:pt-0 last:pb-0 text-xs">
                      <p className="font-semibold text-slate-100">{k.metric}</p>
                      <p className="mt-1 text-slate-300">{k.whatItShows}</p>
                      <p className="mt-1 text-slate-400">Action: {k.weeklyAction}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="text-xs font-semibold text-slate-200">Weekly Improvement Loop</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
                    {growthPlan.weeklyImprovements.map((imp, idx) => (
                      <li key={idx}>· {imp}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Monetization Eligibility */}
            <div className="rounded-lg border border-white/10 bg-[#121826] p-5 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                YouTube Partner Program (YPP) Eligibility Requirements
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {growthPlan.monetizationEligibility.map((tier, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-white/10 bg-[#0B0F19] p-4 text-xs space-y-1.5"
                  >
                    <p className="font-semibold text-amber-400">{tier.tierName}</p>
                    <p className="font-mono-tabular text-slate-100">
                      {tier.subscriberThreshold}
                    </p>
                    <p className="font-mono-tabular text-slate-300">
                      {tier.watchOrShortsThreshold}
                    </p>
                    <p className="text-slate-400">{tier.additionalNotes}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 border-t border-white/10 pt-3">
                {growthPlan.disclaimer}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
