"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VoiceInteractionSignals } from "@/lib/tutor/types";

const SAMPLE_RATE = 16000;
const SMART_TURN_AUDIO_WINDOW_SECONDS = 8;
const INCOMPLETE_TURN_SILENCE_FALLBACK_MS = 2500;

type VoiceRecorderProps = {
  disabled: boolean;
  sourceLanguage: string;
  tutorSpeaking?: boolean;
  waitingForResponse?: boolean;
  onTranscript: (text: string, voiceInteractionSignals?: VoiceInteractionSignals) => void;
};

type MicVADInstance = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
};

type TurnAnalysisResponse = {
  complete: boolean;
  probability: number;
  source: VoiceInteractionSignals["smartTurnSource"];
  reason?: string;
};

type VoiceTurnStats = {
  smartTurnProbability: number | null;
  smartTurnSource: VoiceInteractionSignals["smartTurnSource"];
  incompleteTurnCount: number;
  forcedAfterLongSilence: boolean;
  speechSegmentCount: number;
  answerAudioDurationMs: number;
};

export function VoiceRecorder({
  disabled,
  sourceLanguage,
  tutorSpeaking = false,
  waitingForResponse = false,
  onTranscript
}: VoiceRecorderProps) {
  const vadRef = useRef<MicVADInstance | null>(null);
  const pendingTurnAudioRef = useRef<Float32Array | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const sourceLanguageRef = useRef(sourceLanguage);
  const onTranscriptRef = useRef(onTranscript);
  const disabledRef = useRef(disabled);
  const tutorSpeakingRef = useRef(tutorSpeaking);
  const mountedRef = useRef(false);
  const shouldListenRef = useRef(false);
  const analysisQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentTurnStatsRef = useRef<VoiceTurnStats>(createEmptyVoiceTurnStats());

  const [listening, setListening] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");

  function clearIncompleteTurnTimer() {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearIncompleteTurnTimer();
      void vadRef.current?.destroy();
      vadRef.current = null;
    };
  }, []);

  useEffect(() => {
    sourceLanguageRef.current = sourceLanguage;
  }, [sourceLanguage]);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    disabledRef.current = disabled;
    tutorSpeakingRef.current = tutorSpeaking;
  }, [disabled, tutorSpeaking]);

  useEffect(() => {
    if (!listening || !vadRef.current) {
      return;
    }

    if (disabled || tutorSpeaking) {
      void vadRef.current.pause();
      return;
    }

    void vadRef.current.start();
  }, [disabled, listening, tutorSpeaking]);

  async function startHandsFreeListening() {
    if (disabled) {
      return;
    }

    try {
      // Check for secure context (HTTPS or localhost) — browsers block
      // microphone access on insecure (HTTP) contexts, causing silent hang.
      if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        throw new Error(
          "Microphone requires HTTPS or localhost. Your current connection is HTTP. " +
          "Voice features are unavailable on this deployment URL."
        );
      }

      setStatus("Starting mic...");
      shouldListenRef.current = true;

      if (!vadRef.current) {
        const { MicVAD } = await import("@ricky0123/vad-web");

        vadRef.current = await MicVAD.new({
          model: "v5",
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 450,
          preSpeechPadMs: 200,
          minSpeechMs: 250,
          submitUserSpeechOnPause: false,
          startOnLoad: false,
          processorType: "auto",
          getStream: () =>
            Promise.race([
              navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            }),
              new Promise<MediaStream>((_resolve, reject) =>
                setTimeout(() => reject(new Error("Microphone permission timed out (10s). Ensure HTTPS or allow mic access.")), 10000)
              )
            ]),
          ortConfig: (ort) => {
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.wasmPaths = "/vad/";
          },
          onSpeechStart: () => {
            clearIncompleteTurnTimer();
            setUserSpeaking(true);
            setStatus("Listening");
          },
          onSpeechRealStart: () => {
            setUserSpeaking(true);
            setStatus("Listening");
          },
          onSpeechEnd: (audio) => {
            queueSpeechEnd(audio);
          },
          onVADMisfire: () => {
            setUserSpeaking(false);
            if (shouldListenRef.current) {
              setStatus("Listening");
            }
          },
          onFrameProcessed: () => undefined
        });
      }

      await vadRef.current.start();
      setListening(true);
      setStatus("Listening");
    } catch (error) {
      shouldListenRef.current = false;
      setListening(false);
      setUserSpeaking(false);
      setStatus(error instanceof Error ? error.message : "Microphone unavailable");
    }
  }

  async function stopHandsFreeListening() {
    shouldListenRef.current = false;
    clearIncompleteTurnTimer();
    pendingTurnAudioRef.current = null;
    currentTurnStatsRef.current = createEmptyVoiceTurnStats();

    try {
      await vadRef.current?.destroy();
    } finally {
      vadRef.current = null;
      setListening(false);
      setUserSpeaking(false);
      setProcessing(false);
      setStatus("");
    }
  }

  function queueSpeechEnd(audio: Float32Array) {
    analysisQueueRef.current = analysisQueueRef.current
      .then(() => handleSpeechEnd(audio))
      .catch((error) => {
        if (mountedRef.current) {
          setStatus(error instanceof Error ? error.message : "Voice processing failed");
        }
      });
  }

  async function handleSpeechEnd(audio: Float32Array) {
    setUserSpeaking(false);

    if (!shouldListenRef.current || disabledRef.current || tutorSpeakingRef.current) {
      return;
    }

    const isNewTurn = pendingTurnAudioRef.current === null;

    if (isNewTurn) {
      currentTurnStatsRef.current = createEmptyVoiceTurnStats();
    }

    const currentTurnAudio = concatAudio(pendingTurnAudioRef.current, audio);
    pendingTurnAudioRef.current = currentTurnAudio;
    currentTurnStatsRef.current.speechSegmentCount += 1;
    currentTurnStatsRef.current.answerAudioDurationMs = getAudioDurationMs(currentTurnAudio);
    setProcessing(true);
    setStatus("Checking turn...");

    try {
      const turn = await analyzeTurn(currentTurnAudio);
      currentTurnStatsRef.current.smartTurnProbability = turn.probability;
      currentTurnStatsRef.current.smartTurnSource = turn.source;

      if (!mountedRef.current || !shouldListenRef.current) {
        return;
      }

      if (!turn.complete) {
        currentTurnStatsRef.current.incompleteTurnCount += 1;
        setProcessing(false);
        setStatus("Listening");
        scheduleIncompleteTurnFallback();
        return;
      }

      const finalAudio = pendingTurnAudioRef.current;
      pendingTurnAudioRef.current = null;
      clearIncompleteTurnTimer();

      if (finalAudio) {
        const voiceTurnStats = captureVoiceTurnStats(finalAudio, false);

        try {
          await transcribeAudio(finalAudio, voiceTurnStats);
        } finally {
          currentTurnStatsRef.current = createEmptyVoiceTurnStats();
        }
      }
    } finally {
      if (mountedRef.current) {
        setProcessing(false);
      }
    }
  }

  async function analyzeTurn(audio: Float32Array) {
    const audioWindow =
      audio.length > SAMPLE_RATE * SMART_TURN_AUDIO_WINDOW_SECONDS
        ? audio.slice(-SAMPLE_RATE * SMART_TURN_AUDIO_WINDOW_SECONDS)
        : audio;

    const response = await fetch("/api/speech/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioPcm16Base64: float32ToPcm16Base64(audioWindow),
        sampleRate: SAMPLE_RATE,
        durationMs: Math.round((audioWindow.length / SAMPLE_RATE) * 1000)
      })
    });

    const data = (await response.json().catch(() => null)) as TurnAnalysisResponse | null;

    if (!response.ok) {
      throw new Error(data?.reason || "Turn detection failed");
    }

    if (!data || typeof data.complete !== "boolean") {
      throw new Error("Turn detection returned an invalid response");
    }

    return data;
  }

  async function transcribeAudio(audio: Float32Array, voiceTurnStats: VoiceTurnStats) {
    if (audio.length < SAMPLE_RATE * 0.2) {
      setStatus("Listening");
      return;
    }

    setStatus("Transcribing...");

    const blob = new Blob([encodeWav(audio)], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("audio", blob, "question.wav");
    formData.append("language", sourceLanguageRef.current);

    const response = await fetch("/api/speech/transcribe", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.details || data.error || "Transcription failed");
    }

    const transcript = typeof data.text === "string" ? data.text.trim() : "";

    if (transcript) {
      const voiceInteractionSignals = buildVoiceInteractionSignals(transcript, voiceTurnStats);
      logVoiceInteractionSignals(voiceInteractionSignals);
      onTranscriptRef.current(transcript, voiceInteractionSignals);
      setStatus("Submitted");
      return;
    }

    setStatus("No speech detected");
  }

  function scheduleIncompleteTurnFallback() {
    clearIncompleteTurnTimer();

    fallbackTimerRef.current = window.setTimeout(() => {
      const audio = pendingTurnAudioRef.current;
      pendingTurnAudioRef.current = null;

      if (audio && shouldListenRef.current && !disabledRef.current && !tutorSpeakingRef.current) {
        const voiceTurnStats = captureVoiceTurnStats(audio, true);

        void transcribeAudio(audio, voiceTurnStats)
          .catch((error) => {
            if (mountedRef.current) {
              setStatus(error instanceof Error ? error.message : "Transcription failed");
            }
          })
          .finally(() => {
            currentTurnStatsRef.current = createEmptyVoiceTurnStats();
          });
      }
    }, INCOMPLETE_TURN_SILENCE_FALLBACK_MS);
  }

  function captureVoiceTurnStats(audio: Float32Array, forcedAfterLongSilence: boolean): VoiceTurnStats {
    const stats = currentTurnStatsRef.current;

    return {
      ...stats,
      forcedAfterLongSilence,
      speechSegmentCount: Math.max(1, stats.speechSegmentCount),
      answerAudioDurationMs: getAudioDurationMs(audio)
    };
  }

  const visibleStatus = waitingForResponse
    ? "Preparing response..."
    : listening && tutorSpeaking
      ? "Paused while tutor speaks"
      : listening && disabled
        ? "Paused"
        : status;
  const loading = waitingForResponse || processing || (listening && disabled && !tutorSpeaking);
  const active = !loading && ((listening && !disabled && !tutorSpeaking) || userSpeaking);
  const buttonLabel = loading
    ? "Tutor is preparing a response"
    : listening
      ? "Stop hands-free voice"
      : "Start hands-free voice";

  return (
    <div className="voice-control">
      <button
        className={`mic-button ${active ? "recording" : ""} ${loading ? "loading" : ""}`}
        type="button"
        onClick={listening ? () => void stopHandsFreeListening() : () => void startHandsFreeListening()}
        disabled={!listening && disabled}
        title={buttonLabel}
        aria-label={buttonLabel}
      >
        {loading ? (
          <span className="mic-loading-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        ) : listening ? (
          <Square size={16} aria-hidden />
        ) : (
          <Mic size={18} aria-hidden />
        )}
        <span className="sr-only">{buttonLabel}</span>
      </button>
      {visibleStatus && (
        <span className={`mic-status ${active ? "recording" : ""} ${loading ? "loading" : ""}`}>
          {visibleStatus}
        </span>
      )}
    </div>
  );
}

