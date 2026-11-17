import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Trophy, Download, Copy, Check } from 'lucide-react';
import type { PackagingData, ThumbnailConcept } from '../types/studio';

interface Stage5PackagingProps {
  packaging: PackagingData | null;
  topicOrScriptInput: string;
  onChangeTopicOrScriptInput: (val: string) => void;
  captured3DFrame: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
}

function ThumbnailCanvasPreview({
  concept,
  backgroundSnapshot,
}: {
  concept: ThumbnailConcept;
  backgroundSnapshot: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 640;
    const h = 360;
    const primary = concept.colors[0] || '#0B0F19';
    const accent = concept.colors[1] || '#F59E0B';
    const secondary = concept.colors[2] || '#1E293B';

    const drawOverlay = () => {
      // Measured contrast scrim
      const scrim = ctx.createLinearGradient(0, 0, w, 0);
      scrim.addColorStop(0, 'rgba(9, 13, 22, 0.88)');
      scrim.addColorStop(0.55, 'rgba(9, 13, 22, 0.48)');
      scrim.addColorStop(1, 'rgba(9, 13, 22, 0.25)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);

      // Accent frame line
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      // Bold Thumbnail Short Text
      const words = (concept.shortText || 'THE SHIFT').toUpperCase().split(/\s+/);
      ctx.font = '800 44px "Plus Jakarta Sans", sans-serif';
      ctx.textBaseline = 'top';
      let y = 86;
      words.slice(0, 4).forEach((word, idx) => {
        const isHighlight = idx === words.length - 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillText(word, 38, y + 3);
        ctx.fillStyle = isHighlight ? accent : '#F8FAFC';
        ctx.fillText(word, 35, y);
        y += 50;
      });

      // Subtle bottom label
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
      ctx.fillText(concept.conceptName.toUpperCase().slice(0, 40), 35, h - 38);
    };

    // Base procedural backdrop
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, primary);
    grad.addColorStop(0.5, secondary);
    grad.addColorStop(1, '#080C14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (backgroundSnapshot) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h);
        drawOverlay();
      };
      img.src = backgroundSnapshot;
    } else {
      // Subtle atmospheric silhouette orb
      const orb = ctx.createRadialGradient(w * 0.74, h * 0.45, 18, w * 0.74, h * 0.45, 165);
      orb.addColorStop(0, accent);
      orb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = orb;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      drawOverlay();
    }
  }, [concept, backgroundSnapshot]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${concept.conceptName.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.click();
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="w-full rounded border border-white/10 bg-[#0B0F19]"
      />
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#0B0F19] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/50"
      >
        <Download className="h-3 w-3 text-amber-400" />
        Download Mockup PNG
      </button>
    </div>
  );
}

