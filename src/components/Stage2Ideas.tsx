import React, { useMemo, useState } from 'react';
import { Lightbulb, Search, Star, FileText, RefreshCw, Trash2 } from 'lucide-react';
import type { ContentIdea, IdeaCategory } from '../types/studio';

interface Stage2IdeasProps {
  ideas: ContentIdea[];
  nicheFocus: string;
  onChangeNicheFocus: (val: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  onToggleShortlist: (ideaId: string) => void;
  onRemoveIdea: (ideaId: string) => void;
  onSendToScript: (idea: ContentIdea) => void;
}

const CATEGORIES: ('All' | IdeaCategory)[] = [
  'All',
  'Storytelling',
  'Evergreen',
  'Educational',
  'Trending',
];

export function Stage2Ideas({
  ideas,
  nicheFocus,
  onChangeNicheFocus,
  isGenerating,
  onGenerate,
  onToggleShortlist,
  onRemoveIdea,
  onSendToScript,
}: Stage2IdeasProps) {
  const [categoryFilter, setCategoryFilter] = useState<'All' | IdeaCategory>('All');
  const [viewMode, setViewMode] = useState<'all' | 'batch' | 'shortlisted'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const shortlistedCount = useMemo(() => ideas.filter((i) => i.shortlisted).length, [ideas]);
  const freshCount = useMemo(() => ideas.filter((i) => !i.shortlisted).length, [ideas]);

  const filteredIdeas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (categoryFilter !== 'All' && idea.category !== categoryFilter) return false;
      if (viewMode === 'shortlisted' && !idea.shortlisted) return false;
      if (viewMode === 'batch' && idea.shortlisted) return false;
      if (
        q &&
        !idea.title.toLowerCase().includes(q) &&
        !idea.centralTopic.toLowerCase().includes(q) &&
        !idea.targetViewer.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [ideas, categoryFilter, viewMode, searchQuery]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Fixed Left Config & Filter Rail (320px) */}
      <aside className="flex w-[320px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-5">
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Daily 3-Idea Batch
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Generates 3 focused video concepts per batch for a 1-video/day upload cadence.
              Shortlist keepers, then regenerate 3 fresh ideas anytime.
            </p>
          </div>

          <div>
            <label
              htmlFor="idea-focus-input"
              className="block text-xs font-medium text-slate-300"
            >
              Story Blend Focus
            </label>
            <textarea
              id="idea-focus-input"
              rows={3}
              value={nicheFocus}
              onChange={(e) => onChangeNicheFocus(e.target.value)}
              placeholder="e.g., Mythological turning points + modern aspirant struggles"
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {ideas.length > 0 ? 'Generate 3 New Ideas' : 'Generate 3 Ideas'}
          </button>

          <div className="border-t border-white/10 pt-4 space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Queue View ({filteredIdeas.length} / {ideas.length})
            </label>

            <div className="grid grid-cols-3 gap-1 rounded-md border border-white/10 bg-[#0B0F19] p-1">
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`rounded py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode === 'all' ? 'bg-[#182032] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({ideas.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('batch')}
                className={`rounded py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode === 'batch' ? 'bg-[#182032] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                New ({freshCount})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('shortlisted')}
                className={`rounded py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode === 'shortlisted' ? 'bg-[#182032] text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Saved ({shortlistedCount})
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title or viewer..."
                className="w-full rounded-md border border-white/10 bg-[#0B0F19] py-2 pr-2.5 pl-8 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-amber-500 text-slate-950'
                      : 'border border-white/10 bg-[#0B0F19] text-slate-300 hover:text-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 text-xs text-slate-400 leading-relaxed">
          Star your favorite idea to keep it in your shortlist when generating the next 3 ideas.
        </div>
      </aside>

      {/* Fixed Main Workspace */}
      <section className="flex-1 overflow-y-auto p-6">
        {isGenerating && ideas.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="h-24 animate-pulse rounded-lg border border-white/10 bg-[#121826]"
              />
            ))}
          </div>
        ) : ideas.length === 0 ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <Lightbulb className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Generate 3 Daily Story Ideas
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Start with 3 focused ideas tailored to one video per day. Shortlist the winner,
              write its script, or regenerate 3 fresh ideas anytime.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Generate 3 Ideas
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-[#121826] overflow-hidden">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 bg-[#182032] px-4 py-2.5 text-xs font-semibold text-slate-300">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Title & Central Topic</div>
              <div className="col-span-2">Category · Format</div>
              <div className="col-span-3">Target Viewer & Watch Reason</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-white/10">
              {filteredIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className="grid grid-cols-12 items-center gap-3 px-4 py-3.5 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="col-span-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleShortlist(idea.id)}
                      className={`${
                        idea.shortlisted ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
                      }`}
                      title={idea.shortlisted ? 'Remove from shortlist' : 'Shortlist idea'}
                      aria-label={`Shortlist ${idea.title}`}
                    >
                      <Star className={`h-4 w-4 ${idea.shortlisted ? 'fill-current' : ''}`} />
                    </button>
                    <span className="font-mono-tabular text-slate-400">{idea.rankIndex}</span>
                  </div>

                  <div className="col-span-4 min-w-0">
                    <p className="font-semibold text-slate-100 leading-snug">{idea.title}</p>
                    <p className="mt-1 text-slate-400">{idea.centralTopic}</p>
                  </div>

                  <div className="col-span-2 text-slate-300">
                    <p className="font-medium text-amber-400">
                      {idea.category}
                      {idea.shortlisted ? ' · Shortlisted' : ''}
                    </p>
                    <p className="mt-0.5 text-slate-400">{idea.recommendedFormat}</p>
                  </div>

                  <div className="col-span-3 min-w-0 text-slate-300">
                    <p className="font-medium">{idea.targetViewer}</p>
                    <p className="mt-1 text-slate-400">{idea.reasonPeopleWatch}</p>
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSendToScript(idea)}
                      className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#0B0F19] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 whitespace-nowrap"
                    >
                      <FileText className="h-3 w-3" />
                      Write Script
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveIdea(idea.id)}
                      className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-400"
                      title="Remove idea"
                      aria-label={`Remove ${idea.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {filteredIdeas.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-slate-400">
                  No ideas match the active filter. Switch queue tabs or generate 3 new ideas.
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