function createEmptyVoiceTurnStats(): VoiceTurnStats {
  return {
    smartTurnProbability: null,
    smartTurnSource: null,
    incompleteTurnCount: 0,
    forcedAfterLongSilence: false,
    speechSegmentCount: 0,
    answerAudioDurationMs: 0
  };
}

function getAudioDurationMs(audio: Float32Array) {
  return Math.round((audio.length / SAMPLE_RATE) * 1000);
}

function buildVoiceInteractionSignals(transcript: string, stats: VoiceTurnStats): VoiceInteractionSignals {
  const trimmedTranscript = transcript.trim();
  const uncertaintyMarkers = getUncertaintyMarkers(trimmedTranscript);
  const transcriptWordCount = countTranscriptWords(trimmedTranscript);
  const transcriptCharacterCount = Array.from(trimmedTranscript.replace(/\s+/g, "")).length;
  const isNumericAnswer = isNumericAnswerTranscript(trimmedTranscript);

  return {
    inputMode: "voice",
    smartTurnProbability: stats.smartTurnProbability,
    smartTurnSource: stats.smartTurnSource,
    incompleteTurnCount: stats.incompleteTurnCount,
    forcedAfterLongSilence: stats.forcedAfterLongSilence,
    speechSegmentCount: stats.speechSegmentCount,
    answerAudioDurationMs: stats.answerAudioDurationMs,
    transcriptWordCount,
    transcriptCharacterCount,
    transcriptHasUncertaintyMarkers: uncertaintyMarkers.length > 0,
    uncertaintyMarkers,
    isShortAnswer: transcriptWordCount <= 2 && transcriptCharacterCount <= 24,
    isNumericAnswer
  };
}

