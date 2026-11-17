import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Play,
  RefreshCw,
  Scissors,
  Square,
  Trash2,
  Video,
  Volume2,
} from 'lucide-react';
import { Stage3DViewport, type Stage3DViewportHandle } from './Stage3DViewport';
import {
  deleteEpisodeVideoBlobs,
  getRenderedVideoBlob,
  listRenderedVideoMeta,
  saveRenderedVideoBlob,
} from '../utils/videoVaultDb';
import {
  convertVideoFormat,
  startWorkerInterval,
  triggerBlobDownload,
  workerDelay,
  type VideoExportFormat,
} from '../utils/videoExport';
import type {
  AutomationSettings,
  CameraPreset,
  CharacterAction,
  DailyEpisode,
  LightingMood,
  SceneItem,
  StageSet,
  StoryActivity,
  ThumbnailConcept,
  VaultStateResponse,
} from '../types/studio';

interface DailyVaultViewProps {
  vault: VaultStateResponse | null;
  activeProjectId: string;
  hasStudioEpisode: boolean;
  onRefreshVault: () => Promise<void>;
  onUpdateSettings: (patch: Partial<AutomationSettings>) => Promise<void>;
  onRunPipeline: (forceFresh: boolean) => Promise<void>;
  onStopPipeline: () => Promise<void>;
  onSaveStudioToVault: () => Promise<void>;
  onToggleEpisodeStatus: (episodeId: string, nextStatus: 'ready' | 'exported') => Promise<void>;
  onLoadEpisodeIntoStudio: (episode: DailyEpisode) => void;
  onDeleteEpisode: (episodeId: string) => Promise<void>;
  onRenderStateChange?: (active: boolean) => void;
}

interface ActiveRenderJob {
  mode: 'full' | 'clip' | 'batch';
  episodeId: string;
  episodeTitle: string;
  sceneNumber?: number;
  progressLabel: string;
}

