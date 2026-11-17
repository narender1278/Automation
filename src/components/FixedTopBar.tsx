import React from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import type { StageId } from '../types/studio';

interface FixedTopBarProps {
  projectTitle: string;
  activeStage: StageId;
  stageCodeLabel?: string;
  stageTitle: string;
  primaryActionLabel: string;
  isGenerating: boolean;
  onPrimaryAction: () => void;
  onStopAction?: () => void;
  isStopPending?: boolean;
}

export function FixedTopBar({
  projectTitle,
  activeStage,
  stageCodeLabel,
  stageTitle,
  primaryActionLabel,
  isGenerating,
  onPrimaryAction,
  onStopAction,
  isStopPending,
}: FixedTopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-8 border-b border-white/10 bg-[#121826] px-6">
      {/* Zone 1: Contextual Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate font-medium text-slate-400">{projectTitle}</span>
        <span aria-hidden="true" className="text-slate-600">
          /
        </span>
        <span className="font-mono-tabular text-xs font-semibold text-amber-400">
          {stageCodeLabel || `0${activeStage}`}
        </span>
        <h1 className="truncate font-display text-sm font-semibold text-slate-100">
          {stageTitle}
        </h1>
      </div>

      {/* Zone 2: Single Primary Action + Stop Schedule override */}
      <div className="flex shrink-0 items-center gap-2">
        {isGenerating && onStopAction && (
          <button
            type="button"
            disabled={isStopPending}
            onClick={onStopAction}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Square className="h-3 w-3 fill-current" />
            {isStopPending ? 'Stopping...' : 'Stop Schedule'}
          </button>
        )}
        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" />
              {primaryActionLabel}
            </>
          )}
        </button>
      </div>
    </header>
  );
}