function getUncertaintyMarkers(transcript: string) {
  const markerPatterns: Array<[string, RegExp]> = [
    ["filled pause", /\b(?:um+|uh+|erm|hmm+)\b/i],
    ["not sure", /\b(?:not sure|unsure)\b/i],
    ["do not know", /\b(?:i\s+do\s+not\s+know|i\s+don't\s+know|i\s+dont\s+know|no idea)\b/i],
    ["maybe", /\bmaybe\b/i],
    ["tentative phrasing", /\b(?:i think|i guess)\b/i]
  ];

  return markerPatterns.filter(([, pattern]) => pattern.test(transcript)).map(([marker]) => marker);
}

function countTranscriptWords(transcript: string) {
  const tokens = transcript.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
  return tokens.length > 0 ? tokens.length : transcript.trim() ? 1 : 0;
}

function isNumericAnswerTranscript(transcript: string) {
  const compact = transcript.trim().replace(/[!?]/g, "");

  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(compact)) {
    return true;
  }

  const normalized = compact.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  const numberWords = new Set([
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty"
  ]);

  return numberWords.has(normalized);
}

function logVoiceInteractionSignals(signals: VoiceInteractionSignals) {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[Phloem voice signals]", signals);
  }
}

function concatAudio(previous: Float32Array | null, next: Float32Array) {
  if (!previous || previous.length === 0) {
    return next;
  }

  const combined = new Float32Array(previous.length + next.length);
  combined.set(previous, 0);
  combined.set(next, previous.length);
  return combined;
}

function float32ToPcm16Base64(audio: Float32Array) {
  return arrayBufferToBase64(float32ToPcm16(audio).buffer);
}

function float32ToPcm16(audio: Float32Array) {
  const pcm = new Int16Array(audio.length);

  for (let index = 0; index < audio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, audio[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return pcm;
}

function arrayBufferToBase64(buffer: ArrayBufferLike) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function encodeWav(audio: Float32Array) {
  const pcm = float32ToPcm16(audio);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);

  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(44 + index * 2, pcm[index] ?? 0, true);
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