function VaultThumbnailCanvas({
  concept,
  backdropSnapshot,
}: {
  concept: ThumbnailConcept;
  backdropSnapshot: string | null;
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
      const scrim = ctx.createLinearGradient(0, 0, w, 0);
      scrim.addColorStop(0, 'rgba(9, 13, 22, 0.9)');
      scrim.addColorStop(0.55, 'rgba(9, 13, 22, 0.48)');
      scrim.addColorStop(1, 'rgba(9, 13, 22, 0.22)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      const words = (concept.shortText || 'THE SHIFT').toUpperCase().split(/\s+/);
      ctx.font = '800 42px "Plus Jakarta Sans", sans-serif';
      ctx.textBaseline = 'top';
      let y = 84;
      words.slice(0, 4).forEach((word, idx) => {
        const isHighlight = idx === words.length - 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillText(word, 38, y + 3);
        ctx.fillStyle = isHighlight ? accent : '#F8FAFC';
        ctx.fillText(word, 35, y);
        y += 48;
      });

      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.fillText(concept.conceptName.toUpperCase().slice(0, 40), 35, h - 36);
    };

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, primary);
    grad.addColorStop(0.5, secondary);
    grad.addColorStop(1, '#080C14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (backdropSnapshot) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h);
        drawOverlay();
      };
      img.src = backdropSnapshot;
    } else {
      const orb = ctx.createRadialGradient(w * 0.74, h * 0.45, 18, w * 0.74, h * 0.45, 165);
      orb.addColorStop(0, accent);
      orb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = orb;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      drawOverlay();
    }
  }, [concept, backdropSnapshot]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `thumb-${concept.conceptName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    link.click();
  };

  return (
    <div className="space-y-2 rounded border border-white/10 bg-[#0B0F19] p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-200 truncate">{concept.conceptName}</span>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 whitespace-nowrap"
        >
          <Download className="h-3 w-3" />
          PNG
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="w-full rounded border border-white/10 bg-[#080C14]"
      />
      <p className="text-[11px] leading-snug text-slate-400">{concept.curiosityBehindPairing}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DailyVaultView({
  vault,
  hasStudioEpisode,
  onUpdateSettings,
  onRunPipeline,
  onStopPipeline,
  onSaveStudioToVault,
  onToggleEpisodeStatus,
  onLoadEpisodeIntoStudio,
  onDeleteEpisode,
  onRenderStateChange,
}: DailyVaultViewProps) {
  const viewportRef = useRef<Stage3DViewportHandle | null>(null);
  const lipSyncRef = useRef({ jawOpen: 0, lipSpread: 0, isPlaying: false });

  // Active 3D stage display state (for live extraction monitor)
  const [monitorScene, setMonitorScene] = useState<{
    action: CharacterAction;
    storyActivity?: StoryActivity;
    scriptCue?: string;
    cameraPreset: CameraPreset;
    lightingMood: LightingMood;
    stageSet: StageSet;
    intensity: number;
    onScreenText: string;
  }>({
    action: 'storyteller_gesture',
    storyActivity: 'orator_walk',
    cameraPreset: 'medium_shot',
    lightingMood: 'warm_dawn',
    stageSet: 'philosopher_pillar',
    intensity: 1.05,
    onScreenText: 'STORYLINE VAULT STAGE',
  });

  // Per-episode UI state
  const [expandedTabById, setExpandedTabById] = useState<
    Record<string, 'video' | 'thumbnails' | 'script'>
  >({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'exported'>('all');
  const [savingStudio, setSavingStudio] = useState(false);
  const [exportFormat, setExportFormat] = useState<VideoExportFormat>('mp4');
  const [convertingKey, setConvertingKey] = useState<string | null>(null);
  const [cachedVideoMeta, setCachedVideoMeta] = useState<
    Record<string, { sizeBytes: number; updatedAt: string }>
  >({});
  const [previewVideoUrls, setPreviewVideoUrls] = useState<Record<string, string>>({});
  const [episodeSnapshots, setEpisodeSnapshots] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Rendering / extraction runtime refs
  const [renderJob, setRenderJob] = useState<ActiveRenderJob | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const cancelRenderRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const keepaliveOscRef = useRef<OscillatorNode | null>(null);
  const activeRecorderRef = useRef<MediaRecorder | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);
  const activeWorkerStopRef = useRef<(() => void) | null>(null);

  const settings = vault?.settings;
  const episodes = vault?.episodes ?? [];

  const refreshCachedMeta = useCallback(async () => {
    try {
      const meta = await listRenderedVideoMeta();
      setCachedVideoMeta(meta);
    } catch {
      // ignore IndexedDB unavailable
    }
  }, []);

  useEffect(() => {
    void refreshCachedMeta();
  }, [refreshCachedMeta, episodes.length]);

  useEffect(() => {
    onRenderStateChange?.(Boolean(renderJob || convertingKey));
  }, [renderJob, convertingKey, onRenderStateChange]);

  useEffect(() => {
    return () => {
      cancelRenderRef.current = true;
      activeWorkerStopRef.current?.();
      activeWorkerStopRef.current = null;
      if (activeAudioElRef.current) {
        activeAudioElRef.current.pause();
      }
      if (activeRecorderRef.current?.state === 'recording') {
        try {
          activeRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      viewportRef.current?.stopVideoCaptureStream();
      try {
        keepaliveOscRef.current?.stop();
      } catch {
        // ignore
      }
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const ensureAudioDestination = async () => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (!destNodeRef.current) {
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      keepaliveOscRef.current = osc;
      destNodeRef.current = dest;
    }
    return { ctx, dest: destNodeRef.current };
  };

  const playEpisodeSceneThroughAnalyser = async (
    episodeId: string,
    scene: SceneItem,
  ): Promise<void> => {
    const { ctx, dest } = await ensureAudioDestination();
    setMonitorScene({
      action: scene.action,
      storyActivity: scene.storyActivity,
      scriptCue: `${scene.title} ${scene.visualDescription} ${scene.narrationCue}`,
      cameraPreset: scene.cameraPreset,
      lightingMood: scene.lightingMood,
      stageSet: scene.stageSet,
      intensity: scene.lipSyncIntensity || 1.05,
      onScreenText: scene.onScreenText || '',
    });

    const audioUrl = `/api/vault/episodes/${episodeId}/audio/${scene.sceneNumber}`;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        activeWorkerStopRef.current?.();
        activeWorkerStopRef.current = null;
        lipSyncRef.current.isPlaying = false;
        lipSyncRef.current.jawOpen = 0;
        lipSyncRef.current.lipSpread = 0;
        resolve();
      };

      const runSilentFallback = () => {
        const durMs = Math.min(Math.max(scene.durationSeconds * 1000, 3000), 6500);
        const start = performance.now();
        lipSyncRef.current.isPlaying = true;
        activeWorkerStopRef.current?.();
        activeWorkerStopRef.current = startWorkerInterval(() => {
          if (cancelRenderRef.current) {
            finish();
            return;
          }
          const elapsed = performance.now() - start;
          if (elapsed >= durMs) {
            finish();
            return;
          }
          const s = elapsed / 1000;
          const syl = Math.max(0, Math.sin(s * 14) * 0.6 + Math.sin(s * 7.5) * 0.4);
          lipSyncRef.current.jawOpen = Math.min(1, syl * (scene.lipSyncIntensity || 1));
          lipSyncRef.current.lipSpread = Math.abs(Math.cos(s * 9)) * lipSyncRef.current.jawOpen;
        }, 33);
      };

      try {
        const audio = new Audio(audioUrl);
        audio.crossOrigin = 'anonymous';
        activeAudioElRef.current = audio;

        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.65;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyser.connect(dest);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        lipSyncRef.current.isPlaying = true;

        const pumpLips = () => {
          if (cancelRenderRef.current) {
            audio.pause();
            try {
              source.disconnect();
              analyser.disconnect();
            } catch {
              // ignore
            }
            finish();
            return;
          }
          if (audio.paused || audio.ended) return;
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 1; i < 14; i++) sum += freqData[i] || 0;
          const avg = sum / (13 * 255);
          lipSyncRef.current.jawOpen = Math.min(1, avg * 2.4 * (scene.lipSyncIntensity || 1));
          lipSyncRef.current.lipSpread = Math.min(1, ((freqData[6] || 0) / 255) * 1.6);
        };

        audio.onended = () => {
          try {
            source.disconnect();
            analyser.disconnect();
          } catch {
            // ignore
          }
          finish();
        };
        audio.onerror = () => {
          try {
            source.disconnect();
            analyser.disconnect();
          } catch {
            // ignore
          }
          runSilentFallback();
        };

        audio
          .play()
          .then(() => {
            activeWorkerStopRef.current?.();
            activeWorkerStopRef.current = startWorkerInterval(pumpLips, 33);
          })
          .catch(() => {
            runSilentFallback();
          });
      } catch {
        runSilentFallback();
      }
    });
  };

  const downloadBlobInSelectedFormat = async (
    webmBlob: Blob,
    baseFilename: string,
    targetFormat: VideoExportFormat,
    busyKey?: string,
  ) => {
    if (targetFormat === 'webm') {
      triggerBlobDownload(webmBlob, `${baseFilename}.webm`);
      return;
    }
    if (busyKey) setConvertingKey(busyKey);
    setRenderError(null);
    try {
      const converted = await convertVideoFormat(webmBlob, targetFormat);
      triggerBlobDownload(converted.blob, `${baseFilename}.${converted.format}`);
    } catch (err) {
      setRenderError(
        err instanceof Error
          ? `${err.message} — downloaded .webm fallback.`
          : 'Conversion failed — downloaded .webm fallback.',
      );
      triggerBlobDownload(webmBlob, `${baseFilename}.webm`);
    } finally {
      if (busyKey) setConvertingKey(null);
    }
  };

  const renderAndStoreScenes = async (
    episode: DailyEpisode,
    scenesToRender: SceneItem[],
    storageKey: string,
    mode: 'full' | 'clip' | 'batch',
    autoDownloadBase?: string,
    downloadFormat?: VideoExportFormat,
  ): Promise<boolean> => {
    if (typeof MediaRecorder === 'undefined') {
      setRenderError('Browser does not support MediaRecorder WebM export.');
      return false;
    }

    setRenderError(null);
    cancelRenderRef.current = false;

    const episodeTitle =
      episode.packagingLab?.topThree?.[0]?.title || episode.idea.title;

    setRenderJob({
      mode,
      episodeId: episode.id,
      episodeTitle,
      sceneNumber: scenesToRender.length === 1 ? scenesToRender[0].sceneNumber : undefined,
      progressLabel: `Initializing 3D camera & audio...`,
    });

    try {
      const { dest } = await ensureAudioDestination();

      // Move viewport to first scene and let camera settle briefly before recording
      const first = scenesToRender[0];
      if (first) {
        setMonitorScene({
          action: first.action,
          storyActivity: first.storyActivity,
          scriptCue: `${first.title} ${first.visualDescription} ${first.narrationCue}`,
          cameraPreset: first.cameraPreset,
          lightingMood: first.lightingMood,
          stageSet: first.stageSet,
          intensity: first.lipSyncIntensity || 1.05,
          onScreenText: first.onScreenText || '',
        });
      }
      await workerDelay(350);

      // Capture clean PNG snapshot of first scene for thumbnails automatically
      const snap = viewportRef.current?.captureFramePng();
      if (snap) {
        setEpisodeSnapshots((prev) => ({ ...prev, [episode.id]: snap }));
      }

      const videoStream = viewportRef.current?.startVideoCaptureStream();
      if (!videoStream) {
        throw new Error('Could not open 3D compositor stream.');
      }

      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(
        combinedStream,
        mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : { videoBitsPerSecond: 5_000_000 },
      );
      activeRecorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const stoppedPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          viewportRef.current?.stopVideoCaptureStream();
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          resolve(blob);
        };
      });

      recorder.start(250);

      for (let i = 0; i < scenesToRender.length; i++) {
        if (cancelRenderRef.current) break;
        const sc = scenesToRender[i];
        setRenderJob((prev) =>
          prev
            ? {
                ...prev,
                sceneNumber: sc.sceneNumber,
                progressLabel:
                  scenesToRender.length === 1
                    ? `Recording Scene ${sc.sceneNumber}...`
                    : `Recording S${String(sc.sceneNumber).padStart(2, '0')} (${i + 1}/${scenesToRender.length})`,
              }
            : null,
        );
        await playEpisodeSceneThroughAnalyser(episode.id, sc);
        if (!cancelRenderRef.current && i < scenesToRender.length - 1) {
          await workerDelay(160);
        }
      }

      await workerDelay(220);
      if (recorder.state === 'recording') {
        recorder.stop();
      }
      activeRecorderRef.current = null;

      const blob = await stoppedPromise;
      if (blob.size > 0 && !cancelRenderRef.current) {
        await saveRenderedVideoBlob(storageKey, blob);
        await refreshCachedMeta();
        if (mode !== 'clip') {
          const objUrl = URL.createObjectURL(blob);
          setPreviewVideoUrls((prev) => ({ ...prev, [episode.id]: objUrl }));
        }
        if (autoDownloadBase) {
          const fmt = downloadFormat || exportFormat;
          if (fmt !== 'webm') {
            setRenderJob((prev) =>
              prev ? { ...prev, progressLabel: `Converting ${fmt.toUpperCase()}...` } : prev,
            );
          }
          await downloadBlobInSelectedFormat(blob, autoDownloadBase, fmt);
        }
      }

      return !cancelRenderRef.current;
    } catch (err) {
      viewportRef.current?.stopVideoCaptureStream();
      setRenderError(err instanceof Error ? err.message : 'Failed to extract 3D video.');
      return false;
    } finally {
      setRenderJob(null);
    }
  };

  const handleStopRender = () => {
    cancelRenderRef.current = true;
    activeAudioElRef.current?.pause();
    if (activeRecorderRef.current?.state === 'recording') {
      activeRecorderRef.current.stop();
    }
  };

  const handleRenderAllMissing = async () => {
    if (renderJob) return;
    const missing = episodes.filter((ep) => !cachedVideoMeta[`ep:${ep.id}:full`]);
    for (const ep of missing) {
      if (cancelRenderRef.current) break;
      const ok = await renderAndStoreScenes(
        ep,
        ep.visualPlan.scenes,
        `ep:${ep.id}:full`,
        'batch',
      );
      if (!ok) break;
    }
  };

  const handleDownloadCachedOrRenderFull = async (ep: DailyEpisode) => {
    const key = `ep:${ep.id}:full`;
    const slug = (ep.packagingLab?.topThree?.[0]?.title || ep.idea.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 48);

    const existing = await getRenderedVideoBlob(key);
    if (existing) {
      const url = URL.createObjectURL(existing.blob);
      setPreviewVideoUrls((prev) => ({ ...prev, [ep.id]: url }));
      await downloadBlobInSelectedFormat(existing.blob, slug, exportFormat, key);
      return;
    }

    await renderAndStoreScenes(ep, ep.visualPlan.scenes, key, 'full', slug, exportFormat);
  };

  const handleExtractOrDownloadSceneClip = async (ep: DailyEpisode, sc: SceneItem) => {
    const key = `ep:${ep.id}:scene:${sc.sceneNumber}`;
    const baseName = `ep-scene-${sc.sceneNumber}-${sc.cameraPreset}`;
    const existing = await getRenderedVideoBlob(key);
    if (existing) {
      await downloadBlobInSelectedFormat(existing.blob, baseName, exportFormat, key);
      return;
    }
    await renderAndStoreScenes(ep, [sc], key, 'clip', baseName, exportFormat);
  };

  const handleLoadPreviewPlayer = async (epId: string) => {
    const existing = await getRenderedVideoBlob(`ep:${epId}:full`);
    if (existing) {
      const url = URL.createObjectURL(existing.blob);
      setPreviewVideoUrls((prev) => ({ ...prev, [epId]: url }));
    }
  };

  const handleCaptureEpisodeSnapshot = (ep: DailyEpisode) => {
    const first = ep.visualPlan.scenes[0];
    if (first) {
      setMonitorScene({
        action: first.action,
        storyActivity: first.storyActivity,
        scriptCue: `${first.title} ${first.visualDescription} ${first.narrationCue}`,
        cameraPreset: first.cameraPreset,
        lightingMood: first.lightingMood,
        stageSet: first.stageSet,
        intensity: first.lipSyncIntensity || 1.05,
        onScreenText: first.onScreenText || '',
      });
    }
    setTimeout(() => {
      const snap = viewportRef.current?.captureFramePng();
      if (snap) {
        setEpisodeSnapshots((prev) => ({ ...prev, [ep.id]: snap }));
      }
    }, 320);
  };

  const handleDelete = async (epId: string) => {
    await deleteEpisodeVideoBlobs(epId).catch(() => {});
    await onDeleteEpisode(epId);
    await refreshCachedMeta();
  };

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const missingVideoCount = episodes.filter((ep) => !cachedVideoMeta[`ep:${ep.id}:full`]).length;

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* FIXED LEFT SCHEDULE + 3D RENDER MONITOR RAIL (340px) */}
      <aside className="flex w-[340px] shrink-0 flex-col justify-between overflow-y-auto border-r border-white/10 bg-[#121826]/70 p-4 space-y-4">
        <div className="space-y-4">
          {/* Morning Automation Schedule Controls */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-slate-100">
                <CalendarClock className="h-4 w-4 text-amber-400" />
                Morning Auto-Schedule
              </h2>
              <button
                type="button"
                onClick={() =>
                  settings && void onUpdateSettings({ enabled: !settings.enabled })
                }
                className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  settings?.enabled
                    ? 'bg-emerald-500 text-slate-950'
                    : 'border border-white/15 bg-[#0B0F19] text-slate-400'
                }`}
              >
                {settings?.enabled ? 'Enabled' : 'Paused'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400">
                  Morning Time
                </label>
                <input
                  type="time"
                  value={settings?.morningTime || '07:00'}
                  onChange={(e) =>
                    void onUpdateSettings({ morningTime: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-white/10 bg-[#0B0F19] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400">
                  Videos / Morning
                </label>
                <select
                  value={settings?.dailyCount || 1}
                  onChange={(e) =>
                    void onUpdateSettings({ dailyCount: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-white/10 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                >
                  <option value={1}>1 video / day (Recommended)</option>
                  <option value={2}>2 videos / day</option>
                  <option value={3}>3 videos / day</option>
                </select>
              </div>
            </div>

            <label className="flex items-start gap-2 rounded border border-white/10 bg-[#0B0F19] p-2.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.onlyIfIdeasEmpty ?? true}
                onChange={(e) =>
                  void onUpdateSettings({ onlyIfIdeasEmpty: e.target.checked })
                }
                className="mt-0.5 accent-amber-500"
              />
              <span>
                Generate {settings?.dailyCount || 1} only if Stage 2 has no unproduced ideas, and shortlist automatically
              </span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={vault?.isRunning}
                onClick={() => void onRunPipeline(false)}
                className="flex items-center justify-center gap-1.5 rounded bg-amber-500 px-2.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${vault?.isRunning ? 'animate-spin' : ''}`} />
                Run Queue Check
              </button>
              <button
                type="button"
                disabled={vault?.isRunning}
                onClick={() => void onRunPipeline(true)}
                className="flex items-center justify-center gap-1.5 rounded border border-white/15 bg-[#182032] px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5 text-amber-400" />
                +{settings?.dailyCount || 1} Fresh Now
              </button>
            </div>

            {vault?.isRunning && (
              <div className="flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                <span className="min-w-0 leading-snug">
                  {vault.cancelRequested
                    ? 'Stopping after current step...'
                    : vault.activeStep || 'Running morning production pipeline...'}
                </span>
                <button
                  type="button"
                  disabled={vault.cancelRequested}
                  onClick={() => void onStopPipeline()}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-400 disabled:opacity-60 whitespace-nowrap"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  {vault.cancelRequested ? 'Stopping...' : 'Stop'}
                </button>
              </div>
            )}

            {vault?.lastError && (
              <div className="rounded border border-red-500/40 bg-red-950/50 p-2.5 text-xs text-red-200">
                {vault.lastError}
              </div>
            )}

            {settings?.lastRunSummary && !vault?.isRunning && (
              <p className="text-[11px] text-slate-400">{settings.lastRunSummary}</p>
            )}
          </div>

          {/* Live 3D Extraction Monitor (16:9 WebGL Stage) */}
          <div className="border-t border-white/10 pt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200">
                3D Video Render Monitor
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Download Video Format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as VideoExportFormat)}
                  disabled={Boolean(renderJob || convertingKey)}
                  className="rounded border border-white/15 bg-[#0B0F19] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
                >
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WebM</option>
                </select>
                {renderJob ? (
                  <button
                    type="button"
                    onClick={handleStopRender}
                    className="inline-flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-400"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                    Stop
                  </button>
                ) : (
                  missingVideoCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleRenderAllMissing()}
                      className="inline-flex items-center gap-1 rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                    >
                      <Video className="h-3 w-3" />
                      Extract ({missingVideoCount})
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="aspect-video w-full overflow-hidden rounded border border-white/10 bg-[#080C14]">
              <Stage3DViewport
                ref={viewportRef}
                action={monitorScene.action}
                storyActivity={monitorScene.storyActivity}
                scriptCue={monitorScene.scriptCue}
                cameraPreset={monitorScene.cameraPreset}
                lightingMood={monitorScene.lightingMood}
                stageSet={monitorScene.stageSet}
                actionIntensity={monitorScene.intensity}
                onScreenText={monitorScene.onScreenText}
                showOnScreenText={true}
                lipSyncRef={lipSyncRef}
                orbitUnlocked={false}
              />
            </div>

            {renderJob ? (
              <p className="text-[11px] font-medium text-amber-300">
                {renderJob.progressLabel}
              </p>
            ) : convertingKey ? (
              <p className="text-[11px] font-medium text-emerald-300">
                Converting to {exportFormat.toUpperCase()}...
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">
                Renders 1280×720 3D videos in the background (safe to switch tabs) and downloads in {exportFormat.toUpperCase()}.
              </p>
            )}

            {renderError && <p className="text-[11px] text-red-300">{renderError}</p>}
          </div>
        </div>

        <div className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-400">
          Scripts, 3D scenes, voiceovers, titles, thumbnails & descriptions prepare automatically on schedule; downloads convert cleanly to MP4, MKV, or WebM.
        </div>
      </aside>

      {/* MAIN READY-TO-UPLOAD EPISODES VAULT */}
      <section className="flex-1 overflow-y-auto p-6">
        {episodes.length === 0 ? (
          <div className="flex h-full min-h-[380px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#121826]/60 p-8 text-center">
            <Layers className="h-8 w-8 text-amber-400" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
              Episode Tracker & Morning Vault
            </h3>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">
              Every morning at {settings?.morningTime || '07:00'}, the pipeline generates{' '}
              {settings?.dailyCount || 1} motivational story{' '}
              {(settings?.dailyCount || 1) === 1 ? 'idea' : 'ideas'} (if Stage 2 is clear), shortlists{' '}
              {(settings?.dailyCount || 1) === 1 ? 'it' : 'them'}, writes full scripts, directs 3D scenes,
              synthesizes voiceovers, and prepares titles, thumbnails, and descriptions.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                disabled={vault?.isRunning}
                onClick={() => void onRunPipeline(false)}
                className="rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {vault?.isRunning
                  ? 'Preparing Daily Episode...'
                  : `Create ${settings?.dailyCount || 1} ${(settings?.dailyCount || 1) === 1 ? 'Video Set' : 'Video Sets'} Now`}
              </button>
              {hasStudioEpisode && (
                <button
                  type="button"
                  disabled={savingStudio}
                  onClick={async () => {
                    setSavingStudio(true);
                    await onSaveStudioToVault();
                    setSavingStudio(false);
                  }}
                  className="rounded-md border border-white/15 bg-[#182032] px-4 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50"
                >
                  {savingStudio ? 'Saving...' : 'Save Current Studio Set'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-100">
                  Generated Episode Tracker ({episodes.length})
                </h2>
                <p className="text-xs text-slate-400">
                  All saved video sets (Idea · Script · 3D Scenes · Voiceovers · Thumbnails · Description).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-[#0B0F19] p-1">
                  {(['all', 'ready', 'exported'] as const).map((tab) => {
                    const cnt =
                      tab === 'all'
                        ? episodes.length
                        : episodes.filter((e) => e.status === tab).length;
                    const label =
                      tab === 'all' ? 'All' : tab === 'ready' ? 'Ready' : 'Uploaded';
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setStatusFilter(tab)}
                        className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          statusFilter === tab
                            ? 'bg-[#182032] text-amber-400'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {label} ({cnt})
                      </button>
                    );
                  })}
                </div>

                {hasStudioEpisode && (
                  <button
                    type="button"
                    disabled={savingStudio}
                    onClick={async () => {
                      setSavingStudio(true);
                      await onSaveStudioToVault();
                      setSavingStudio(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#182032] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Layers className="h-3.5 w-3.5 text-amber-400" />
                    {savingStudio ? 'Saving...' : 'Save Current Studio Set'}
                  </button>
                )}

                {missingVideoCount > 0 && !renderJob && (
                  <button
                    type="button"
                    onClick={() => void handleRenderAllMissing()}
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                  >
                    <Video className="h-3.5 w-3.5" />
                    Extract All Missing Videos ({missingVideoCount})
                  </button>
                )}
              </div>
            </div>

            {episodes
              .filter((ep) => statusFilter === 'all' || ep.status === statusFilter)
              .map((ep) => {
              const activeTab = expandedTabById[ep.id] || 'video';
              const fullCacheKey = `ep:${ep.id}:full`;
              const cachedFull = cachedVideoMeta[fullCacheKey];
              const topTitle =
                ep.packagingLab?.topThree?.[0]?.title ||
                ep.packagingLab?.titles?.[0]?.title ||
                ep.idea.title;
              const isRenderingThis = renderJob?.episodeId === ep.id;
              const videoPlayerSrc = previewVideoUrls[ep.id];
              const isUploaded = ep.status === 'exported';

              return (
                <article
                  key={ep.id}
                  className="rounded-lg border border-white/10 bg-[#121826] overflow-hidden"
                >
                  {/* Episode Header */}
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono-tabular text-amber-400">{ep.createdDate}</span>
                        <span aria-hidden="true">·</span>
                        <span>{ep.idea.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{ep.visualPlan.scenes.length} scenes</span>
                        <span aria-hidden="true">·</span>
                        <span className={cachedFull ? 'text-emerald-400' : 'text-slate-400'}>
                          {cachedFull
                            ? `Video cached (${formatBytes(cachedFull.sizeBytes)})`
                            : 'Audio & scenes ready'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={isUploaded ? 'text-slate-300' : 'text-amber-300'}>
                          {isUploaded ? 'Uploaded' : 'Ready to Upload'}
                        </span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-slate-100 leading-snug">
                        {topTitle}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Idea: {ep.idea.title} · Target: {ep.idea.targetViewer}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleDownloadCachedOrRenderFull(ep)}
                        disabled={Boolean((renderJob && !isRenderingThis) || convertingKey)}
                        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                          isRenderingThis
                            ? 'bg-amber-500 text-slate-950'
                            : cachedFull
                              ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                              : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        } disabled:opacity-50`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {isRenderingThis
                          ? renderJob?.progressLabel
                          : convertingKey === fullCacheKey
                            ? `Converting ${exportFormat.toUpperCase()}...`
                            : cachedFull
                              ? `Download Full Video (.${exportFormat})`
                              : `Extract & Save (.${exportFormat})`}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void onToggleEpisodeStatus(ep.id, isUploaded ? 'ready' : 'exported')
                        }
                        className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                          isUploaded
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-white/15 bg-[#0B0F19] text-slate-300 hover:border-emerald-500/50'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {isUploaded ? 'Uploaded' : 'Mark Uploaded'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadEpisodeIntoStudio(ep)}
                        className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#0B0F19] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 whitespace-nowrap"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                        Open in 3D Studio
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(ep.id)}
                        className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-400"
                        title="Delete episode"
                        aria-label="Delete episode"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Episode Sub-Tabs */}
                  <div className="flex items-center gap-1 border-b border-white/10 bg-[#0B0F19]/50 px-5 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTabById((prev) => ({ ...prev, [ep.id]: 'video' }))
                      }
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeTab === 'video'
                          ? 'bg-[#182032] text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Full Video & Scene Clips ({ep.visualPlan.scenes.length})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTabById((prev) => ({ ...prev, [ep.id]: 'thumbnails' }))
                      }
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeTab === 'thumbnails'
                          ? 'bg-[#182032] text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Thumbnails & YouTube Description
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTabById((prev) => ({ ...prev, [ep.id]: 'script' }))
                      }
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeTab === 'script'
                          ? 'bg-[#182032] text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Full Script ({ep.scriptStage.estimatedWordCount} words)
                    </button>
                  </div>

                  {/* Tab Body */}
                  <div className="p-5">
                    {activeTab === 'video' && (
                      <div className="space-y-4">
                        {/* Cached Full Video Player Preview */}
                        {cachedFull && (
                          <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-emerald-400">
                                Full 3D Video Cached Ready ({formatBytes(cachedFull.sizeBytes)})
                              </span>
                              {!videoPlayerSrc && (
                                <button
                                  type="button"
                                  onClick={() => void handleLoadPreviewPlayer(ep.id)}
                                  className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                                >
                                  <Play className="h-3 w-3" />
                                  Preview Player
                                </button>
                              )}
                            </div>
                            {videoPlayerSrc && (
                              <video
                                controls
                                src={videoPlayerSrc}
                                className="w-full max-h-[360px] rounded border border-white/10 bg-black"
                              />
                            )}
                          </div>
                        )}

                        {/* Individual Scene Clips ("Download Parts") */}
                        <div className="rounded border border-white/10 bg-[#0B0F19] overflow-hidden">
                          <div className="grid grid-cols-12 gap-3 border-b border-white/10 bg-[#182032]/70 px-4 py-2 text-[11px] font-semibold text-slate-300">
                            <div className="col-span-1">Part</div>
                            <div className="col-span-4">Scene Beat & On-Screen Text</div>
                            <div className="col-span-4">Narration Line</div>
                            <div className="col-span-3 text-right">Download Part</div>
                          </div>
                          <div className="divide-y divide-white/10">
                            {ep.visualPlan.scenes.map((sc) => {
                              const clipKey = `ep:${ep.id}:scene:${sc.sceneNumber}`;
                              const cachedClip = cachedVideoMeta[clipKey];
                              const renderingClip =
                                isRenderingThis &&
                                renderJob?.mode === 'clip' &&
                                renderJob.sceneNumber === sc.sceneNumber;

                              return (
                                <div
                                  key={sc.sceneNumber}
                                  className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-xs"
                                >
                                  <div className="col-span-1 font-mono-tabular text-amber-400">
                                    S{String(sc.sceneNumber).padStart(2, '0')}
                                  </div>
                                  <div className="col-span-4 min-w-0">
                                    <p className="font-medium text-slate-100 truncate">{sc.title}</p>
                                    <p className="text-[11px] text-amber-300/90 truncate">
                                      {sc.onScreenText} · {sc.durationSeconds}s
                                    </p>
                                  </div>
                                  <div className="col-span-4 text-[11px] text-slate-400 line-clamp-2">
                                    {sc.narrationCue}
                                  </div>
                                  <div className="col-span-3 flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      disabled={Boolean(renderJob || convertingKey)}
                                      onClick={() => void handleExtractOrDownloadSceneClip(ep, sc)}
                                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                                        cachedClip
                                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                                          : 'border-white/15 bg-[#121826] text-slate-200 hover:border-amber-500/50'
                                      } disabled:opacity-50`}
                                    >
                                      <Scissors className="h-3 w-3" />
                                      {renderingClip
                                        ? 'Recording...'
                                        : convertingKey === clipKey
                                          ? `Converting...`
                                          : cachedClip
                                            ? `Clip .${exportFormat}`
                                            : `Render .${exportFormat}`}
                                    </button>
                                    <a
                                      href={`/api/vault/episodes/${ep.id}/audio/${sc.sceneNumber}?download=1`}
                                      download={`scene-${sc.sceneNumber}.wav`}
                                      className="inline-flex items-center gap-1 rounded border border-white/15 bg-[#121826] px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/50 whitespace-nowrap"
                                    >
                                      <Volume2 className="h-3 w-3 text-amber-400" />
                                      WAV
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'thumbnails' && (
                      <div className="space-y-5">
                        {/* Copyable Title, Description & Tags */}
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div className="rounded border border-white/10 bg-[#0B0F19] p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-200">
                                YouTube Video Description
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void copyText(
                                    `${ep.id}-desc`,
                                    ep.packagingLab?.youtubeDescription || '',
                                  )
                                }
                                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                              >
                                {copiedKey === `${ep.id}-desc` ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                {copiedKey === `${ep.id}-desc` ? 'Copied' : 'Copy Description'}
                              </button>
                            </div>
                            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">
                              {ep.packagingLab?.youtubeDescription ||
                                'No description generated yet.'}
                            </pre>
                          </div>

                          <div className="rounded border border-white/10 bg-[#0B0F19] p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-200">
                                Top Titles & YouTube Tags
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void copyText(
                                    `${ep.id}-tags`,
                                    (ep.packagingLab?.youtubeTags || []).join(', '),
                                  )
                                }
                                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                              >
                                {copiedKey === `${ep.id}-tags` ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                {copiedKey === `${ep.id}-tags` ? 'Copied' : 'Copy Tags'}
                              </button>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              {(ep.packagingLab?.topThree || []).map((t) => (
                                <div
                                  key={t.rank}
                                  className="flex items-center justify-between gap-2 border-b border-white/5 pb-1.5"
                                >
                                  <span className="text-slate-200 truncate">
                                    <span className="font-mono-tabular text-amber-400 mr-1.5">
                                      #{t.rank}
                                    </span>
                                    {t.title}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void copyText(`${ep.id}-t-${t.rank}`, t.title)}
                                    className="shrink-0 text-slate-400 hover:text-amber-400"
                                  >
                                    {copiedKey === `${ep.id}-t-${t.rank}` ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ))}
                            </div>
                            <p className="text-[11px] leading-relaxed text-slate-400">
                              Tags: {(ep.packagingLab?.youtubeTags || []).join(' · ')}
                            </p>
                          </div>
                        </div>

                        {/* 5 Rendered 16:9 Thumbnail Mockups */}
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                              <ImageIcon className="h-3.5 w-3.5 text-amber-400" />
                              5 Ready-to-Download 16:9 Thumbnails
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCaptureEpisodeSnapshot(ep)}
                              className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline"
                            >
                              <Film className="h-3 w-3" />
                              Apply Live 3D Backdrop
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {(ep.packagingLab?.thumbnails || []).map((thumb) => (
                              <VaultThumbnailCanvas
                                key={thumb.id}
                                concept={thumb}
                                backdropSnapshot={episodeSnapshots[ep.id] || null}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'script' && (
                      <div className="space-y-3 text-xs">
                        <div className="rounded border border-white/10 bg-[#0B0F19] p-3.5">
                          <span className="font-semibold text-amber-400">10-Second Hook</span>
                          <p className="mt-1 leading-relaxed text-slate-200">
                            {ep.scriptStage.hook10Seconds}
                          </p>
                        </div>
                        {ep.scriptStage.sections.map((sec, idx) => (
                          <div
                            key={idx}
                            className="rounded border border-white/10 bg-[#0B0F19] p-3.5 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-100">
                                {idx + 1}. {sec.sectionTitle}
                              </span>
                              <span className="font-mono-tabular text-slate-400">
                                {sec.estimatedSeconds}s
                              </span>
                            </div>
                            <p className="leading-relaxed text-slate-300">{sec.narration}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
