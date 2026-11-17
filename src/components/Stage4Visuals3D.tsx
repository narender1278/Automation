import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Volume2,
  Camera,
  Lock,
  Unlock,
  Copy,
  Check,
  Film,
  Sparkles,
  Type as TypeIcon,
  Video,
  Download,
} from 'lucide-react';
import { Stage3DViewport, type Stage3DViewportHandle } from './Stage3DViewport';
import {
  startWorkerInterval,
  triggerBlobDownload,
  type VideoExportFormat,
} from '../utils/videoExport';
import { renderScenesDeterministically } from '../utils/offlineVideoRenderer';
import type {
  CameraPreset,
  CharacterAction,
  LightingMood,
  SceneItem,
  StageSet,
  StoryActivity,
  VisualPlan,
  VoiceName,
} from '../types/studio';

interface Stage4Visuals3DProps {
  visualPlan: VisualPlan | null;
  hasScript: boolean;
  stylePreference: string;
  onChangeStylePreference: (val: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  onUpdateScene: (sceneNumber: number, patch: Partial<SceneItem>) => void;
  onSaveCapturedFrame: (dataUrl: string) => void;
  onExportStateChange?: (active: boolean) => void;
}

const ACTION_OPTIONS: { id: CharacterAction; label: string }[] = [
  { id: 'idle_breath', label: 'Idle Breath' },
  { id: 'storyteller_gesture', label: 'Storyteller' },
  { id: 'emphasize_point', label: 'Emphasize' },
  { id: 'heroic_stance', label: 'Heroic Stance' },
  { id: 'reflective_nod', label: 'Reflective Nod' },
  { id: 'dramatic_lean', label: 'Dramatic Lean' },
];

const CAMERA_OPTIONS: { id: CameraPreset; label: string }[] = [
  { id: 'wide_stage', label: 'Wide Stage' },
  { id: 'medium_shot', label: 'Medium Shot' },
  { id: 'closeup_lipsync', label: 'Close-Up Lip' },
  { id: 'low_hero', label: 'Low Hero' },
];

const LIGHTING_OPTIONS: { id: LightingMood; label: string }[] = [
  { id: 'warm_dawn', label: 'Warm Dawn' },
  { id: 'torchlit_mythic', label: 'Torchlit' },
  { id: 'obsidian_studio', label: 'Obsidian' },
];

const SET_OPTIONS: { id: StageSet; label: string }[] = [
  { id: 'philosopher_pillar', label: 'Pillar' },
  { id: 'summit_overlook', label: 'Summit' },
  { id: 'ancient_archive', label: 'Archive' },
  { id: 'crossroads_cafe', label: 'Crossroads' },
];

const VOICES: VoiceName[] = ['Charon', 'Kore', 'Fenrir', 'Puck', 'Zephyr'];

const STORY_ACTIVITY_OPTIONS: { id: '' | StoryActivity; label: string }[] = [
  { id: '', label: 'Auto (From Script)' },
  { id: 'crossroads_meeting', label: 'Friends Meet & Café' },
  { id: 'mentorship_dialogue', label: 'Mentor Walk' },
  { id: 'orator_walk', label: 'Orator Walk' },
  { id: 'forge_labor', label: 'Forge Hammer' },
  { id: 'climb_ascent', label: 'Climb Steps' },
  { id: 'scholar_study', label: 'Scholar Scroll' },
  { id: 'duel_overcome', label: 'Shadow Duel' },
  { id: 'triumph_raise', label: 'Triumph Torch' },
];

const FALLBACK_SCENE: SceneItem = {
  sceneNumber: 1,
  title: 'Crossroads Meeting & Handshake',
  narrationCue:
    'Two paths cross when we slow down long enough to listen, sit together at the table, and part with a clear promise.',
  visualDescription:
    'Two friends walk from opposite ends of the street, meet at the interjunction, walk to the roadside café table, sit, nod, shake hands, and wave goodbye.',
  imagePrompt:
    'Cinematic dark evening crossroads with a warm lamp-lit sidewalk bistro table, two friends conversing before parting ways, 35mm filmic lighting.',
  videoPrompt: 'Wide crossroads tracking shot transitioning to a warm two-shot at the sidewalk café table.',
  brollSuggestion: 'Warm streetlamp reflections over twilight asphalt and café table.',
  onScreenText: 'TWO PATHS AT THE CROSSROADS',
  durationSeconds: 18,
  action: 'storyteller_gesture',
  storyActivity: 'crossroads_meeting',
  cameraPreset: 'medium_shot',
  lightingMood: 'warm_dawn',
  stageSet: 'crossroads_cafe',
  voiceName: 'Charon',
  lipSyncIntensity: 1.05,
};

export function Stage4Visuals3D({
  visualPlan,
  hasScript,
  stylePreference,
  onChangeStylePreference,
  isGenerating,
  onGenerate,
  onUpdateScene,
  onSaveCapturedFrame,
  onExportStateChange,
}: Stage4Visuals3DProps) {
  const viewportRef = useRef<Stage3DViewportHandle | null>(null);
  const scenes = visualPlan?.scenes?.length ? visualPlan.scenes : [FALLBACK_SCENE];

  const [selectedSceneNum, setSelectedSceneNum] = useState<number>(1);
  const [inspectorTab, setInspectorTab] = useState<'cue' | 'prompts'>('cue');
  const [orbitUnlocked, setOrbitUnlocked] = useState(false);
  const [showOnScreenText, setShowOnScreenText] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);

