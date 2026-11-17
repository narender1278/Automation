import React, { useState } from 'react';
import {
  Compass,
  Lightbulb,
  FileText,
  Box,
  Image as ImageIcon,
  CalendarDays,
  Plus,
  Trash2,
  Download,
  FolderKanban,
  Sunrise,
} from 'lucide-react';
import type { StageId, StudioProject } from '../types/studio';

interface FixedSidebarProps {
  projects: StudioProject[];
  activeProject: StudioProject;
  activeStage: StageId;
  isVaultActive: boolean;
  vaultEpisodeCount: number;
  isPipelineRunning: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (title: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectStage: (stage: StageId) => void;
  onOpenVault: () => void;
  onExportMarkdown: () => void;
}

const STAGE_ITEMS: {
  id: StageId;
  code: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 1, code: '01', label: 'Profitable Niche', icon: Compass },
  { id: 2, code: '02', label: 'Daily Idea Generator', icon: Lightbulb },
  { id: 3, code: '03', label: 'Script Generator', icon: FileText },
  { id: 4, code: '04', label: '3D Visuals & Lip-Sync', icon: Box },
  { id: 5, code: '05', label: 'Titles & Thumbnails', icon: ImageIcon },
  { id: 6, code: '06', label: '60-Day Growth Plan', icon: CalendarDays },
];

function getStageStatusText(project: StudioProject, stageId: StageId): string {
  switch (stageId) {
    case 1:
      return project.nicheStrategy ? 'Ready' : 'Pending';
    case 2:
      return project.contentIdeas.length > 0 ? `${project.contentIdeas.length} ideas` : 'Pending';
    case 3:
      return project.scriptStage ? `${project.scriptStage.durationMinutes} min` : 'Pending';
    case 4:
      return project.visualPlan ? `${project.visualPlan.scenes.length} scenes` : 'Pending';
    case 5:
      return project.packagingLab ? `${project.packagingLab.titles.length} titles` : 'Pending';
    case 6:
      return project.growthPlan ? '8 weeks' : 'Pending';
  }
}

export function FixedSidebar({
  projects,
  activeProject,
  activeStage,
  isVaultActive,
  vaultEpisodeCount,
  isPipelineRunning,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onSelectStage,
  onOpenVault,
  onExportMarkdown,
}: FixedSidebarProps) {
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateProject(newTitle.trim());
    setNewTitle('');
    setCreating(false);
  };

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#121826]">
      {/* Brand Wordmark */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="font-display text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap">
          Storyline Director
        </span>
      </div>

      {/* Fixed Project Selector */}
      <div className="shrink-0 border-b border-white/10 p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <FolderKanban className="h-3.5 w-3.5 text-amber-400" />
            Channel Project
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCreating((prev) => !prev)}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-amber-400"
              title="New Project"
              aria-label="New Project"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {projects.length > 1 && (
              <button
                type="button"
                onClick={() => onDeleteProject(activeProject.id)}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-red-400"
                title="Delete Current Project"
                aria-label="Delete Current Project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <select
          value={activeProject.id}
          onChange={(e) => onSelectProject(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs font-medium text-slate-200 focus:border-amber-500/60 focus:outline-none"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        {creating && (
          <form onSubmit={handleCreateSubmit} className="mt-2 flex gap-1.5">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Project title..."
              className="min-w-0 flex-1 rounded border border-white/10 bg-[#0B0F19] px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="shrink-0 rounded bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* Fixed 6-Stage Navigation Rail */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Production Stages">
        <p className="mb-2 px-2 text-xs font-medium text-slate-400">Production Pipeline</p>
        <div className="space-y-1">
          {STAGE_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = !isVaultActive && activeStage === item.id;
            const statusText = getStageStatusText(activeProject, item.id);
            const isComplete = statusText !== 'Pending';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectStage(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'bg-[#182032] text-slate-100 ring-1 ring-amber-500/50'
                    : 'text-slate-300 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`font-mono-tabular text-xs font-semibold ${
                      isActive ? 'text-amber-400' : 'text-slate-500'
                    }`}
                  >
                    {item.code}
                  </span>
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-amber-400' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate text-xs font-medium">{item.label}</span>
                </span>
                <span
                  className={`font-mono-tabular ml-2 shrink-0 text-[11px] ${
                    isComplete ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {statusText}
                </span>
              </button>
            );
          })}
        </div>

        {/* Daily Morning Auto-Vault Entry */}
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-1.5 px-2 text-xs font-medium text-slate-400">Daily Automation</p>
          <button
            type="button"
            onClick={onOpenVault}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2.5 text-left transition-colors ${
              isVaultActive
                ? 'bg-[#182032] text-slate-100 ring-1 ring-amber-500/50'
                : 'text-slate-300 hover:bg-white/[0.04] hover:text-slate-100'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  isVaultActive ? 'text-amber-400' : 'text-slate-500'
                }`}
              >
                AM
              </span>
              <Sunrise
                className={`h-4 w-4 shrink-0 ${
                  isVaultActive ? 'text-amber-400' : 'text-slate-400'
                }`}
              />
              <span className="truncate text-xs font-medium">Morning Auto-Vault</span>
            </span>
            <span
              className={`font-mono-tabular ml-2 shrink-0 text-[11px] ${
                isPipelineRunning
                  ? 'text-amber-400'
                  : vaultEpisodeCount > 0
                    ? 'text-emerald-400'
                    : 'text-slate-500'
              }`}
            >
              {isPipelineRunning
                ? 'Running'
                : vaultEpisodeCount > 0
                  ? `${vaultEpisodeCount} ready`
                  : 'Schedule'}
            </span>
          </button>
        </div>
      </nav>

      {/* Fixed Footer Actions */}
      <div className="shrink-0 border-t border-white/10 p-3.5 space-y-2.5">
        <div className="text-[11px] leading-relaxed text-slate-400">
          Locked Niche: <span className="text-slate-200">Motivational Short Stories</span>
        </div>
        <button
          type="button"
          onClick={onExportMarkdown}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-[#182032] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/40 hover:text-amber-300 whitespace-nowrap"
        >
          <Download className="h-3.5 w-3.5" />
          Export Production Bible
        </button>
      </div>
    </aside>
  );
}