export function Stage5Packaging({
  packaging,
  topicOrScriptInput,
  onChangeTopicOrScriptInput,
  captured3DFrame,
  isGenerating,
  onGenerate,
}: Stage5PackagingProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [use3DFrameBg, setUse3DFrameBg] = useState(true);

  const handleCopyTitle = async (rank: number, title: string) => {
    await navigator.clipboard.writeText(title);
    setCopiedIdx(rank);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Fixed Left Config Rail (320px) */}
      <aside className="flex w-[320px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-5">
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Packaging Analysis Input
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Generates 10 anti-clickbait titles, 5 thumbnail blueprints, and ranks the Top 3 pairings.
            </p>
          </div>

          <div>
            <label
              htmlFor="packaging-input"
              className="block text-xs font-medium text-slate-300"
            >
              Topic or Script Summary
            </label>
            <textarea
              id="packaging-input"
              rows={6}
              value={topicOrScriptInput}
              onChange={(e) => onChangeTopicOrScriptInput(e.target.value)}
              placeholder="Automatically synced from Stage 3 script, or paste any story topic..."
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0B0F19] p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          {captured3DFrame && (
            <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200">3D Stage Snapshot Ready</span>
                <button
                  type="button"
                  onClick={() => setUse3DFrameBg((prev) => !prev)}
                  className="text-amber-400 hover:underline"
                >
                  {use3DFrameBg ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <img
                src={captured3DFrame}
                alt="Captured 3D frame"
                referrerPolicy="no-referrer"
                className="w-full rounded border border-white/10"
              />
            </div>
          )}
        </div>

        <div className="border-t border-white/10 pt-4 text-xs text-slate-400">
          Thumbnail mockups render locally on HTML5 Canvas at zero API cost.
        </div>
      </aside>

      {/* Fixed Main Packaging Workspace */}
      <section className="flex-1 overflow-y-auto p-6">
        {isGenerating && !packaging ? (
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
            <div className="h-64 animate-pulse rounded-lg border border-white/10 bg-[#121826]" />
          </div>
        ) : !packaging ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <ImageIcon className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Build Titles & Thumbnail Concepts
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Create 10 honest clickable titles, 5 visual thumbnail blueprints with live Canvas
              previews, and a Top 3 ranked shortlist.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Generate Packaging Suite
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            {/* Top 3 Ranked Pairings */}
            <div className="rounded-lg border border-amber-500/35 bg-[#121826] p-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-amber-400">
                <Trophy className="h-4 w-4" />
                Strongest Top 3 Title + Thumbnail Combinations
              </h3>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {packaging.topThree.map((pair) => (
                  <div
                    key={pair.rank}
                    className="rounded border border-white/10 bg-[#0B0F19] p-4 space-y-2"
                  >
                    <span className="font-mono-tabular text-xs font-semibold text-amber-400">
                      Rank #{pair.rank}
                    </span>
                    <p className="text-sm font-semibold text-slate-100 leading-snug">
                      {pair.title}
                    </p>
                    <p className="text-xs font-medium text-amber-300">
                      Concept: {pair.thumbnailConceptName}
                    </p>
                    <p className="text-xs leading-relaxed text-slate-400">
                      {pair.whyStrongest}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Ready-to-Paste YouTube Description & Tags */}
            {(packaging.youtubeDescription || (packaging.youtubeTags && packaging.youtubeTags.length > 0)) && (
              <div className="rounded-lg border border-white/10 bg-[#121826] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Upload-Ready YouTube Description & Tags
                  </h3>
                  <div className="flex items-center gap-3">
                    {packaging.youtubeDescription && (
                      <button
                        type="button"
                        onClick={() => handleCopyTitle(999, packaging.youtubeDescription || '')}
                        className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {copiedIdx === 999 ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedIdx === 999 ? 'Copied Description' : 'Copy Description'}
                      </button>
                    )}
                    {packaging.youtubeTags && packaging.youtubeTags.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyTitle(998, (packaging.youtubeTags || []).join(', '))
                        }
                        className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-amber-300"
                      >
                        {copiedIdx === 998 ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedIdx === 998 ? 'Copied Tags' : 'Copy Tags'}
                      </button>
                    )}
                  </div>
                </div>
                {packaging.youtubeDescription && (
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-white/10 bg-[#0B0F19] p-3.5 font-sans text-xs leading-relaxed text-slate-300">
                    {packaging.youtubeDescription}
                  </pre>
                )}
                {packaging.youtubeTags && packaging.youtubeTags.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Tags: {packaging.youtubeTags.join(' · ')}
                  </p>
                )}
              </div>
            )}

            {/* 10 Clickable Titles */}
            <div className="rounded-lg border border-white/10 bg-[#121826] overflow-hidden">
              <div className="border-b border-white/10 px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  10 Clickable Anti-Clickbait Titles
                </h3>
              </div>
              <div className="divide-y divide-white/10">
                {packaging.titles.map((t) => (
                  <div
                    key={t.rank}
                    className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-xs"
                  >
                    <div className="col-span-1 font-mono-tabular text-amber-400">
                      #{t.rank}
                    </div>
                    <div className="col-span-5 font-semibold text-slate-100">{t.title}</div>
                    <div className="col-span-5 text-slate-400">
                      <span className="text-slate-300">{t.angle}: </span>
                      {t.curiosityMechanism}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleCopyTitle(t.rank, t.title)}
                        className="text-slate-400 hover:text-amber-400"
                        aria-label={`Copy title ${t.rank}`}
                      >
                        {copiedIdx === t.rank ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 5 Thumbnail Blueprints with Live Canvas Mockup */}
            <div className="space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                5 Thumbnail Concepts & Live 16:9 Mockups
              </h3>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {packaging.thumbnails.map((thumb) => (
                  <div
                    key={thumb.id}
                    className="rounded-lg border border-white/10 bg-[#121826] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-sm font-semibold text-slate-100">
                        {thumb.conceptName}
                      </h4>
                      <div className="flex items-center gap-1.5">
                        {thumb.colors.map((hex, i) => (
                          <span
                            key={i}
                            className="h-3.5 w-3.5 rounded-sm border border-white/20"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          />
                        ))}
                      </div>
                    </div>

                    <ThumbnailCanvasPreview
                      concept={thumb}
                      backgroundSnapshot={use3DFrameBg ? captured3DFrame : null}
                    />

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                      <div>
                        <span className="font-semibold text-slate-200">Subject: </span>
                        {thumb.subject}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-200">Background: </span>
                        {thumb.background}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-200">Composition: </span>
                        {thumb.composition}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-200">Curiosity: </span>
                        {thumb.curiosityBehindPairing}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