  // Audio & Lip-Sync State
  const [isSynthesizingTts, setIsSynthesizingTts] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isSequencePlaying, setIsSequencePlaying] = useState(false);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [isExportingAudio, setIsExportingAudio] = useState(false);
  const [exportFormat, setExportFormat] = useState<VideoExportFormat>('mp4');
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [meterBars, setMeterBars] = useState<number[]>(() => new Array(10).fill(0.08));

  // Local overrides when previewing the fallback scene before Stage 4 generation
  const [fallbackState, setFallbackState] = useState<SceneItem>(FALLBACK_SCENE);

  const activeScene =
    visualPlan?.scenes?.find((s) => s.sceneNumber === selectedSceneNum) ??
    (visualPlan?.scenes?.[0] || fallbackState);

  const lipSyncRef = useRef({
    jawOpen: 0,
    lipSpread: 0,
    isPlaying: false,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const keepaliveOscRef = useRef<OscillatorNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lipWorkerStopRef = useRef<(() => void) | null>(null);
  const ttsCacheRef = useRef<Map<string, string>>(new Map());
  const cadenceTimerRef = useRef<number>(0);
  const sequenceRef = useRef<{ active: boolean }>({ active: false });
  const exportRef = useRef<{ active: boolean }>({ active: false });

  useEffect(() => {
    if (visualPlan?.scenes?.length) {
      setSelectedSceneNum(visualPlan.scenes[0].sceneNumber);
    }
  }, [visualPlan]);

  useEffect(() => {
    onExportStateChange?.(isExportingVideo);
  }, [isExportingVideo, onExportStateChange]);

  const ensureAudioRouting = async () => {
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
    if (!mediaStreamDestRef.current) {
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      osc.connect(silentGain);
      silentGain.connect(dest);
      osc.start();
      keepaliveOscRef.current = osc;
      mediaStreamDestRef.current = dest;
    }
    return { ctx, dest: mediaStreamDestRef.current };
  };

  const resetActiveAudio = () => {
    setIsPlayingAudio(false);
    lipSyncRef.current.isPlaying = false;
    lipSyncRef.current.jawOpen = 0;
    lipSyncRef.current.lipSpread = 0;
    lipWorkerStopRef.current?.();
    lipWorkerStopRef.current = null;
    clearTimeout(cadenceTimerRef.current);
    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
    }
    setMeterBars(new Array(10).fill(0.08));
  };

  const stopPlayback = () => {
    sequenceRef.current.active = false;
    setIsSequencePlaying(false);
    resetActiveAudio();
    exportRef.current.active = false;
  };

  useEffect(() => {
    return () => {
      sequenceRef.current.active = false;
      exportRef.current.active = false;
      resetActiveAudio();
      try {
        keepaliveOscRef.current?.stop();
      } catch {
        // ignore
      }
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const patchActiveScene = (patch: Partial<SceneItem>) => {
    if (visualPlan?.scenes?.length) {
      onUpdateScene(activeScene.sceneNumber, patch);
    } else {
      setFallbackState((prev) => ({ ...prev, ...patch }));
    }
  };

  const runSilentCadencePreview = (durationMs: number, intensity: number, onDone?: () => void) => {
    resetActiveAudio();
    setIsPlayingAudio(true);
    lipSyncRef.current.isPlaying = true;
    const start = performance.now();

    // Web Worker timer keeps cadence running smoothly even if tab is switched mid-export
    lipWorkerStopRef.current = startWorkerInterval(() => {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) {
        lipWorkerStopRef.current?.();
        lipWorkerStopRef.current = null;
        setIsPlayingAudio(false);
        lipSyncRef.current.isPlaying = false;
        lipSyncRef.current.jawOpen = 0;
        lipSyncRef.current.lipSpread = 0;
        setMeterBars(new Array(10).fill(0.08));
        onDone?.();
        return;
      }
      const s = elapsed / 1000;
      const syllable =
        Math.max(0, Math.sin(s * 14.5) * 0.55 + Math.sin(s * 7.2 + 1.1) * 0.45) *
        (0.55 + 0.45 * Math.sin(s * 2.8));
      const jaw = Math.min(1, syllable * intensity);
      lipSyncRef.current.jawOpen = jaw;
      lipSyncRef.current.lipSpread = Math.abs(Math.cos(s * 9.5)) * jaw;
      if (!document.hidden) {
        setMeterBars(
          Array.from({ length: 10 }, (_, idx) => {
            const wave = Math.abs(Math.sin(s * (8 + idx * 1.3)));
            return Math.max(0.08, Math.min(1, jaw * (0.4 + 0.6 * wave)));
          }),
        );
      }
    }, 33);
  };

  const synthesizeSceneWav = async (scene: SceneItem): Promise<string> => {
    const cacheKey = `${scene.voiceName}::${scene.narrationCue}`;
    const cached = ttsCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const res = await fetch('/api/studio/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: scene.narrationCue,
        voiceName: scene.voiceName,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Voice synthesis failed');
    }
    const dataUrl = `data:${json.mimeType || 'audio/wav'};base64,${json.audioBase64}`;
    ttsCacheRef.current.set(cacheKey, dataUrl);
    return dataUrl;
  };

  const playSceneAudio = async (scene: SceneItem, onEndedCallback?: () => void) => {
    setTtsError(null);
    const cacheKey = `${scene.voiceName}::${scene.narrationCue}`;
    let dataUrl = ttsCacheRef.current.get(cacheKey);

    if (!dataUrl) {
      setIsSynthesizingTts(true);
      try {
        dataUrl = await synthesizeSceneWav(scene);
      } catch (err) {
        setIsSynthesizingTts(false);
        setTtsError(
          err instanceof Error
            ? `${err.message} — running silent lip-sync cadence preview.`
            : 'Using silent lip-sync cadence preview.',
        );
        runSilentCadencePreview(
          Math.min(scene.durationSeconds * 1000, 6000),
          scene.lipSyncIntensity,
          onEndedCallback,
        );
        return;
      }
      setIsSynthesizingTts(false);
    }

    try {
      const { ctx, dest } = await ensureAudioRouting();

      resetActiveAudio();

      const audio = new Audio(dataUrl);
      audioElRef.current = audio;

      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyser.connect(dest);
      analyserRef.current = analyser;

      const freqData = new Uint8Array(analyser.frequencyBinCount);

      setIsPlayingAudio(true);
      lipSyncRef.current.isPlaying = true;

      const updateLipLoop = () => {
        if (!audioElRef.current || audioElRef.current.paused || audioElRef.current.ended) {
          return;
        }
        analyser.getByteFrequencyData(freqData);
        let speechSum = 0;
        for (let i = 1; i < 14; i++) {
          speechSum += freqData[i] || 0;
        }
        const avg = speechSum / (13 * 255);
        const scaled = Math.min(1, avg * 2.4 * scene.lipSyncIntensity);
        lipSyncRef.current.jawOpen = scaled;
        lipSyncRef.current.lipSpread = Math.min(1, ((freqData[6] || 0) / 255) * 1.6);

        if (!document.hidden) {
          setMeterBars(
            Array.from({ length: 10 }, (_, idx) =>
              Math.max(0.08, Math.min(1, ((freqData[idx + 1] || 0) / 255) * 1.35)),
            ),
          );
        }
      };

      audio.onended = () => {
        lipWorkerStopRef.current?.();
        lipWorkerStopRef.current = null;
        setIsPlayingAudio(false);
        lipSyncRef.current.isPlaying = false;
        lipSyncRef.current.jawOpen = 0;
        lipSyncRef.current.lipSpread = 0;
        setMeterBars(new Array(10).fill(0.08));
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {
          // ignore disconnect race
        }
        onEndedCallback?.();
      };

      await audio.play();
      lipWorkerStopRef.current = startWorkerInterval(updateLipLoop, 33);
    } catch {
      runSilentCadencePreview(4500, scene.lipSyncIntensity, onEndedCallback);
    }
  };

  const handlePlayFullSequence = () => {
    if (isSequencePlaying) {
      stopPlayback();
      return;
    }
    stopPlayback();
    sequenceRef.current.active = true;
    setIsSequencePlaying(true);

    const playIndex = (idx: number) => {
      if (!sequenceRef.current.active || idx >= scenes.length) {
        stopPlayback();
        return;
      }
      const nextScene = scenes[idx];
      setSelectedSceneNum(nextScene.sceneNumber);
      void playSceneAudio(nextScene, () => {
        if (sequenceRef.current.active) {
          playIndex(idx + 1);
        }
      });
    };

    const startIdx = Math.max(
      0,
      scenes.findIndex((s) => s.sceneNumber === activeScene.sceneNumber),
    );
    playIndex(startIdx);
  };

  const handleExportVideo = async () => {
    if (isExportingVideo) {
      exportRef.current.active = false;
      setExportProgress('Stopping...');
      return;
    }

    if (!viewportRef.current) {
      setTtsError('3D viewport is not initialized yet.');
      return;
    }

    stopPlayback();
    setTtsError(null);
    setIsExportingVideo(true);
    exportRef.current.active = true;
    const targetFormat = exportFormat;

    try {
      const outBlob = await renderScenesDeterministically({
        scenes,
        viewport: viewportRef.current,
        format: targetFormat,
        showOnScreenText,
        fps: 24,
        shouldCancel: () => !exportRef.current.active,
        onSceneStart: (sc) => setSelectedSceneNum(sc.sceneNumber),
        onProgress: (label) => setExportProgress(label),
        resolveAudioSrc: async (sc) => {
          const cacheKey = `${sc.voiceName}::${sc.narrationCue}`;
          const cached = ttsCacheRef.current.get(cacheKey);
          if (cached) return cached;
          try {
            return await synthesizeSceneWav(sc);
          } catch {
            return null;
          }
        },
      });

      if (outBlob && outBlob.size > 0 && exportRef.current.active) {
        const baseName = visualPlan ? 'storyline-3d-video' : 'storyline-3d-demo';
        triggerBlobDownload(outBlob, `${baseName}.${targetFormat}`);
      }
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : 'Failed to export 3D video.');
    } finally {
      exportRef.current.active = false;
      setIsExportingVideo(false);
      setExportProgress(null);
    }
  };

  const handleExportSceneAudio = async () => {
    setTtsError(null);
    setIsExportingAudio(true);
    try {
      const dataUrl = await synthesizeSceneWav(activeScene);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `scene-${activeScene.sceneNumber}-${activeScene.voiceName.toLowerCase()}.wav`;
      link.click();
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : 'Could not export scene audio.');
    } finally {
      setIsExportingAudio(false);
    }
  };

  const handleCaptureFrame = () => {
    const dataUrl = viewportRef.current?.captureFramePng();
    if (!dataUrl) return;
    onSaveCapturedFrame(dataUrl);
    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 1200);

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `scene-${activeScene.sceneNumber}-${activeScene.cameraPreset}.png`;
    link.click();
  };

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* FIXED LEFT/CENTER 3D STAGE + FIXED LIP-SYNC & ACTION CONTROL DOCK */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0B0F19]">
        {/* Unobstructed 3D Viewport */}
        <div className="relative flex-1 min-h-[260px] p-3 pb-2">
          <Stage3DViewport
            ref={viewportRef}
            action={activeScene.action}
            storyActivity={activeScene.storyActivity}
            directorBlocks={activeScene.directorBlocks}
            sceneDurationSec={activeScene.durationSeconds}
            scriptCue={`${activeScene.title} ${activeScene.visualDescription} ${activeScene.narrationCue}`}
            cameraPreset={activeScene.cameraPreset}
            lightingMood={activeScene.lightingMood}
            stageSet={activeScene.stageSet}
            actionIntensity={activeScene.lipSyncIntensity}
            onScreenText={activeScene.onScreenText}
            showOnScreenText={showOnScreenText}
            lipSyncRef={lipSyncRef}
            orbitUnlocked={orbitUnlocked}
          />
        </div>

        {/* FIXED BOTTOM CONTROL DOCK: LIP-SYNC, VOICEOVER, ACTIONS, CAMERA & SET */}
        <div className="shrink-0 border-t border-white/10 bg-[#121826] px-4 py-3 space-y-2.5">
          {/* Row 1: Lip-Sync & Voiceover Transport */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isPlayingAudio) {
                    stopPlayback();
                  } else {
                    void playSceneAudio(activeScene);
                  }
                }}
                disabled={isSynthesizingTts || isExportingVideo}
                className="inline-flex items-center gap-1.5 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60 whitespace-nowrap"
              >
                {isPlayingAudio ? (
                  <>
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Stop Voice
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5" />
                    {isSynthesizingTts ? 'Synthesizing...' : 'Speak & Lip-Sync'}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  isPlayingAudio
                    ? stopPlayback()
                    : runSilentCadencePreview(4000, activeScene.lipSyncIntensity)
                }
                disabled={isExportingVideo}
                className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#0B0F19] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Test Lip-Sync
              </button>

              <button
                type="button"
                onClick={handlePlayFullSequence}
                disabled={isExportingVideo}
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 whitespace-nowrap ${
                  isSequencePlaying
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-white/15 bg-[#0B0F19] text-slate-200 hover:border-amber-500/50'
                }`}
              >
                <Play className="h-3.5 w-3.5" />
                {isSequencePlaying ? 'Playing Sequence' : 'Play All Scenes'}
              </button>

              <select
                aria-label="Narrator Voice"
                value={activeScene.voiceName}
                onChange={(e) => patchActiveScene({ voiceName: e.target.value as VoiceName })}
                disabled={isExportingVideo}
                className="rounded border border-white/15 bg-[#0B0F19] px-2 py-1.5 text-xs font-medium text-slate-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
              >
                {VOICES.map((v) => (
                  <option key={v} value={v}>
                    Voice: {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Lip-Sync Amplitude Meter + Intensity + Export Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5" title="Real-time Lip-Sync Amplitude">
                <span className="text-[11px] font-medium text-slate-400">Lip Sync</span>
                <div className="flex h-5 items-end gap-0.5 rounded border border-white/10 bg-[#0B0F19] px-1.5 py-1">
                  {meterBars.map((val, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-sm bg-amber-400 transition-transform duration-75"
                      style={{ height: `${Math.round(val * 14)}px` }}
                    />
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <span>Intensity</span>
                <input
                  type="range"
                  min={0.6}
                  max={1.5}
                  step={0.05}
                  value={activeScene.lipSyncIntensity}
                  onChange={(e) =>
                    patchActiveScene({ lipSyncIntensity: Number(e.target.value) })
                  }
                  className="w-16 accent-amber-500"
                />
                <span className="font-mono-tabular w-7 text-right text-amber-400">
                  {activeScene.lipSyncIntensity.toFixed(1)}
                </span>
              </label>

              <button
                type="button"
                onClick={handleExportSceneAudio}
                disabled={isExportingAudio || isExportingVideo}
                title="Download this scene's voiceover (.wav)"
                className="inline-flex items-center gap-1 rounded border border-white/15 bg-[#0B0F19] px-2 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-amber-400" />
                {isExportingAudio ? 'Audio...' : 'Audio (.wav)'}
              </button>

              <button
                type="button"
                onClick={handleCaptureFrame}
                disabled={isExportingVideo}
                className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-[#182032] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5 text-amber-400" />
                {captureFlash ? 'Frame Saved' : 'Capture Frame'}
              </button>

              <div className="flex items-center gap-1">
                <select
                  aria-label="Export Video Format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as VideoExportFormat)}
                  disabled={isExportingVideo}
                  className="rounded border border-white/15 bg-[#0B0F19] px-2 py-1.5 text-xs font-semibold uppercase text-slate-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
                >
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WebM</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleExportVideo()}
                  title={`Record full 1280x720 3D video as .${exportFormat} (continues in background if you switch tabs)`}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    isExportingVideo
                      ? 'bg-red-500 text-white hover:bg-red-400'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  }`}
                >
                  <Video className="h-3.5 w-3.5" />
                  {isExportingVideo
                    ? `${exportProgress || 'Recording...'} · Stop`
                    : `Export Video (.${exportFormat})`}
                </button>
              </div>
            </div>
          </div>

          {ttsError && (
            <p className="text-[11px] text-amber-300">{ttsError}</p>
          )}

          {/* Row 2: Fixed 6 Character Action Buttons + Script Story Choreography Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Actions
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => patchActiveScene({ action: opt.id })}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeScene.action === opt.id
                        ? 'bg-amber-500 text-slate-950'
                        : 'border border-white/10 bg-[#0B0F19] text-slate-300 hover:border-white/25 hover:text-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                Choreography
              </span>
              <select
                aria-label="Story Action Choreography"
                value={activeScene.directorBlocks?.length ? '' : activeScene.storyActivity || ''}
                onChange={(e) => {
                  const nextAct = (e.target.value || undefined) as StoryActivity | undefined;
                  patchActiveScene(
                    nextAct === 'crossroads_meeting'
                      ? { storyActivity: nextAct, directorBlocks: undefined, stageSet: 'crossroads_cafe' }
                      : { storyActivity: nextAct, directorBlocks: undefined },
                  );
                }}
                className="rounded border border-white/15 bg-[#0B0F19] px-2 py-1 text-xs font-medium text-emerald-300 focus:border-amber-500/60 focus:outline-none"
              >
                {STORY_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.id || 'auto'} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Row 3: Fixed Camera, Lighting, Set & Orbit Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Camera
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CAMERA_OPTIONS.map((cam) => (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => patchActiveScene({ cameraPreset: cam.id })}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeScene.cameraPreset === cam.id
                        ? 'bg-[#182032] text-amber-300 ring-1 ring-amber-500/60'
                        : 'border border-white/10 bg-[#0B0F19] text-slate-300 hover:text-slate-100'
                    }`}
                  >
                    {cam.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                {LIGHTING_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => patchActiveScene({ lightingMood: m.id })}
                    className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                      activeScene.lightingMood === m.id
                        ? 'bg-[#182032] text-amber-300 ring-1 ring-amber-500/50'
                        : 'border border-white/10 bg-[#0B0F19] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {SET_OPTIONS.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => patchActiveScene({ stageSet: st.id })}
                    className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                      activeScene.stageSet === st.id
                        ? 'bg-[#182032] text-amber-300 ring-1 ring-amber-500/50'
                        : 'border border-white/10 bg-[#0B0F19] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setOrbitUnlocked((prev) => !prev)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                  orbitUnlocked
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 bg-[#0B0F19] text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle mouse orbit lock"
              >
                {orbitUnlocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {orbitUnlocked ? 'Orbit Free' : 'Cam Fixed'}
              </button>

              <button
                type="button"
                onClick={() => setShowOnScreenText((prev) => !prev)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                  showOnScreenText
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 bg-[#0B0F19] text-slate-400 hover:text-slate-200'
                }`}
              >
                <TypeIcon className="h-3 w-3" />
                Text
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FIXED RIGHT SCENE INSPECTOR (380px) */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10 bg-[#121826]">
        {/* Direction Setup Header */}
        <div className="shrink-0 border-b border-white/10 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Scene Director & Prompts
            </h2>
            <span className="font-mono-tabular text-xs text-slate-400">
              {visualPlan ? `${visualPlan.scenes.length} Scenes` : 'Demo Stage'}
            </span>
          </div>

          <input
            type="text"
            value={stylePreference}
            onChange={(e) => onChangeStylePreference(e.target.value)}
            placeholder="Consistent color & lighting direction..."
            className="w-full rounded border border-white/10 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
          />

          {!visualPlan && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating || !hasScript}
              className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              <Film className="h-3.5 w-3.5" />
              {hasScript
                ? isGenerating
                  ? 'Directing 3D Scenes...'
                  : 'Generate Scene Plan From Script'
                : 'Generate Script in Stage 3 First'}
            </button>
          )}
        </div>

        {/* Fixed Scene Strip */}
        <div className="shrink-0 border-b border-white/10 bg-[#0B0F19]/60 px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {scenes.map((sc) => (
              <button
                key={sc.sceneNumber}
                type="button"
                onClick={() => setSelectedSceneNum(sc.sceneNumber)}
                className={`shrink-0 rounded px-2.5 py-1.5 text-left transition-colors ${
                  activeScene.sceneNumber === sc.sceneNumber
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'border border-white/10 bg-[#121826] text-slate-300 hover:border-white/25'
                }`}
              >
                <span className="font-mono-tabular text-xs">
                  S{String(sc.sceneNumber).padStart(2, '0')}
                </span>
                <span className="ml-1.5 font-mono-tabular text-[11px] opacity-80">
                  {sc.durationSeconds}s
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Fixed Inspector Sub-Tabs */}
        <div className="grid shrink-0 grid-cols-2 border-b border-white/10 bg-[#182032]/50 p-1">
          <button
            type="button"
            onClick={() => setInspectorTab('cue')}
            className={`rounded py-1.5 text-xs font-medium transition-colors ${
              inspectorTab === 'cue'
                ? 'bg-[#121826] text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Narration & 3D Cue
          </button>
          <button
            type="button"
            onClick={() => setInspectorTab('prompts')}
            className={`rounded py-1.5 text-xs font-medium transition-colors ${
              inspectorTab === 'prompts'
                ? 'bg-[#121826] text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            AI Prompts & B-Roll
          </button>
        </div>

        {/* Scrollable Inspector Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Scene {activeScene.sceneNumber}: {activeScene.title}
            </h3>
            <span className="font-mono-tabular text-amber-400">
              {activeScene.durationSeconds}s
            </span>
          </div>

          {inspectorTab === 'cue' ? (
            <>
              <div>
                <label className="block font-semibold text-slate-300">
                  Spoken Narration Cue (Drives Lip-Sync)
                </label>
                <textarea
                  rows={4}
                  value={activeScene.narrationCue}
                  onChange={(e) => patchActiveScene({ narrationCue: e.target.value })}
                  className="mt-1.5 w-full rounded border border-white/10 bg-[#0B0F19] p-2.5 text-xs leading-relaxed text-slate-100 focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300">
                  On-Screen Text Overlay
                </label>
                <input
                  type="text"
                  value={activeScene.onScreenText}
                  onChange={(e) => patchActiveScene({ onScreenText: e.target.value })}
                  className="mt-1.5 w-full rounded border border-white/10 bg-[#0B0F19] px-2.5 py-2 text-xs text-amber-300 focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-1.5">
                <span className="font-semibold text-slate-300">Visual Direction</span>
                <p className="leading-relaxed text-slate-400">{activeScene.visualDescription}</p>
              </div>

              {visualPlan?.styleBible && (
                <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-1.5">
                  <span className="font-semibold text-amber-400">Consistent Style Bible</span>
                  <p className="text-slate-300">{visualPlan.styleBible.visualStyle}</p>
                  <p className="text-slate-400">Palette: {visualPlan.styleBible.colorPalette}</p>
                  <p className="text-slate-400">Lighting: {visualPlan.styleBible.lightingDirection}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">AI Image Prompt</span>
                  <button
                    type="button"
                    onClick={() => copyText('img', activeScene.imagePrompt)}
                    className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300"
                  >
                    {copiedKey === 'img' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedKey === 'img' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="leading-relaxed text-slate-300">{activeScene.imagePrompt}</p>
              </div>

              <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">AI Video / Motion Prompt</span>
                  <button
                    type="button"
                    onClick={() => copyText('vid', activeScene.videoPrompt)}
                    className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300"
                  >
                    {copiedKey === 'vid' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedKey === 'vid' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="leading-relaxed text-slate-300">{activeScene.videoPrompt}</p>
              </div>

              <div className="rounded border border-white/10 bg-[#0B0F19] p-3 space-y-1">
                <span className="font-semibold text-slate-200">B-Roll Suggestion</span>
                <p className="leading-relaxed text-slate-400">{activeScene.brollSuggestion}</p>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
