"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Headphones,
  HelpCircle,
  House,
  LayoutDashboard,
  Leaf,
  MessageSquare,
  MoreVertical,
  PlayCircle,
  PlusSquare,
  Settings,
  Share2,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { CameraCapture, type CapturedInput } from "@/components/CameraCapture";
import { ConversationPanel } from "@/components/ConversationPanel";
import type { SpeechTraceState } from "@/components/ConversationPanel";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { renderPdfPageImages } from "@/lib/documents/renderPdfPages";
import {
  getSpeechTraceParts,
  buildSpeechTraceWordEndTimesMs,
  getSpeechTraceWordIndex,
  getSpeechTraceWordIndexAtChar,
  getSpeechTraceWordIndexFromStartTimes,
  getSpeechTraceWordWeights,
  getSpeechTraceWords,
  type SpeechTimingPoint
} from "@/lib/speech/trace";
import type {
  ConversationMessage,
  LearnerProfile,
  LearningCheckEvaluation,
  LearningCheckStatus,
  LearningContext,
  SessionMemory,
  TutorResponse,
  UnderstandingLevel,
  VoiceInteractionSignals
} from "@/lib/tutor/types";
import {
  createEmptySessionMemory,
  createLearnerProfile,
  normalizeLearnerProfile,
  normalizeSessionMemory
} from "@/lib/tutor/memory";
import {
  getConceptMasteryKey,
  getLearningCheckNextReviewAt,
  isScoredLearningCheckStatus,
  updateConceptMasteryForResult,
  type ConceptMastery
} from "@/lib/tutor/mastery";

// Re-exported for use by StepIndicator
export type SessionPhase = "capture" | "review" | "learn";
type TtsVoiceStyle = "male" | "female";

type HealthResponse = {
  ok: boolean;
  llmProvider: string;
  ttsProvider: string;
  supabaseConfigured?: boolean;
  missingKeys: string[];
};

type CapturedMaterial = {
  id: string;
  name: string;
  mimeType: string;
  imageDataUrl: string | null;
  learningContext: LearningContext;
  createdAt: number;
};

type PendingMaterial = CapturedInput & {
  id: string;
};

type SaveSessionRequest = {
  title: string;
  targetLanguage: string;
  sourceLanguage: string;
  sessionMemory?: SessionMemory;
  learnerProfile?: LearnerProfile;
  materials: Array<{
    id: string;
    name: string;
    mimeType: string;
    dataUrl?: string;
    learningContext: LearningContext;
  }>;
};

type SaveSessionResponse = {
  persisted: boolean;
  sessionId: string | null;
  reason?: string;
};

type SaveLearningCheckResponse = {
  persisted: boolean;
  checkId?: string;
  mastery?: ConceptMastery | null;
  masteryPersisted?: boolean;
  reason?: string;
};

type SavedSessionSummary = {
  id: string;
  title: string;
  targetLanguage: string;
  sourceLanguage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  materialCount: number;
  messageCount: number;
};

type SavedMaterial = {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  viewUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
  learningContext: LearningContext;
  session: {
    id: string;
    title: string;
    targetLanguage: string;
    sourceLanguage: string;
    updatedAt: string;
  } | null;
};

type LoadedSessionResponse = {
  session: {
    id: string;
    title: string;
    targetLanguage: string;
    sourceLanguage: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  materials: Array<{
    id: string;
    name: string;
    mimeType: string;
    imageDataUrl: string | null;
    learningContext: LearningContext;
    createdAt: string;
  }>;
  messages: ConversationMessage[];
  sessionMemory?: SessionMemory;
  learnerProfile?: LearnerProfile;
  learningChecks?: LearningCheck[];
  conceptMasteries?: ConceptMastery[];
};

type TtsUsageResponse = {
  provider: "browser" | "google" | "openai";
  month: string;
  characters: number;
  requests: number;
  freeTierCharacters: number;
  remainingFreeTierCharacters: number;
  usagePercent: number;
  persisted: boolean;
  updatedAt: string | null;
  error?: string;
};

type LearningCheckUiStatus = LearningCheckStatus | "unanswered" | "checking";

type LearningCheck = {
  id: string;
  materialId: string | null;
  materialName: string;
  concept: string;
  question: string;
  answer: string;
  status: LearningCheckUiStatus;
  feedback: string;
  confidence: number | null;
  createdAt: string;
  answeredAt: string | null;
  nextReviewAt: string | null;
};

type ActiveLearningCheck = LearningCheck & {
  status: "unanswered" | "checking";
};

type EvaluatedLearningCheck = {
  check: LearningCheck & { status: LearningCheckStatus };
  evaluation: LearningCheckEvaluation;
};

type SubmitQuestionOptions = {
  skipLearningCheck?: boolean;
  voiceInteractionSignals?: VoiceInteractionSignals | null;
};

type SessionProgressCache = {
  sessionId: string;
  learningChecks: LearningCheck[];
  conceptMasteries: ConceptMastery[];
  savedAt: string;
};

const DEFAULT_TTS_SPEECH_RATE = 1;
const MIN_TTS_SPEECH_RATE = 0.75;
const MAX_TTS_SPEECH_RATE = 1.5;
const LAST_SESSION_STORAGE_KEY = "phloem:last-session-id";
const LISTEN_MODE_STORAGE_KEY = "phloem:listen-mode";
const LISTEN_TEXT_SIZE_STORAGE_KEY = "phloem:listen-text-size-step";
const MAX_LISTEN_TEXT_SIZE_STEP = 3;
const SESSION_PROGRESS_STORAGE_PREFIX = "phloem:session-progress:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "Chinese" },
  { value: "es", label: "Spanish" },
  { value: "hi", label: "Hindi" },
  { value: "ms", label: "Malay" }
];

const LANGUAGE_LABELS: Record<string, string> = {
  auto: "Auto detect",
  en: "English",
  "en-us": "English",
  "en-gb": "English",
  zh: "Chinese",
  "zh-cn": "Chinese",
  "zh-hans": "Chinese",
  "zh-tw": "Chinese",
  "zh-hant": "Chinese",
  es: "Spanish",
  hi: "Hindi",
  ms: "Malay",
  id: "Indonesian",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  ur: "Urdu",
  vi: "Vietnamese",
  th: "Thai"
};

const sampleLearningContext: LearningContext = {
  detectedLanguage: "English",
  topic: "Photosynthesis",
  summary:
    "The material explains how plants use sunlight, carbon dioxide, and water to make glucose and oxygen.",
  diagramNotes:
    "A typical diagram would show sunlight entering a leaf, carbon dioxide coming in, water coming from roots, and oxygen leaving.",
  extractedText:
    "Photosynthesis is the process by which green plants make their own food. Plants use sunlight, carbon dioxide from the air, and water from the soil to produce glucose and oxygen.",
  suggestedQuestion: "What are the three things a plant needs to begin photosynthesis?",
  confidence: 0.92
};

function makeMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

function isPdfMaterial(material: Pick<CapturedInput, "mimeType" | "name">) {
  return material.mimeType === "application/pdf" || /\.pdf$/i.test(material.name);
}

function readLastSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
    return value && UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberLastSessionId(nextSessionId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (nextSessionId) {
      window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, nextSessionId);
    } else {
      window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in private or restricted browser modes.
  }
}

function getSessionProgressStorageKey(nextSessionId: string) {
  return `${SESSION_PROGRESS_STORAGE_PREFIX}${nextSessionId}`;
}

function readSessionProgressCache(nextSessionId: string): SessionProgressCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getSessionProgressStorageKey(nextSessionId));
    const parsed = raw ? (JSON.parse(raw) as Partial<SessionProgressCache>) : null;

    if (
      !parsed ||
      parsed.sessionId !== nextSessionId ||
      !Array.isArray(parsed.learningChecks) ||
      !Array.isArray(parsed.conceptMasteries)
    ) {
      return null;
    }

    return {
      sessionId: nextSessionId,
      learningChecks: parsed.learningChecks as LearningCheck[],
      conceptMasteries: parsed.conceptMasteries as ConceptMastery[],
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function writeSessionProgressCache(
  nextSessionId: string,
  learningChecks: LearningCheck[],
  conceptMasteries: ConceptMastery[]
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getSessionProgressStorageKey(nextSessionId),
      JSON.stringify({
        sessionId: nextSessionId,
        learningChecks: learningChecks.slice(0, 80),
        conceptMasteries: conceptMasteries.slice(0, 80),
        savedAt: new Date().toISOString()
      } satisfies SessionProgressCache)
    );
  } catch {
    // Ignore quota or storage permission errors. Supabase remains the source of truth.
  }
}

function clearSessionProgressCache(nextSessionId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(getSessionProgressStorageKey(nextSessionId));
  } catch {
    // Ignore storage permission errors.
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.details || data?.error || "Request failed";
    throw new Error(String(detail));
  }

  return data as T;
}

async function saveLearningSession(payload: SaveSessionRequest) {
  const result = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => readJsonResponse<SaveSessionResponse>(response));

  return result.persisted ? result.sessionId : null;
}

async function saveConversationMessages(sessionId: string | null, messages: ConversationMessage[]) {
  if (!sessionId || messages.length === 0) {
    return;
  }

  await fetch("/api/sessions/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messages })
  }).then((response) => readJsonResponse<{ persisted: boolean }>(response));
}

async function updateConversationMessageRequest(
  sessionId: string | null,
  messageId: string | undefined,
  content: string
) {
  if (!sessionId || !messageId || !content.trim()) {
    return;
  }

  await fetch("/api/sessions/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messageId, content })
  }).then((response) => readJsonResponse<{ persisted: boolean }>(response));
}

async function deleteSavedSessionRequest(sessionId: string) {
  await fetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  }).then((response) => readJsonResponse<{ deleted: boolean; sessionId: string }>(response));
}

async function deleteSavedMaterialRequest(materialId: string) {
  await fetch(`/api/materials/${materialId}`, {
    method: "DELETE"
  }).then((response) =>
    readJsonResponse<{ deleted: boolean; materialId: string; sessionId: string }>(response)
  );
}

async function saveLearningCheckRequest(sessionId: string | null, check: LearningCheck) {
  if (!sessionId) {
    return null;
  }

  return fetch("/api/progress/checks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, check })
  }).then((response) => readJsonResponse<SaveLearningCheckResponse>(response));
}

async function deleteLearningCheckRequest(sessionId: string | null, checkId: string) {
  if (!sessionId) {
    return;
  }

  await fetch("/api/progress/checks", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, checkId })
  }).then((response) => readJsonResponse<{ persisted: boolean; deleted: boolean }>(response));
}

async function loadTtsUsageRequest() {
  return fetch("/api/usage/tts").then((response) => readJsonResponse<TtsUsageResponse>(response));
}

async function evaluateLearningCheckRequest(payload: {
  learningContext: LearningContext | null;
  retrievalQuestion: string;
  learnerAnswer: string;
  targetLanguage: string;
  voiceInteractionSignals?: VoiceInteractionSignals | null;
}) {
  return fetch("/api/tutor/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => readJsonResponse<LearningCheckEvaluation>(response));
}

function clampTtsSpeechRate(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TTS_SPEECH_RATE;
  }

  return Math.min(MAX_TTS_SPEECH_RATE, Math.max(MIN_TTS_SPEECH_RATE, value));
}

function clampListenTextSizeStep(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_LISTEN_TEXT_SIZE_STEP, Math.max(0, Math.floor(value)));
}

function scaleSpeechTimings(timings: SpeechTimingPoint[] | undefined, speechRate: number) {
  if (!timings || timings.length === 0 || speechRate === 1) {
    return timings;
  }

  return timings.map((timing) => ({
    ...timing,
    timeMs: timing.timeMs / speechRate
  }));
}

function getLearningCheckStatusLabel(status: LearningCheckUiStatus) {
  switch (status) {
    case "got-it":
      return "Got it";
    case "needs-practice":
      return "Needs practice";
    case "confused":
      return "Confused";
    case "checking":
      return "Checking";
    case "unanswered":
    default:
      return "Awaiting answer";
  }
}

function titleCaseLanguageName(value: string) {
  return value
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getLanguageDisplayName(value: string | null | undefined) {
  const language = value?.trim();

  if (!language) {
    return "Unknown";
  }

  const normalized = language.toLowerCase();
  const knownLabel = LANGUAGE_LABELS[normalized];

  if (knownLabel) {
    return knownLabel;
  }

  try {
    const locale = typeof navigator === "undefined" ? "en" : navigator.language || "en";
    const displayName = new Intl.DisplayNames([locale], { type: "language" }).of(language);

    if (displayName) {
      return titleCaseLanguageName(displayName);
    }
  } catch {
    // Fall through to the original value when the browser cannot parse the language code.
  }

  return language;
}

export default function Home() {
  // --- Core state ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingMaterials, setPendingMaterials] = useState<PendingMaterial[]>([]);
  const [materials, setMaterials] = useState<CapturedMaterial[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessionMemory, setSessionMemory] = useState<SessionMemory>(() => createEmptySessionMemory());
  const [learningChecks, setLearningChecks] = useState<LearningCheck[]>([]);
  const [conceptMasteries, setConceptMasteries] = useState<ConceptMastery[]>([]);
  const learningChecksRef = useRef<LearningCheck[]>([]);
  const [activeLearningCheckId, setActiveLearningCheckId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const autoRestoreAttemptedRef = useRef(false);
  const listenModeStorageReadyRef = useRef(false);
  const tutorAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const activeAudioContextRef = useRef<AudioContext | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechTraceTimerRef = useRef<number | null>(null);
  const speechTraceSessionRef = useRef<{
    messageId: string;
    totalWords: number;
    startedAt: number;
    durationMs: number;
    wordWeights: number[];
    wordEndTimesMs: number[];
    wordStartTimesMs: number[] | null;
  } | null>(null);

  // --- Session phase ---
  const [phase, setPhase] = useState<SessionPhase>("capture");

  // --- Settings ---
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [ttsVoiceStyle, setTtsVoiceStyle] = useState<TtsVoiceStyle>("male");
  const [ttsSpeechRate, setTtsSpeechRate] = useState(DEFAULT_TTS_SPEECH_RATE);
  const [understandingLevel, setUnderstandingLevel] = useState<UnderstandingLevel>("medium");
  const [allowDirectAnswer, setAllowDirectAnswer] = useState(false);
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile>(() =>
    createLearnerProfile({
      targetLanguage: "en",
      sourceLanguage: "auto",
      understandingLevel: "medium"
    })
  );

  // --- UI state ---
  const [busy, setBusy] = useState(false);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [tutorStopped, setTutorStopped] = useState(false);
  const [tutorSpeaking, setTutorSpeaking] = useState(false);
  const [speechTrace, setSpeechTrace] = useState<SpeechTraceState | null>(null);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedSessionSummary[]>([]);
  const [savedMaterials, setSavedMaterials] = useState<SavedMaterial[]>([]);
  const [ttsUsage, setTtsUsage] = useState<TtsUsageResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [ttsUsageLoading, setTtsUsageLoading] = useState(false);
  const [ttsUsageError, setTtsUsageError] = useState("");
  const [listenMode, setListenMode] = useState(false);
  const [listenTextSizeStep, setListenTextSizeStep] = useState(0);

  // Settings view state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);

  // Derived values
  const lastAssistantMessage = useMemo(
    () => messages.filter((message) => message.role === "assistant").at(-1),
    [messages]
  );
  const selectedMaterial = useMemo(
    () => materials.find((material) => material.id === selectedMaterialId) ?? materials.at(-1) ?? null,
    [materials, selectedMaterialId]
  );
  const learningContext = selectedMaterial?.learningContext ?? null;
  const effectiveLearnerProfile = useMemo(
    () => ({
      ...normalizeLearnerProfile(
        learnerProfile,
        createLearnerProfile({
          targetLanguage,
          sourceLanguage,
          understandingLevel
        })
      ),
      preferredLanguage: targetLanguage,
      sourceLanguage,
      readingLevel:
        understandingLevel === "low" ? "beginner" : understandingLevel === "high" ? "advanced" : "intermediate"
    }),
    [learnerProfile, sourceLanguage, targetLanguage, understandingLevel]
  );
  const activeLearningCheck = useMemo(
    () =>
      learningChecks.find(
        (check): check is ActiveLearningCheck => check.id === activeLearningCheckId && isActiveLearningCheck(check)
      ) ?? null,
    [activeLearningCheckId, learningChecks]
  );

  // Health check on mount
  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (listenModeStorageReadyRef.current) {
        return;
      }

      try {
        listenModeStorageReadyRef.current = true;
        setListenMode(window.localStorage.getItem(LISTEN_MODE_STORAGE_KEY) === "1");
        setListenTextSizeStep(
          clampListenTextSizeStep(Number(window.localStorage.getItem(LISTEN_TEXT_SIZE_STORAGE_KEY) ?? 0))
        );
      } catch {
        listenModeStorageReadyRef.current = true;
        setListenMode(false);
        setListenTextSizeStep(0);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!listenModeStorageReadyRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(LISTEN_MODE_STORAGE_KEY, listenMode ? "1" : "0");
    } catch {
      // localStorage can be unavailable in private or restricted browser modes.
    }
  }, [listenMode]);

  useEffect(() => {
    if (!listenModeStorageReadyRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(LISTEN_TEXT_SIZE_STORAGE_KEY, String(listenTextSizeStep));
    } catch {
      // localStorage can be unavailable in private or restricted browser modes.
    }
  }, [listenTextSizeStep]);

  useEffect(() => {
    return () => {
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
      if (activeAudioContextRef.current) {
        void activeAudioContextRef.current.close().catch(() => undefined);
        activeAudioContextRef.current = null;
      }
      clearSpeechTrace();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    learningChecksRef.current = learningChecks;
  }, [learningChecks]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    rememberLastSessionId(sessionId);
    writeSessionProgressCache(sessionId, learningChecks, conceptMasteries);
  }, [conceptMasteries, learningChecks, sessionId]);

  useEffect(() => {
    if (autoRestoreAttemptedRef.current) {
      return;
    }

    autoRestoreAttemptedRef.current = true;
    const lastSessionId = readLastSessionId();

    if (lastSessionId) {
      void handleLoadSession(lastSessionId, { restoreOnFailure: true });
    }
    // This should only run once on mount so refresh can resume the last saved session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMaterialReady(material: CapturedInput) {
    setError("");
    setStatus("Material added");
    setPendingMaterials((current) => [
      ...current,
      {
        ...material,
        id: crypto.randomUUID()
      }
    ]);
  }

  function handleRemovePendingMaterial(materialId: string) {
    setPendingMaterials((current) => current.filter((material) => material.id !== materialId));
  }

  async function loadSavedSessions() {
    setSessionsLoading(true);
    setSessionsError("");

    try {
      const data = await fetch("/api/sessions").then((response) =>
        readJsonResponse<{ sessions: SavedSessionSummary[]; persisted: boolean }>(response)
      );
      setSavedSessions(data.sessions);
    } catch (nextError) {
      setSessionsError(nextError instanceof Error ? nextError.message : "Saved sessions could not be loaded.");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function loadSavedMaterials() {
    setMaterialsLoading(true);
    setMaterialsError("");

    try {
      const data = await fetch("/api/materials").then((response) =>
        readJsonResponse<{ materials: SavedMaterial[]; persisted: boolean }>(response)
      );
      setSavedMaterials(data.materials);
    } catch (nextError) {
      setMaterialsError(nextError instanceof Error ? nextError.message : "Saved materials could not be loaded.");
    } finally {
      setMaterialsLoading(false);
    }
  }

  async function loadTtsUsage() {
    setTtsUsageLoading(true);
    setTtsUsageError("");

    try {
      const data = await loadTtsUsageRequest();
      setTtsUsage(data);

      if (data.error) {
        setTtsUsageError(data.error);
      }
    } catch (nextError) {
      setTtsUsageError(nextError instanceof Error ? nextError.message : "TTS usage could not be loaded.");
    } finally {
      setTtsUsageLoading(false);
    }
  }

  function handleOpenLearn() {
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
  }

  function handleOpenSettings() {
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
    setSettingsOpen(true);
    void loadTtsUsage();
  }

  function handleOpenSessions() {
    setSettingsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
    setSessionsOpen(true);
    void loadSavedSessions();
  }

  function handleOpenMaterials() {
    setSettingsOpen(false);
    setSessionsOpen(false);
    setProgressOpen(false);
    setMaterialsOpen(true);
    void loadSavedMaterials();
  }

  function handleOpenProgress() {
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(true);
  }

  function handleOpenListenMode() {
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
    listenModeStorageReadyRef.current = true;
    setListenMode(true);
  }

  function handleCloseListenMode() {
    listenModeStorageReadyRef.current = true;
    setListenMode(false);
  }

  async function handleDeleteSession(nextSessionId: string) {
    const session = savedSessions.find((item) => item.id === nextSessionId);
    const confirmed = window.confirm(
      `Delete "${session?.title || "this session"}"? This also removes its saved materials and messages.`
    );

    if (!confirmed) {
      return;
    }

    setSessionsError("");
    setStatus("Deleting session...");

    try {
      await deleteSavedSessionRequest(nextSessionId);
      clearSessionProgressCache(nextSessionId);
      if (readLastSessionId() === nextSessionId) {
        rememberLastSessionId(null);
      }
      setSavedSessions((current) => current.filter((item) => item.id !== nextSessionId));
      setSavedMaterials((current) => current.filter((item) => item.sessionId !== nextSessionId));

      if (sessionId === nextSessionId) {
        handleNewSession();
        return;
      }

      setStatus("Session deleted");
    } catch (nextError) {
      setSessionsError(nextError instanceof Error ? nextError.message : "Saved session could not be deleted.");
      setStatus("Session delete failed");
    }
  }

  async function handleDeleteMaterial(materialId: string) {
    const material = savedMaterials.find((item) => item.id === materialId);
    const confirmed = window.confirm(`Delete "${material?.name || "this material"}"? This removes the saved file.`);

    if (!confirmed) {
      return;
    }

    setMaterialsError("");
    setStatus("Deleting material...");

    try {
      await deleteSavedMaterialRequest(materialId);
      setSavedMaterials((current) => current.filter((item) => item.id !== materialId));

      const nextCurrentMaterials = materials.filter((item) => item.id !== materialId);
      setMaterials(nextCurrentMaterials);

      if (selectedMaterialId === materialId) {
        setSelectedMaterialId(nextCurrentMaterials[0]?.id ?? null);
      }

      setStatus("Material deleted");
    } catch (nextError) {
      setMaterialsError(nextError instanceof Error ? nextError.message : "Saved material could not be deleted.");
      setStatus("Material delete failed");
    }
  }

  async function handleLoadSession(nextSessionId: string, options?: { restoreOnFailure?: boolean }) {
    setBusy(true);
    setError("");
    setSessionsError("");
    setTutorStopped(false);
    setStatus("Loading saved session...");

    try {
      const data = await fetch(`/api/sessions/${nextSessionId}`).then((response) =>
        readJsonResponse<LoadedSessionResponse>(response)
      );

      const loadedMaterials: CapturedMaterial[] = data.materials.map((material) => ({
        id: material.id,
        name: material.name,
        mimeType: material.mimeType,
        imageDataUrl: material.imageDataUrl,
        learningContext: material.learningContext,
        createdAt: new Date(material.createdAt).getTime()
      }));

      setSessionId(data.session.id);
      setTargetLanguage(data.session.targetLanguage || "en");
      setSourceLanguage(data.session.sourceLanguage || "auto");
      setMaterials(loadedMaterials);
      setSelectedMaterialId(loadedMaterials[0]?.id ?? null);
      setMessages(data.messages);
      setSessionMemory(normalizeSessionMemory(data.sessionMemory));
      setLearnerProfile(
        normalizeLearnerProfile(
          data.learnerProfile,
          createLearnerProfile({
            targetLanguage: data.session.targetLanguage || "en",
            sourceLanguage: data.session.sourceLanguage || "auto",
            understandingLevel
          })
        )
      );
      const cachedProgress = readSessionProgressCache(data.session.id);
      const loadedLearningChecks = mergeLearningChecks(data.learningChecks ?? [], cachedProgress?.learningChecks ?? []);
      const restoredConceptMasteries =
        data.conceptMasteries?.length
          ? sortConceptMasteries(data.conceptMasteries)
          : buildConceptMasteriesFromChecks(loadedLearningChecks, data.session.id);
      setLearningChecks(loadedLearningChecks);
      setConceptMasteries(mergeConceptMasteries(restoredConceptMasteries, cachedProgress?.conceptMasteries ?? []));
      setActiveLearningCheckId(loadedLearningChecks.find(isActiveLearningCheck)?.id ?? null);
      setQuestion("");
      setPendingMaterials([]);
      setSettingsOpen(false);
      setSessionsOpen(false);
      setMaterialsOpen(false);
      setProgressOpen(false);
      setPhase("learn");
      setStatus("Saved session loaded");
    } catch (nextError) {
      if (options?.restoreOnFailure && readLastSessionId() === nextSessionId) {
        rememberLastSessionId(null);
      }

      setSessionsError(nextError instanceof Error ? nextError.message : "Saved session could not be loaded.");
      setStatus("Session load failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartSession() {
    if (pendingMaterials.length === 0) {
      setError("Add at least one image, PDF, or Word document first.");
      return;
    }

    const queuedMaterials = pendingMaterials;
    rememberLastSessionId(null);
    setBusy(true);
    setProcessingMaterials(true);
    setError("");
    setStatus(`Processing ${queuedMaterials.length} material${queuedMaterials.length === 1 ? "" : "s"}...`);

    try {
      const processedMaterials: CapturedMaterial[] = [];

      for (const material of queuedMaterials) {
        setStatus(`Processing ${material.name}...`);
        let pdfPageImageDataUrls: string[] = [];

        if (isPdfMaterial(material)) {
          try {
            setStatus(`Rendering PDF pages from ${material.name}...`);
            pdfPageImageDataUrls = await renderPdfPageImages(material.dataUrl);
          } catch {
            pdfPageImageDataUrls = [];
          }

          setStatus(`Processing ${material.name}...`);
        }

        const data = await fetch("/api/vision/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialDataUrl: material.dataUrl,
            imageDataUrl: material.mimeType.startsWith("image/") ? material.dataUrl : undefined,
            pdfPageImageDataUrls: pdfPageImageDataUrls.length > 0 ? pdfPageImageDataUrls : undefined,
            mimeType: material.mimeType,
            fileName: material.name,
            targetLanguage
          })
        }).then((response) => readJsonResponse<{ learningContext: LearningContext }>(response));

        processedMaterials.push({
          id: material.id,
          name: material.name,
          mimeType: material.mimeType,
          imageDataUrl: material.mimeType.startsWith("image/") ? material.dataUrl : null,
          learningContext: data.learningContext,
          createdAt: Date.now()
        });
      }

      let savedSessionId: string | null = null;
      const queuedById = new Map(queuedMaterials.map((material) => [material.id, material]));
      const nextSessionMemory = createEmptySessionMemory();
      const nextLearnerProfile = createLearnerProfile({
        targetLanguage,
        sourceLanguage,
        understandingLevel
      });

      try {
        setStatus("Saving session...");
        savedSessionId = await saveLearningSession({
          title: processedMaterials[0]?.learningContext.topic || "Learning session",
          targetLanguage,
          sourceLanguage,
          sessionMemory: nextSessionMemory,
          learnerProfile: nextLearnerProfile,
          materials: processedMaterials.map((material) => ({
            id: material.id,
            name: material.name,
            mimeType: material.mimeType,
            dataUrl: queuedById.get(material.id)?.dataUrl,
            learningContext: material.learningContext
          }))
        });
      } catch (saveError) {
        setError(
          `Learning session is ready, but it was not saved to Supabase: ${
            saveError instanceof Error ? saveError.message : "Save failed"
          }`
        );
      }

      setSessionId(savedSessionId);
      setMaterials((current) => [...current, ...processedMaterials]);
      setSelectedMaterialId(processedMaterials[0]?.id ?? null);
      setSessionMemory(nextSessionMemory);
      setLearnerProfile(nextLearnerProfile);
      setLearningChecks([]);
      setConceptMasteries([]);
      setActiveLearningCheckId(null);
      setMessages((current) => [
        ...current,
        makeMessage(
          "system",
          `${processedMaterials.length} material${processedMaterials.length === 1 ? "" : "s"} processed.`
        )
      ]);
      setPendingMaterials([]);
      setStatus("Learning context ready");
      setSettingsOpen(false);
      setSessionsOpen(false);
      setMaterialsOpen(false);
      setProgressOpen(false);
      setPhase("learn");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Material processing failed");
      setStatus("Material processing failed");
    } finally {
      setProcessingMaterials(false);
      setBusy(false);
    }
  }

  // ---- Sample mode ----
  function handleUseSample() {
    rememberLastSessionId(null);
    const nextSessionMemory = createEmptySessionMemory();
    const nextLearnerProfile = createLearnerProfile({
      targetLanguage,
      sourceLanguage,
      understandingLevel
    });
    const nextMaterial: CapturedMaterial = {
      id: crypto.randomUUID(),
      name: "Sample photosynthesis material",
      mimeType: "text/plain",
      imageDataUrl: null,
      learningContext: sampleLearningContext,
      createdAt: Date.now()
    };

    setPendingMaterials([]);
    setSessionId(null);
    setMaterials((current) => [...current, nextMaterial]);
    setSelectedMaterialId(nextMaterial.id);
    setSessionMemory(nextSessionMemory);
    setLearnerProfile(nextLearnerProfile);
    setLearningChecks([]);
    setConceptMasteries([]);
    setActiveLearningCheckId(null);
    setMessages((current) => [...current, makeMessage("system", "Sample photosynthesis material loaded.")]);
    setStatus("Sample context ready");
    setError("");
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
    setPhase("learn");

    void saveLearningSession({
      title: nextMaterial.learningContext.topic,
      targetLanguage,
      sourceLanguage,
      sessionMemory: nextSessionMemory,
      learnerProfile: nextLearnerProfile,
      materials: [
        {
          id: nextMaterial.id,
          name: nextMaterial.name,
          mimeType: nextMaterial.mimeType,
          learningContext: nextMaterial.learningContext
        }
      ]
    })
      .then((savedSessionId) => {
        setSessionId(savedSessionId);

        for (const check of learningChecksRef.current) {
          void saveLearningCheckRequest(savedSessionId, check)
            .then((result) => {
              const savedMastery = result?.mastery;

              if (savedMastery) {
                setConceptMasteries((current) => mergeConceptMastery(current, savedMastery));
              }
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }

  function handleNewSession() {
    rememberLastSessionId(null);
    tutorAbortRef.current?.abort();
    tutorAbortRef.current = null;
    stopTutorSpeech();
    setPendingMaterials([]);
    setSessionId(null);
    setTutorStopped(false);
    setMaterials([]);
    setSelectedMaterialId(null);
    setSessionMemory(createEmptySessionMemory());
    setLearnerProfile(
      createLearnerProfile({
        targetLanguage,
        sourceLanguage,
        understandingLevel
      })
    );
    setLearningChecks([]);
    setConceptMasteries([]);
    setActiveLearningCheckId(null);
    setMessages([]);
    setQuestion("");
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setProgressOpen(false);
    setPhase("capture");
    setError("");
    setStatus("Ready");
  }

  function handleStopTutorResponse() {
    setTutorStopped(true);
    tutorAbortRef.current?.abort();
    ttsAbortRef.current?.abort();
    stopTutorSpeech();
    setStatus("Tutor response stopped");
  }

  function createLearningCheck(retrievalQuestion: string) {
    const questionText = retrievalQuestion.trim();

    if (!questionText) {
      return;
    }

    const nextCheck: LearningCheck = {
      id: crypto.randomUUID(),
      materialId: selectedMaterial?.id ?? null,
      materialName: selectedMaterial?.name || "Current material",
      concept: learningContext?.topic || "Current concept",
      question: questionText,
      answer: "",
      status: "unanswered",
      feedback: "",
      confidence: null,
      createdAt: new Date().toISOString(),
      answeredAt: null,
      nextReviewAt: null
    };

    setLearningChecks((current) => [nextCheck, ...current]);
    setActiveLearningCheckId(nextCheck.id);
    void saveLearningCheckRequest(sessionId, nextCheck).catch(() => undefined);
  }

  function handleSkipActiveLearningCheck() {
    const checkId = activeLearningCheckId;

    if (!checkId) {
      return;
    }

    setLearningChecks((current) => current.filter((check) => check.id !== checkId));
    setActiveLearningCheckId(null);
    void deleteLearningCheckRequest(sessionId, checkId).catch(() => undefined);
  }

  function applyScoredLearningCheck(activeSessionId: string | null, check: LearningCheck & { status: LearningCheckStatus }) {
    setConceptMasteries((current) => updateConceptMasteriesFromCheck(current, check, activeSessionId));
    void saveLearningCheckRequest(activeSessionId, check)
      .then((result) => {
        const savedMastery = result?.mastery;

        if (savedMastery) {
          setConceptMasteries((current) => mergeConceptMastery(current, savedMastery));
        }
      })
      .catch(() => undefined);
  }

  async function evaluateActiveLearningCheck(
    check: LearningCheck,
    learnerAnswer: string,
    voiceInteractionSignals?: VoiceInteractionSignals | null
  ): Promise<EvaluatedLearningCheck> {
    const activeSessionId = sessionId;
    const checkingCheck: LearningCheck = {
      ...check,
      answer: learnerAnswer,
      status: "checking"
    };

    setLearningChecks((current) =>
      current.map((item) => (item.id === check.id ? checkingCheck : item))
    );

    try {
      const checkLearningContext =
        materials.find((material) => material.id === check.materialId)?.learningContext ?? learningContext;
      const evaluation = await evaluateLearningCheckRequest({
        learningContext: checkLearningContext,
        retrievalQuestion: check.question,
        learnerAnswer,
        targetLanguage,
        voiceInteractionSignals
      });

      const updatedCheck: LearningCheck & { status: LearningCheckStatus } = {
        ...checkingCheck,
        concept: evaluation.concept || checkingCheck.concept,
        status: evaluation.status,
        feedback: evaluation.feedback,
        confidence: evaluation.confidence,
        answeredAt: new Date().toISOString(),
        nextReviewAt: getLearningCheckNextReviewAt(evaluation.status)
      };

      setLearningChecks((current) =>
        current.map((item) => (item.id === check.id ? updatedCheck : item))
      );
      applyScoredLearningCheck(activeSessionId, updatedCheck);

      return {
        check: updatedCheck,
        evaluation
      };
    } catch {
      const fallbackEvaluation: LearningCheckEvaluation = {
        status: "needs-practice",
        concept: checkingCheck.concept,
        feedback: "Review this idea once more, then try another short answer.",
        confidence: 0.35,
        provider: "local"
      };
      const updatedCheck: LearningCheck & { status: LearningCheckStatus } = {
        ...checkingCheck,
        status: fallbackEvaluation.status,
        feedback: fallbackEvaluation.feedback,
        confidence: fallbackEvaluation.confidence,
        answeredAt: new Date().toISOString(),
        nextReviewAt: getLearningCheckNextReviewAt(fallbackEvaluation.status)
      };

      setLearningChecks((current) =>
        current.map((item) => (item.id === check.id ? updatedCheck : item))
      );
      applyScoredLearningCheck(activeSessionId, updatedCheck);

      return {
        check: updatedCheck,
        evaluation: fallbackEvaluation
      };
    } finally {
      setActiveLearningCheckId((current) => (current === check.id ? null : current));
    }
  }

  function handlePracticeConcept(concept: string) {
    setProgressOpen(false);
    setSettingsOpen(false);
    setSessionsOpen(false);
    setMaterialsOpen(false);
    setPhase(materials.length > 0 ? "learn" : "capture");

    if (materials.length > 0) {
      void submitQuestion(`Quiz me on ${concept}. Ask one short retrieval question and wait for my answer.`, {
        skipLearningCheck: true
      });
    }
  }

  function handleEditMessage(messageId: string, content: string) {
    const nextContent = content.trim();

    if (!nextContent) {
      return;
    }

    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, content: nextContent } : message))
    );
    void updateConversationMessageRequest(sessionId, messageId, nextContent).catch(() => undefined);
  }

  // ---- Question submission ----
  async function submitQuestion(forcedQuestion?: string, options?: SubmitQuestionOptions) {
    const text = (forcedQuestion ?? question).trim();

    if (!text) {
      return;
    }

    const voiceInteractionSignals = options?.voiceInteractionSignals ?? null;
    const checkToEvaluate =
      !options?.skipLearningCheck && activeLearningCheck?.status === "unanswered" ? activeLearningCheck : null;

    setError("");
    setTutorStopped(false);
    setBusy(true);
    setStatus("Tutor is thinking...");
    setQuestion("");

    const previousMessages = messages;
    const userMessage = makeMessage("user", text);
    const activeSessionId = sessionId;
    setMessages([...previousMessages, userMessage]);
    const controller = new AbortController();
    tutorAbortRef.current = controller;

    try {
      let evaluatedCheck: EvaluatedLearningCheck | null = null;

      if (checkToEvaluate) {
        setStatus("Checking your answer...");
        evaluatedCheck = await evaluateActiveLearningCheck(checkToEvaluate, text, voiceInteractionSignals);

        if (controller.signal.aborted) {
          setTutorStopped(true);
          setStatus("Tutor response stopped");
          return;
        }

        setStatus("Tutor is thinking...");
      }

      const tutorResponse = await fetch("/api/tutor/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          learningContext,
          messages: previousMessages,
          userMessage: text,
          targetLanguage,
          sourceLanguage,
          understandingLevel,
          allowDirectAnswer,
          sessionId: activeSessionId,
          materialId: selectedMaterial?.id ?? null,
          sessionMemory,
          learnerProfile: effectiveLearnerProfile,
          activeLearningCheck: evaluatedCheck
            ? {
                question: evaluatedCheck.check.question,
                concept: evaluatedCheck.check.concept
              }
            : null,
          learningCheckEvaluation: evaluatedCheck
            ? {
                learnerAnswer: text,
                status: evaluatedCheck.evaluation.status,
                concept: evaluatedCheck.evaluation.concept,
                feedback: evaluatedCheck.evaluation.feedback,
                confidence: evaluatedCheck.evaluation.confidence
              }
            : null,
          voiceInteractionSignals
        })
      }).then((response) => readJsonResponse<TutorResponse>(response));

      if (controller.signal.aborted) {
        setTutorStopped(true);
        setStatus("Tutor response stopped");
        return;
      }

      const assistantText = [tutorResponse.response, tutorResponse.followUpQuestion]
        .filter(Boolean)
        .join("\n\n");

      const assistantMessage = makeMessage("assistant", assistantText);
      setUnderstandingLevel(tutorResponse.understandingLevel);
      if (tutorResponse.sessionMemory) {
        setSessionMemory(normalizeSessionMemory(tutorResponse.sessionMemory));
      }
      setStatus("Preparing voice...");

      let assistantRevealed = false;
      let learningCheckCreated = false;
      const revealAssistant = () => {
        if (assistantRevealed) {
          return;
        }

        assistantRevealed = true;
        setMessages((current) => [...current, assistantMessage]);
        void saveConversationMessages(activeSessionId, [userMessage, assistantMessage]).catch(() => undefined);
      };
      const createLearningCheckAfterSpeech = () => {
        if (learningCheckCreated || !assistantRevealed || controller.signal.aborted) {
          return;
        }

        learningCheckCreated = true;
        createLearningCheck(tutorResponse.followUpQuestion);
      };

      const speechStarted = await speakText(assistantText, {
        onReadyToReveal: revealAssistant,
        onSpeechComplete: createLearningCheckAfterSpeech,
        traceMessageId: assistantMessage.id
      });

      if (!speechStarted && !controller.signal.aborted) {
        if (!assistantRevealed) {
          revealAssistant();
        }
        createLearningCheckAfterSpeech();
      }
    } catch (nextError) {
      if (
        (nextError instanceof Error && nextError.name === "AbortError") ||
        (typeof nextError === "object" && nextError !== null && "name" in nextError && nextError.name === "AbortError")
      ) {
        setTutorStopped(true);
        setStatus("Tutor response stopped");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Tutor request failed");
      setStatus("Tutor request failed");
    } finally {
      if (tutorAbortRef.current === controller) {
        tutorAbortRef.current = null;
      }
      setBusy(false);
    }
  }

  // ---- TTS ----
  function clearSpeechTrace() {
    if (speechTraceTimerRef.current !== null) {
      window.clearInterval(speechTraceTimerRef.current);
      speechTraceTimerRef.current = null;
    }

    speechTraceSessionRef.current = null;
    setSpeechTrace(null);
  }

  function startSpeechTrace(
    messageId: string | undefined,
    text: string,
    options?: { durationMs?: number; startedAt?: number; timings?: SpeechTimingPoint[]; manual?: boolean }
  ) {
    if (!messageId) {
      return;
    }

    clearSpeechTrace();
    const words = getSpeechTraceWords(text);
    const totalWords = words.length;

    if (totalWords === 0) {
      return;
    }

    const durationMs = options?.durationMs ?? estimateSpeechTraceDurationMs(text);
    const wordWeights = getSpeechTraceWordWeights(text, words);
    const wordStartTimesMs = buildSpeechTraceWordStartTimesMs(options?.timings, totalWords);

    speechTraceSessionRef.current = {
      messageId,
      totalWords,
      startedAt: options?.startedAt ?? performance.now(),
      durationMs,
      wordWeights,
      wordEndTimesMs: buildSpeechTraceWordEndTimesMs(wordWeights, durationMs),
      wordStartTimesMs
    };
    setSpeechTrace({ messageId, wordIndex: 0, totalWords });

    if (options?.manual) {
      return;
    }

    const tick = () => {
      const session = speechTraceSessionRef.current;

      if (!session) {
        return;
      }

      const elapsedMs = performance.now() - session.startedAt;
      const wordIndex = session.wordStartTimesMs
        ? getSpeechTraceWordIndexFromStartTimes(session.wordStartTimesMs, elapsedMs, session.totalWords)
        : getSpeechTraceWordIndex(session.wordEndTimesMs, elapsedMs);
      setSpeechTrace({ messageId: session.messageId, wordIndex, totalWords: session.totalWords });
    };

    tick();
    speechTraceTimerRef.current = window.setInterval(tick, wordStartTimesMs ? 40 : 90);
  }

  function updateSpeechTraceDuration(durationMs: number) {
    const session = speechTraceSessionRef.current;

    if (!session || session.wordStartTimesMs || !Number.isFinite(durationMs) || durationMs <= 0) {
      return;
    }

    speechTraceSessionRef.current = {
      ...session,
      durationMs: Math.max(durationMs, 500),
      wordEndTimesMs: buildSpeechTraceWordEndTimesMs(session.wordWeights, Math.max(durationMs, 500))
    };
  }

  function updateSpeechTraceWordIndex(wordIndex: number) {
    const session = speechTraceSessionRef.current;

    if (!session || !Number.isFinite(wordIndex)) {
      return;
    }

    setSpeechTrace({
      messageId: session.messageId,
      wordIndex: Math.min(session.totalWords - 1, Math.max(0, Math.floor(wordIndex))),
      totalWords: session.totalWords
    });
  }

  function stopTutorSpeech(nextStatus?: string) {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    clearSpeechTrace();

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }

    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }

    if (activeAudioContextRef.current) {
      void activeAudioContextRef.current.close().catch(() => undefined);
      activeAudioContextRef.current = null;
    }

    speechUtteranceRef.current = null;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setTutorSpeaking(false);

    if (nextStatus) {
      setStatus(nextStatus);
    }
  }

  function speakInterfacePrompt(text: string, options?: { traceMessageId?: string }) {
    const promptText = text.trim();

    if (!promptText) {
      return;
    }

    stopTutorSpeech();

    if (!("speechSynthesis" in window)) {
      setStatus("Speech playback is unavailable in this browser");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(promptText);
    speechUtteranceRef.current = utterance;
    utterance.lang = targetLanguage;
    utterance.rate = clampTtsSpeechRate(ttsSpeechRate);
    utterance.pitch = ttsVoiceStyle === "female" ? 1.05 : 0.94;
    startSpeechTrace(options?.traceMessageId, promptText, { manual: true });
    utterance.onboundary = (event) => {
      const wordIndex = getSpeechTraceWordIndexAtChar(promptText, event.charIndex);

      if (wordIndex !== null) {
        updateSpeechTraceWordIndex(wordIndex);
      }
    };
    utterance.onend = () => {
      if (speechUtteranceRef.current === utterance) {
        speechUtteranceRef.current = null;
        clearSpeechTrace();
        setTutorSpeaking(false);
        setStatus("Speech finished");
      }
    };
    utterance.onerror = () => {
      if (speechUtteranceRef.current === utterance) {
        speechUtteranceRef.current = null;
        clearSpeechTrace();
        setTutorSpeaking(false);
        setStatus("Speech playback failed");
      }
    };

    setTutorSpeaking(true);
    setStatus("Reading screen...");
    window.speechSynthesis.speak(utterance);
  }

  async function speakText(
    text: string,
    options?: { onReadyToReveal?: () => void; onSpeechComplete?: () => void; traceMessageId?: string }
  ) {
    if (!text.trim()) {
      options?.onReadyToReveal?.();
      return false;
    }

    stopTutorSpeech();
    const controller = new AbortController();
    const speechRate = clampTtsSpeechRate(ttsSpeechRate);
    ttsAbortRef.current = controller;
    setTutorSpeaking(true);
    setStatus("Preparing voice...");

    const reveal = () => {
      options?.onReadyToReveal?.();
    };
    const completeSpeech = () => {
      options?.onSpeechComplete?.();
    };

    try {
      const response = await fetch("/api/speech/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({ text, voice: ttsVoiceStyle })
      });

      if (!response.ok) {
        await readJsonResponse(response);
      }

      const result = await readJsonResponse<{
        audioBase64: string | null;
        format: "mp3" | null;
        provider: "openai" | "google" | "browser";
        fallback: "none" | "browser";
        timings?: SpeechTimingPoint[];
        usage?: TtsUsageResponse;
      }>(response);

      if (result.usage) {
        setTtsUsage(result.usage);
      }

      if (controller.signal.aborted) {
        setTutorSpeaking(false);
        return false;
      }

      if (result.audioBase64 && result.format) {
        reveal();
        const audio = new Audio(`data:audio/${result.format};base64,${result.audioBase64}`);
        audio.playbackRate = speechRate;
        activeAudioRef.current = audio;
        audio.addEventListener("ended", () => {
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null;
            clearSpeechTrace();
            setTutorSpeaking(false);
            setStatus("Speech finished");
            completeSpeech();
          }
        });
        audio.addEventListener("error", () => {
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null;
            clearSpeechTrace();
            setTutorSpeaking(false);
            setStatus("Speech playback failed");
          }
        });
        audio.addEventListener("durationchange", () => {
          const durationMs = getFiniteAudioDurationMs(audio);
          updateSpeechTraceDuration(
            durationMs ? durationMs / speechRate : estimateSpeechTraceDurationMs(text) / speechRate
          );
        });
        await audio.play();
        const audioDurationMs = getFiniteAudioDurationMs(audio);
        startSpeechTrace(options?.traceMessageId, text, {
          durationMs: audioDurationMs ? audioDurationMs / speechRate : undefined,
          startedAt: performance.now(),
          timings: scaleSpeechTimings(result.timings, speechRate)
        });
        setStatus(result.timings?.length ? "Playing synced audio" : "Playing audio");
        return true;
      }

      const streamed = await speakWithStreamingTts(text, controller, reveal, completeSpeech, options?.traceMessageId);

      if (streamed) {
        return true;
      }

      reveal();
      if (speakWithBrowser(text, options?.traceMessageId, completeSpeech)) {
        setStatus("Playing browser speech");
        return true;
      }

      return false;
    } catch (nextError) {
      if (
        (nextError instanceof Error && nextError.name === "AbortError") ||
        (typeof nextError === "object" && nextError !== null && "name" in nextError && nextError.name === "AbortError")
      ) {
        setTutorSpeaking(false);
        return false;
      }

      activeAudioRef.current = null;
      setTutorSpeaking(false);
      setError(nextError instanceof Error ? nextError.message : "Speech failed");
      reveal();
      setTutorSpeaking(true);
      if (speakWithBrowser(text, options?.traceMessageId, completeSpeech)) {
        setStatus("Playing browser speech");
        return true;
      }

      return false;
    } finally {
      if (ttsAbortRef.current === controller) {
        ttsAbortRef.current = null;
      }
    }
  }

  async function speakWithStreamingTts(
    text: string,
    controller: AbortController,
    reveal: () => void,
    completeSpeech: () => void,
    traceMessageId?: string
  ) {
    try {
      const response = await fetch("/api/speech/synthesize/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/pcm, application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({ text, voice: ttsVoiceStyle })
      });

      if (!response.ok) {
        return false;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.startsWith("audio/pcm")) {
        return false;
      }

      if (controller.signal.aborted) {
        setTutorSpeaking(false);
        return false;
      }

      reveal();
      setStatus("Playing audio");
      const played = await playPcmStream(
        response,
        controller.signal,
        traceMessageId,
        text,
        clampTtsSpeechRate(ttsSpeechRate)
      );

      if (played) {
        completeSpeech();
      }

      return played;
    } catch (error) {
      if (
        (error instanceof Error && error.name === "AbortError") ||
        (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
      ) {
        setTutorSpeaking(false);
        return false;
      }

      return false;
    }
  }

  async function playPcmStream(
    response: Response,
    signal: AbortSignal,
    traceMessageId?: string,
    text?: string,
    speechRate = DEFAULT_TTS_SPEECH_RATE
  ) {
    const body = response.body;
    const AudioContextConstructor = getAudioContextConstructor();
    const sampleRate = Number(response.headers.get("x-tts-sample-rate") || "24000");

    if (!body || !AudioContextConstructor || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return false;
    }

    const audioContext = new AudioContextConstructor();
    activeAudioContextRef.current = audioContext;
    const reader = body.getReader();
    let pendingBytes = new Uint8Array();
    let nextStartTime = audioContext.currentTime + 0.04;
    let playbackStartTime: number | null = null;
    let hasScheduledAudio = false;

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value || value.length === 0) {
          continue;
        }

        const bytes = pendingBytes.length > 0 ? concatBytes(pendingBytes, value) : value;
        const playableByteLength = bytes.length - (bytes.length % 2);
        pendingBytes = playableByteLength < bytes.length ? bytes.slice(playableByteLength) : new Uint8Array();

        if (playableByteLength === 0) {
          continue;
        }

        const audioBuffer = pcm16BytesToAudioBuffer(audioContext, bytes.subarray(0, playableByteLength), sampleRate);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = speechRate;
        source.connect(audioContext.destination);

        const startAt = Math.max(nextStartTime, audioContext.currentTime + 0.02);
        const firstScheduledBuffer = playbackStartTime === null;
        playbackStartTime = playbackStartTime ?? startAt;
        source.start(startAt);
        nextStartTime = startAt + audioBuffer.duration / speechRate;

        if (firstScheduledBuffer && text) {
          const startDelayMs = Math.max(0, (startAt - audioContext.currentTime) * 1000);
          startSpeechTrace(traceMessageId, text, {
            durationMs: (audioBuffer.duration * 1000) / speechRate,
            startedAt: performance.now() + startDelayMs
          });
        }

        updateSpeechTraceDuration((nextStartTime - playbackStartTime) * 1000);
        hasScheduledAudio = true;
        setStatus("Playing audio");
      }

      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return false;
      }

      if (!hasScheduledAudio) {
        return false;
      }

      await waitForScheduledAudio(audioContext, nextStartTime, signal);

      if (activeAudioContextRef.current === audioContext) {
        activeAudioContextRef.current = null;
      }

      await audioContext.close().catch(() => undefined);
      clearSpeechTrace();
      setTutorSpeaking(false);
      setStatus("Speech finished");
      return true;
    } catch (error) {
      await reader.cancel().catch(() => undefined);

      if (activeAudioContextRef.current === audioContext) {
        activeAudioContextRef.current = null;
      }

      await audioContext.close().catch(() => undefined);

      if (signal.aborted) {
        setTutorSpeaking(false);
        return false;
      }

      throw error;
    }
  }

  function speakWithBrowser(text: string, traceMessageId?: string, completeSpeech?: () => void) {
    if (!("speechSynthesis" in window)) {
      setTutorSpeaking(false);
      setStatus("Speech playback is unavailable in this browser");
      return false;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    speechUtteranceRef.current = utterance;
    utterance.lang = targetLanguage;
    utterance.rate = clampTtsSpeechRate(ttsSpeechRate);
    utterance.pitch = ttsVoiceStyle === "female" ? 1.05 : 0.94;
    startSpeechTrace(traceMessageId, text, { manual: true });
    utterance.onboundary = (event) => {
      const wordIndex = getSpeechTraceWordIndexAtChar(text, event.charIndex);

      if (wordIndex !== null) {
        updateSpeechTraceWordIndex(wordIndex);
      }
    };
    utterance.onend = () => {
      if (speechUtteranceRef.current === utterance) {
        speechUtteranceRef.current = null;
        clearSpeechTrace();
        setTutorSpeaking(false);
        setStatus("Speech finished");
        completeSpeech?.();
      }
    };
    utterance.onerror = () => {
      if (speechUtteranceRef.current === utterance) {
        speechUtteranceRef.current = null;
        clearSpeechTrace();
        setTutorSpeaking(false);
        setStatus("Speech playback failed");
      }
    };
    window.speechSynthesis.speak(utterance);
    return true;
  }

  const quickActions = [
    { label: "Simplify this", text: "Please explain that in a simpler way, one small step at a time." },
    { label: "Give me a hint", text: "Give me one small hint, but do not give away the answer." },
    { label: "Summarize", text: "Please summarize the key idea from the page in simple language." },
    { label: "Ask a question", text: "Ask me one short question to check whether I understand this material." }
  ];

  const sessionTitle = learningContext?.topic || "Learning session";
  const sessionLanguage = getLanguageDisplayName(learningContext?.detectedLanguage || "English");
  const sessionPageCount = materials.length || 1;
  const learnScreenOpen = !settingsOpen && !sessionsOpen && !materialsOpen && !progressOpen;
  const listenVisiblePrompt =
    activeLearningCheck?.question ||
    lastAssistantMessage?.content ||
    "Press the microphone and ask a question. You can say things like, help me understand this page.";

  const languageSelector = (
    <LanguageMenu
      value={targetLanguage}
      disabled={busy}
      onChange={setTargetLanguage}
      className="header-language-menu"
      ariaLabel="Tutor language"
    />
  );

  const healthStatus = health && (
    <span className={`health-pill ${health.ok ? "ok" : "error"}`}>
      {health.ok ? (
        <CheckCircle2 size={13} aria-hidden />
      ) : (
        <AlertCircle size={13} aria-hidden />
      )}
      {health.ok ? `${health.llmProvider}` : `${health.missingKeys.length} missing`}
    </span>
  );

  const voiceRecorderControl = (
    <VoiceRecorder
      disabled={busy}
      sourceLanguage={sourceLanguage}
      tutorSpeaking={tutorSpeaking}
      onTranscript={(transcript, voiceInteractionSignals) => {
        setQuestion(transcript);
        void submitQuestion(transcript, { voiceInteractionSignals });
      }}
    />
  );

  if (listenMode) {
    if (phase === "capture") {
      return (
        <ListenModeCapture
          busy={busy}
          status={status}
          error={error}
          pendingMaterials={pendingMaterials}
          targetLanguage={targetLanguage}
          healthStatus={healthStatus}
          onMaterialReady={handleMaterialReady}
          onRemovePendingMaterial={handleRemovePendingMaterial}
          onStartSession={() => void handleStartSession()}
          onUseSample={handleUseSample}
          onCloseListenMode={handleCloseListenMode}
          onTargetLanguageChange={setTargetLanguage}
        />
      );
    }

    return (
      <ListenModeSession
        messages={messages}
        selectedMaterial={selectedMaterial}
        materials={materials}
        sessionTitle={sessionTitle}
        sessionLanguage={sessionLanguage}
        question={question}
        busy={busy}
        tutorSpeaking={tutorSpeaking}
        speechTrace={speechTrace}
        activeLearningCheck={activeLearningCheck}
        voiceRecorder={voiceRecorderControl}
        promptText={listenVisiblePrompt}
        textSizeStep={listenTextSizeStep}
        onDecreaseTextSize={() => setListenTextSizeStep((current) => clampListenTextSizeStep(current - 1))}
        onIncreaseTextSize={() => setListenTextSizeStep((current) => clampListenTextSizeStep(current + 1))}
        onQuestionChange={setQuestion}
        onSend={() => void submitQuestion()}
        onSkipLearningCheck={handleSkipActiveLearningCheck}
        onSpeakLast={() =>
          void speakText(lastAssistantMessage?.content || learningContext?.suggestedQuestion || "", {
            traceMessageId: lastAssistantMessage?.id
          })
        }
        onStopSpeaking={() => stopTutorSpeech("Tutor speech stopped")}
        onNewSession={handleNewSession}
        onCloseListenMode={handleCloseListenMode}
        onHearPrompt={() =>
          speakInterfacePrompt(listenVisiblePrompt, {
            traceMessageId: activeLearningCheck ? undefined : lastAssistantMessage?.id
          })
        }
      />
    );
  }

  if (phase === "capture") {
    return (
      <main className="landing-shell">
        <aside className="landing-sidebar" aria-label="Primary">
          <div className="landing-brand">
            <div className="brand-mark">P</div>
            <div>
              <h1 className="brand-title">Phloem</h1>
              <p className="brand-subtitle">AI Learning Companion</p>
            </div>
          </div>

          <nav className="landing-nav" aria-label="Product sections">
            <button
              className={`landing-nav-item ${learnScreenOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenLearn}
            >
              <House size={20} aria-hidden />
              Learn
            </button>
            <button className="landing-nav-item listen-mode-entry" type="button" onClick={handleOpenListenMode}>
              <Headphones size={20} aria-hidden />
              Listen Mode
            </button>
            <button
              className={`landing-nav-item ${sessionsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenSessions}
            >
              <MessageSquare size={20} aria-hidden />
              Sessions
            </button>
            <button
              className={`landing-nav-item ${materialsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenMaterials}
            >
              <Folder size={20} aria-hidden />
              Materials
            </button>
            <button
              className={`landing-nav-item ${progressOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenProgress}
            >
              <BarChart3 size={20} aria-hidden />
              Progress
            </button>
            <button
              className={`landing-nav-item ${settingsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenSettings}
            >
              <Settings size={20} aria-hidden />
              Settings
            </button>
          </nav>

          <div className="landing-sidebar-card">
            <div className="leaf-badge">
              <Leaf size={34} aria-hidden />
            </div>
            <h2>Learn more effectively with Phloem</h2>
            <p>Upload materials, ask questions, and get personalized help.</p>
            <button className="sidebar-outline-button" type="button">
              Learn how it works
            </button>
          </div>

          <div className="landing-user-card">
            <div className="landing-avatar">A</div>
            <div>
              <p>Aaryan</p>
              <span>Free Plan</span>
            </div>
            <ChevronDown size={17} aria-hidden />
          </div>
        </aside>

        <section className="landing-main">
          {sessionsOpen ? (
            <SessionsScreen
              sessions={savedSessions}
              currentSessionId={sessionId}
              loading={sessionsLoading}
              error={sessionsError}
              supabaseConfigured={Boolean(health?.supabaseConfigured)}
              onRefresh={() => void loadSavedSessions()}
              onOpen={(id) => void handleLoadSession(id)}
              onDelete={(id) => void handleDeleteSession(id)}
              onNewSession={handleNewSession}
            />
          ) : materialsOpen ? (
            <MaterialsScreen
              materials={savedMaterials}
              currentSessionId={sessionId}
              loading={materialsLoading}
              error={materialsError}
              supabaseConfigured={Boolean(health?.supabaseConfigured)}
              onRefresh={() => void loadSavedMaterials()}
              onOpenSession={(id) => void handleLoadSession(id)}
              onDelete={(id) => void handleDeleteMaterial(id)}
              onNewSession={handleNewSession}
            />
          ) : settingsOpen ? (
            <SettingsScreen
              targetLanguage={targetLanguage}
              sourceLanguage={sourceLanguage}
              allowDirectAnswer={allowDirectAnswer}
              ttsVoiceStyle={ttsVoiceStyle}
              ttsSpeechRate={ttsSpeechRate}
              ttsProvider={health?.ttsProvider || "browser"}
              ttsUsage={ttsUsage}
              ttsUsageLoading={ttsUsageLoading}
              ttsUsageError={ttsUsageError}
              busy={busy}
              onTargetLanguageChange={setTargetLanguage}
              onSourceLanguageChange={setSourceLanguage}
              onAllowDirectAnswerChange={setAllowDirectAnswer}
              onTtsVoiceStyleChange={setTtsVoiceStyle}
              onTtsSpeechRateChange={(value) => setTtsSpeechRate(clampTtsSpeechRate(value))}
              onRefreshTtsUsage={() => void loadTtsUsage()}
            />
          ) : progressOpen ? (
            <ProgressScreen
              checks={learningChecks}
              masteries={conceptMasteries}
              activeCheck={activeLearningCheck}
              hasMaterials={materials.length > 0}
              onOpenLearn={handleOpenLearn}
              onPracticeConcept={handlePracticeConcept}
            />
          ) : (
            <>
              <header className="landing-toolbar">
                <div aria-hidden />
                <div className="landing-toolbar-actions">
                  <button className="listen-toolbar-button" type="button" onClick={handleOpenListenMode}>
                    <Headphones size={18} aria-hidden />
                    Listen Mode
                  </button>
                  <LanguageMenu
                    value={targetLanguage}
                    disabled={busy}
                    onChange={setTargetLanguage}
                    className="landing-language-menu"
                    ariaLabel="Tutor language"
                  />
                  {healthStatus}
                </div>
              </header>

              <div className="landing-content">
                <p className="landing-greeting">Good afternoon, Aaryan! {"\u{1F44B}"}</p>
                <h2>What would you like to learn today?</h2>
                <p className="landing-subtitle">
                  Upload a page, take a photo, or select a file — I&apos;ll help you understand it.
                </p>

                <div className="landing-upload-panel landing-upload-panel-tall">
                  <CameraCapture busy={busy} onMaterialReady={handleMaterialReady} />

                  {pendingMaterials.length > 0 && (
                    <PendingMaterialsPanel
                      materials={pendingMaterials}
                      busy={busy}
                      onRemove={handleRemovePendingMaterial}
                      onStart={() => void handleStartSession()}
                    />
                  )}
                </div>

              </div>
            </>
          )}
        </section>
        {processingMaterials && <ProcessingOverlay label={status} />}
      </main>
    );
  }

  if (phase === "learn") {
    return (
      <main className="session-shell">
        <aside className="landing-sidebar" aria-label="Primary">
          <div className="landing-brand">
            <div className="brand-mark">P</div>
            <div>
              <h1 className="brand-title">Phloem</h1>
              <p className="brand-subtitle">AI Learning Companion</p>
            </div>
          </div>

          <nav className="landing-nav" aria-label="Product sections">
            <button
              className={`landing-nav-item ${learnScreenOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenLearn}
              disabled={busy}
            >
              <House size={20} aria-hidden />
              Learn
            </button>
            <button className="landing-nav-item listen-mode-entry" type="button" onClick={handleOpenListenMode}>
              <Headphones size={20} aria-hidden />
              Listen Mode
            </button>
            <button
              className={`landing-nav-item ${sessionsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenSessions}
            >
              <MessageSquare size={20} aria-hidden />
              Sessions
            </button>
            <button
              className={`landing-nav-item ${materialsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenMaterials}
            >
              <Folder size={20} aria-hidden />
              Materials
            </button>
            <button
              className={`landing-nav-item ${progressOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenProgress}
            >
              <BarChart3 size={20} aria-hidden />
              Progress
            </button>
            <button
              className={`landing-nav-item ${settingsOpen ? "active" : ""}`}
              type="button"
              onClick={handleOpenSettings}
            >
              <Settings size={20} aria-hidden />
              Settings
            </button>
          </nav>

          <div className="landing-sidebar-card">
            <div className="leaf-badge">
              <Leaf size={34} aria-hidden />
            </div>
            <h2>Learn more effectively with Phloem</h2>
            <p>Upload materials, ask questions, and get personalized help.</p>
            <button className="sidebar-outline-button" type="button">
              Learn how it works
            </button>
          </div>

          <div className="landing-user-card">
            <div className="landing-avatar">A</div>
            <div>
              <p>Aaryan</p>
              <span>Free Plan</span>
            </div>
            <ChevronDown size={17} aria-hidden />
          </div>
        </aside>

        <section className="session-main">
          {sessionsOpen ? (
            <SessionsScreen
              sessions={savedSessions}
              currentSessionId={sessionId}
              loading={sessionsLoading}
              error={sessionsError}
              supabaseConfigured={Boolean(health?.supabaseConfigured)}
              onRefresh={() => void loadSavedSessions()}
              onOpen={(id) => void handleLoadSession(id)}
              onDelete={(id) => void handleDeleteSession(id)}
              onNewSession={handleNewSession}
            />
          ) : materialsOpen ? (
            <MaterialsScreen
              materials={savedMaterials}
              currentSessionId={sessionId}
              loading={materialsLoading}
              error={materialsError}
              supabaseConfigured={Boolean(health?.supabaseConfigured)}
              onRefresh={() => void loadSavedMaterials()}
              onOpenSession={(id) => void handleLoadSession(id)}
              onDelete={(id) => void handleDeleteMaterial(id)}
              onNewSession={handleNewSession}
            />
          ) : settingsOpen ? (
            <SettingsScreen
              targetLanguage={targetLanguage}
              sourceLanguage={sourceLanguage}
              allowDirectAnswer={allowDirectAnswer}
              ttsVoiceStyle={ttsVoiceStyle}
              ttsSpeechRate={ttsSpeechRate}
              ttsProvider={health?.ttsProvider || "browser"}
              ttsUsage={ttsUsage}
              ttsUsageLoading={ttsUsageLoading}
              ttsUsageError={ttsUsageError}
              busy={busy}
              onTargetLanguageChange={setTargetLanguage}
              onSourceLanguageChange={setSourceLanguage}
              onAllowDirectAnswerChange={setAllowDirectAnswer}
              onTtsVoiceStyleChange={setTtsVoiceStyle}
              onTtsSpeechRateChange={(value) => setTtsSpeechRate(clampTtsSpeechRate(value))}
              onRefreshTtsUsage={() => void loadTtsUsage()}
            />
          ) : progressOpen ? (
            <ProgressScreen
              checks={learningChecks}
              masteries={conceptMasteries}
              activeCheck={activeLearningCheck}
              hasMaterials={materials.length > 0}
              onOpenLearn={handleOpenLearn}
              onPracticeConcept={handlePracticeConcept}
            />
          ) : (
            <>
              <header className="session-header">
                <div>
                  <button className="session-title-button" type="button">
                    <span>{sessionTitle}</span>
                    <ChevronDown size={17} aria-hidden />
                  </button>
                  <p>
                    <Clock size={14} aria-hidden />
                    {sessionPageCount} page{sessionPageCount === 1 ? "" : "s"} • {sessionLanguage}
                  </p>
                </div>

                <div className="session-actions">
                  <button className="session-action-button listen-toolbar-button" type="button" onClick={handleOpenListenMode}>
                    <Headphones size={17} aria-hidden />
                    Listen Mode
                  </button>
                  <button className="session-action-button" type="button">
                    <Share2 size={17} aria-hidden />
                    Share
                  </button>
                  <button className="session-icon-button" type="button" aria-label="More session actions">
                    <MoreVertical size={20} aria-hidden />
                  </button>
                  <button className="session-primary-button" type="button" onClick={handleNewSession}>
                    <PlusSquare size={17} aria-hidden />
                    New Session
                  </button>
                </div>
              </header>

              <div className="session-workspace">
                <MaterialRail
                  materials={materials}
                  selectedMaterialId={selectedMaterial?.id ?? null}
                  onSelect={setSelectedMaterialId}
                />

                <ConversationPanel
                  messages={messages}
                  question={question}
                  busy={busy}
                  status={status}
                  error={error}
                  responseStopped={tutorStopped}
                  tutorSpeaking={tutorSpeaking}
                  speechTrace={speechTrace}
                  understandingLevel={understandingLevel}
                  activeLearningCheck={activeLearningCheck}
                  quickActions={quickActions}
                  onQuestionChange={setQuestion}
                  onEditMessage={handleEditMessage}
                  onSend={() => void submitQuestion()}
                  onQuickAction={(text) => void submitQuestion(text, { skipLearningCheck: true })}
                  onSkipLearningCheck={handleSkipActiveLearningCheck}
                  onStopResponding={handleStopTutorResponse}
                  onStopSpeaking={() => stopTutorSpeech("Tutor speech stopped")}
                  onSpeakLast={() =>
                    void speakText(lastAssistantMessage?.content || learningContext?.suggestedQuestion || "", {
                      traceMessageId: lastAssistantMessage?.id
                    })
                  }
                  voiceRecorder={voiceRecorderControl}
                />
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  // ---- Render ----
  return (
    <main className="app-shell">
      {/* Header */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <h1 className="brand-title">Phloem</h1>
              <p className="brand-subtitle">AI Learning Companion</p>
            </div>
          </div>

          <div className="header-actions">
            {languageSelector}

            {/* Settings trigger */}
            <button
              className="header-btn-icon"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings"
            >
              <Settings size={18} />
            </button>

            {/* Health status */}
            {healthStatus}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="main-content">
        <div key={phase} className="phase-container">
          {/* ===== TWO-PANEL WORKSPACE ===== */}
          {phase === "review" && (
            <div className="workspace-layout">
              <MaterialRail
                materials={materials}
                selectedMaterialId={selectedMaterial?.id ?? null}
                onSelect={setSelectedMaterialId}
              />

              <ConversationPanel
                messages={messages}
                question={question}
                busy={busy}
                status={status}
                error={error}
                responseStopped={tutorStopped}
                tutorSpeaking={tutorSpeaking}
                speechTrace={speechTrace}
                understandingLevel={understandingLevel}
                activeLearningCheck={activeLearningCheck}
                quickActions={quickActions}
                onQuestionChange={setQuestion}
                onEditMessage={handleEditMessage}
                onSend={() => void submitQuestion()}
                onQuickAction={(text) => void submitQuestion(text, { skipLearningCheck: true })}
                onSkipLearningCheck={handleSkipActiveLearningCheck}
                onStopResponding={handleStopTutorResponse}
                onStopSpeaking={() => stopTutorSpeech("Tutor speech stopped")}
                onSpeakLast={() =>
                  void speakText(lastAssistantMessage?.content || learningContext?.suggestedQuestion || "", {
                    traceMessageId: lastAssistantMessage?.id
                  })
                }
                voiceRecorder={voiceRecorderControl}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

type BrowserAudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): BrowserAudioContextConstructor | null {
  return window.AudioContext || (window as Window & { webkitAudioContext?: BrowserAudioContextConstructor }).webkitAudioContext || null;
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function pcm16BytesToAudioBuffer(audioContext: AudioContext, bytes: Uint8Array, sampleRate: number) {
  const sampleCount = bytes.length / 2;
  const audioBuffer = audioContext.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < sampleCount; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 32768;
  }

  return audioBuffer;
}

function waitForScheduledAudio(audioContext: AudioContext, nextStartTime: number, signal: AbortSignal) {
  const remainingMs = Math.max(0, (nextStartTime - audioContext.currentTime) * 1000);

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Speech playback was aborted.", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, remainingMs);

    function handleAbort() {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      reject(new DOMException("Speech playback was aborted.", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function countTraceWords(text: string) {
  return getSpeechTraceWords(text).length;
}

function estimateSpeechTraceDurationMs(text: string) {
  const wordCount = countTraceWords(text);
  const wordsPerMinute = 145;
  return Math.max(900, (wordCount / wordsPerMinute) * 60_000);
}

function buildSpeechTraceWordStartTimesMs(timings: SpeechTimingPoint[] | undefined, totalWords: number) {
  if (!timings || timings.length === 0) {
    return null;
  }

  const wordStartTimesMs = new Array<number>(totalWords);

  timings.forEach((timing) => {
    if (
      Number.isInteger(timing.wordIndex) &&
      timing.wordIndex >= 0 &&
      timing.wordIndex < totalWords &&
      Number.isFinite(timing.timeMs)
    ) {
      wordStartTimesMs[timing.wordIndex] = Math.max(0, timing.timeMs);
    }
  });

  return wordStartTimesMs.some((timeMs) => Number.isFinite(timeMs)) ? wordStartTimesMs : null;
}

function getFiniteAudioDurationMs(audio: HTMLAudioElement) {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : undefined;
}

function LanguageMenu({
  value,
  disabled,
  onChange,
  className = "",
  ariaLabel
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = LANGUAGE_OPTIONS.find((option) => option.value === value) ?? {
    value,
    label: getLanguageDisplayName(value)
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`language-menu ${open ? "open" : ""} ${className}`} ref={menuRef}>
      <button
        className="language-menu-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Globe size={18} aria-hidden />
        <span>{selectedOption.label}</span>
        <ChevronDown size={17} aria-hidden />
      </button>

      {open && (
        <div className="language-menu-popover" role="listbox" aria-label={ariaLabel}>
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              className={`language-menu-option ${option.value === value ? "active" : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <CheckCircle2 size={15} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialRail({
  materials,
  selectedMaterialId,
  onSelect
}: {
  materials: CapturedMaterial[];
  selectedMaterialId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedMaterial = materials.find((material) => material.id === selectedMaterialId) ?? materials.at(-1);

  return (
    <aside className="material-rail" aria-label="Submitted learning material">
      <div className="material-rail-header">
        <h2>Material</h2>
      </div>

      <div className="material-strip">
        {materials.map((material, index) => (
          <button
            key={material.id}
            className={`material-thumb-card ${material.id === selectedMaterialId ? "active" : ""}`}
            type="button"
            onClick={() => onSelect(material.id)}
          >
            {material.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Local camera data URL thumbnail.
              <img src={material.imageDataUrl} alt={`Submitted material ${index + 1}`} />
            ) : (
              <span className="material-thumb-placeholder">
                <FileText size={22} aria-hidden />
                <strong>{material.learningContext.topic}</strong>
                <small>{material.name}</small>
              </span>
            )}
            <span className="material-thumb-label">Page {index + 1}</span>
          </button>
        ))}
      </div>

      {selectedMaterial && (
        <div className="material-detail">
          <p className="context-label">Page language</p>
          <p className="material-pill">
            <Globe size={14} aria-hidden />
            {getLanguageDisplayName(selectedMaterial.learningContext.detectedLanguage)}
          </p>

          <p className="context-label">Detected topic</p>
          <p className="material-pill">
            <Leaf size={14} aria-hidden />
            {selectedMaterial.learningContext.topic}
          </p>

          <p className="context-label">Summary</p>
          <p className="material-detail-text">{selectedMaterial.learningContext.summary}</p>

          <p className="context-label">Suggested first question</p>
          <button className="suggested-question-card" type="button">
            <span>{selectedMaterial.learningContext.suggestedQuestion}</span>
            <ExternalLink size={13} aria-hidden />
          </button>

          {selectedMaterial.learningContext.diagramNotes && (
            <>
              <p className="context-label">Diagram / layout</p>
              <p className="material-detail-text diagram-notes">{selectedMaterial.learningContext.diagramNotes}</p>
            </>
          )}

          <details className="ocr-details">
            <summary>
              <FileText size={16} aria-hidden />
              View full material
            </summary>
            <p>{selectedMaterial.learningContext.extractedText || "No extracted text available."}</p>
          </details>
        </div>
      )}
    </aside>
  );
}

function ListenModeCapture({
  busy,
  status,
  error,
  pendingMaterials,
  targetLanguage,
  healthStatus,
  onMaterialReady,
  onRemovePendingMaterial,
  onStartSession,
  onUseSample,
  onCloseListenMode,
  onTargetLanguageChange
}: {
  busy: boolean;
  status: string;
  error: string;
  pendingMaterials: PendingMaterial[];
  targetLanguage: string;
  healthStatus: ReactNode;
  onMaterialReady: (material: CapturedInput) => void;
  onRemovePendingMaterial: (materialId: string) => void;
  onStartSession: () => void;
  onUseSample: () => void;
  onCloseListenMode: () => void;
  onTargetLanguageChange: (value: string) => void;
}) {
  const hasPendingMaterial = pendingMaterials.length > 0;

  return (
    <main className="listen-shell listen-capture-shell listen-one-screen">
      <header className="listen-topbar">
        <div className="listen-brand">
          <div className="brand-mark">P</div>
          <div>
            <h1>Listen Mode</h1>
            <p>Voice-first learning</p>
          </div>
        </div>

        <div className="listen-topbar-actions">
          <LanguageMenu
            value={targetLanguage}
            disabled={busy}
            onChange={onTargetLanguageChange}
            className="listen-language-menu"
            ariaLabel="Tutor language"
          />
          {healthStatus}
          <button className="listen-secondary-button" type="button" onClick={onCloseListenMode}>
            <LayoutDashboard size={18} aria-hidden />
            Full dashboard
          </button>
        </div>
      </header>

      <section className="listen-capture-stage">
        <div className="listen-capture-single">
          <div className="listen-capture-heading">
            <h2>{hasPendingMaterial ? "Ready to listen" : "Upload your page"}</h2>
            <p>{hasPendingMaterial ? "I will read it and help you by voice." : "I will read it and help you by voice."}</p>
          </div>

          <div className="listen-capture-card">
          {hasPendingMaterial ? (
            <ListenPendingMaterials
              materials={pendingMaterials}
              busy={busy}
              status={status}
              error={error}
              onRemove={onRemovePendingMaterial}
              onStart={onStartSession}
            />
          ) : (
            <CameraCapture
              busy={busy}
              variant="listen"
              onMaterialReady={onMaterialReady}
            />
          )}
          </div>

          {!hasPendingMaterial && (
            <div className="listen-capture-quick-actions">
              <button className="listen-secondary-button" type="button" onClick={onUseSample} disabled={busy}>
                <BookOpen size={18} aria-hidden />
                Sample
              </button>
            </div>
          )}
        </div>
      </section>

      <ListenStatus status={status} error={error} />
    </main>
  );
}

function ListenPendingMaterials({
  materials,
  busy,
  status,
  error,
  onRemove,
  onStart
}: {
  materials: PendingMaterial[];
  busy: boolean;
  status: string;
  error: string;
  onRemove: (materialId: string) => void;
  onStart: () => void;
}) {
  return (
    <aside className="listen-ready-panel one-button-ready-panel" aria-live="polite">
      <div>
        <span className="listen-mode-pill">
          <CheckCircle2 size={17} aria-hidden />
          Page ready
        </span>
        <h2>Start listening</h2>
        <p>Phloem will read the page and help by voice.</p>
      </div>

      <div className="listen-ready-list">
        {materials.map((material, index) => (
          <div className="listen-ready-row" key={material.id}>
            <span>{index + 1}</span>
            <div>
              <strong>{describeMaterialType(material.mimeType)}</strong>
              <small>{formatBytes(material.size)}</small>
            </div>
            <button type="button" onClick={() => onRemove(material.id)} disabled={busy} aria-label="Remove material">
              <X size={18} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <button className="listen-start-button" type="button" onClick={onStart} disabled={busy}>
        <PlayCircle size={24} aria-hidden />
        Start listening
      </button>

      <ListenStatus status={status} error={error} />
    </aside>
  );
}

function ListenModeSession({
  messages,
  selectedMaterial,
  materials,
  sessionTitle,
  sessionLanguage,
  question,
  busy,
  tutorSpeaking,
  speechTrace,
  activeLearningCheck,
  voiceRecorder,
  promptText,
  textSizeStep,
  onDecreaseTextSize,
  onIncreaseTextSize,
  onQuestionChange,
  onSend,
  onSkipLearningCheck,
  onSpeakLast,
  onStopSpeaking,
  onNewSession,
  onCloseListenMode,
  onHearPrompt
}: {
  messages: ConversationMessage[];
  selectedMaterial: CapturedMaterial | null;
  materials: CapturedMaterial[];
  sessionTitle: string;
  sessionLanguage: string;
  question: string;
  busy: boolean;
  tutorSpeaking: boolean;
  speechTrace: SpeechTraceState | null;
  activeLearningCheck: ActiveLearningCheck | null;
  voiceRecorder: ReactNode;
  promptText: string;
  textSizeStep: number;
  onDecreaseTextSize: () => void;
  onIncreaseTextSize: () => void;
  onQuestionChange: (question: string) => void;
  onSend: () => void;
  onSkipLearningCheck: () => void;
  onSpeakLast: () => void;
  onStopSpeaking: () => void;
  onNewSession: () => void;
  onCloseListenMode: () => void;
  onHearPrompt: () => void;
}) {
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const latestAssistant = visibleMessages.filter((message) => message.role === "assistant").at(-1);
  const latestUser = visibleMessages.filter((message) => message.role === "user").at(-1);
  const [typeOpen, setTypeOpen] = useState(false);
  const traceablePromptMessageId = !activeLearningCheck && latestAssistant?.content.trim() ? latestAssistant.id : null;
  const currentModeLabel = tutorSpeaking
    ? "Phloem is speaking"
    : busy
      ? "Phloem is thinking"
      : activeLearningCheck
        ? "Your turn"
        : "Press the microphone";
  const currentPrompt = activeLearningCheck?.question || latestAssistant?.content || promptText;
  const clampedTextSizeStep = clampListenTextSizeStep(textSizeStep);

  return (
    <main className="listen-shell listen-session-shell listen-one-screen">
      <header className="one-button-topbar">
        <div className="one-button-page-chip">
          <div className="one-button-thumb">
            {selectedMaterial?.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Local camera data URL thumbnail.
              <img src={selectedMaterial.imageDataUrl} alt={selectedMaterial.name} />
            ) : (
              <FileText size={24} aria-hidden />
            )}
          </div>
          <div>
            <strong>{sessionTitle}</strong>
            <span>
              {sessionLanguage}
              {materials.length > 1 ? ` • ${materials.length} pages` : ""}
            </span>
          </div>
        </div>

        <div className="one-button-header-controls">
          <div className="one-button-text-size-controls" aria-label="Tutor text size">
            <button
              type="button"
              onClick={onDecreaseTextSize}
              disabled={clampedTextSizeStep === 0}
              aria-label="Make tutor text smaller"
              title="Make tutor text smaller"
            >
              A-
            </button>
            <button
              type="button"
              onClick={onIncreaseTextSize}
              disabled={clampedTextSizeStep === MAX_LISTEN_TEXT_SIZE_STEP}
              aria-label="Make tutor text bigger"
              title="Make tutor text bigger"
            >
              A+
            </button>
          </div>
        </div>

        <div className="one-button-top-actions">
          <button type="button" onClick={onCloseListenMode}>
            <LayoutDashboard size={18} aria-hidden />
            Dashboard
          </button>
          <button type="button" onClick={onNewSession}>
            <PlusSquare size={18} aria-hidden />
            New page
          </button>
        </div>
      </header>

      <section className="one-button-stage" aria-label="Voice tutor">
        <div className={`one-button-orb ${tutorSpeaking ? "speaking" : ""} ${busy ? "busy" : ""}`}>
          <div className="one-button-mic-wrap">{voiceRecorder}</div>
        </div>

        <div className="one-button-state">
          <span>{currentModeLabel}</span>
        </div>

        <div className="one-button-prompt" data-text-size={clampedTextSizeStep}>
          <div className="one-button-prompt-header">
            <span className="one-button-prompt-label">
              {activeLearningCheck ? "Question" : latestAssistant ? "Phloem said" : "Start here"}
            </span>
          </div>
          <div className="one-button-prompt-text" tabIndex={0}>
            <ListenPromptText text={currentPrompt} messageId={traceablePromptMessageId} speechTrace={speechTrace} />
          </div>
        </div>

        {latestUser && (
          <p className="one-button-last-user">
            You said: <span>{latestUser.content}</span>
          </p>
        )}

        <div className="one-button-actions" aria-label="Helpful actions">
          <button type="button" onClick={onHearPrompt}>
            <Volume2 size={18} aria-hidden />
            Help
          </button>
          <button type="button" onClick={onSpeakLast} disabled={busy}>
            <Volume2 size={18} aria-hidden />
            Repeat
          </button>
          {tutorSpeaking ? (
            <button type="button" onClick={onStopSpeaking}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={() => setTypeOpen((current) => !current)}>
              Type
            </button>
          )}
          {activeLearningCheck?.status === "unanswered" && (
            <button type="button" onClick={onSkipLearningCheck} disabled={busy}>
              Skip
            </button>
          )}
        </div>

        {typeOpen && (
          <div className="one-button-type-row">
            <textarea
              value={question}
              disabled={busy}
              rows={1}
              placeholder="Type instead"
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <button type="button" onClick={onSend} disabled={busy || !question.trim()}>
              Send
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function ListenPromptText({
  text,
  messageId,
  speechTrace
}: {
  text: string;
  messageId: string | null | undefined;
  speechTrace: SpeechTraceState | null;
}) {
  const textRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!messageId || speechTrace?.messageId !== messageId) {
      return;
    }

    const currentWord = textRef.current?.querySelector(".speech-word.current");
    currentWord?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [messageId, speechTrace]);

  if (!messageId || speechTrace?.messageId !== messageId) {
    return <p ref={textRef}>{text}</p>;
  }

  const parts = getSpeechTraceParts(text);

  return (
    <p ref={textRef} className="speech-trace-text">
      {parts.map((part, index) => {
        if (part.wordIndex === null) {
          return part.text;
        }

        const state =
          part.wordIndex < speechTrace.wordIndex
            ? "spoken"
            : part.wordIndex === speechTrace.wordIndex
              ? "current"
              : "pending";

        return (
          <span key={`${part.text}-${index}`} className={`speech-word ${state}`}>
            {part.text}
          </span>
        );
      })}
    </p>
  );
}

function ListenStatus({ status, error }: { status: string; error: string }) {
  if ((!status || status === "Ready") && !error) {
    return null;
  }

  return <p className={error ? "listen-status error" : "listen-status"}>{error || status}</p>;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown size";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function describeMaterialType(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return "Image";
  }

  if (mimeType === "application/pdf") {
    return "PDF";
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "Word document";
  }

  return "File";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0
  }).format(Math.max(0, Math.round(value)));
}

function formatUsageMonth(value: string) {
  const [year, month] = value.split("-").map((part) => Number(part));

  if (!year || !month) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function PendingMaterialsPanel({
  materials,
  busy,
  onRemove,
  onStart
}: {
  materials: PendingMaterial[];
  busy: boolean;
  onRemove: (id: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="pending-materials-panel">
      <div className="pending-materials-header">
        <div>
          <h3>Ready to process</h3>
          <p>
            {materials.length} material{materials.length === 1 ? "" : "s"} added
          </p>
        </div>
        <button className="session-primary-button" type="button" onClick={onStart} disabled={busy}>
          <PlayCircle size={17} aria-hidden />
          Start learning session
        </button>
      </div>

      <div className="pending-materials-list">
        {materials.map((material) => (
          <div className="pending-material-card" key={material.id}>
            <span className="pending-material-icon">
              <FileText size={20} aria-hidden />
            </span>
            <div>
              <strong>{material.name}</strong>
              <small>
                {describeMaterialType(material.mimeType)} • {formatBytes(material.size)}
              </small>
            </div>
            <button
              className="pending-remove-button"
              type="button"
              onClick={() => onRemove(material.id)}
              disabled={busy}
              aria-label={`Remove ${material.name}`}
            >
              <X size={17} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSessionDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function isScoredLearningCheck(check: LearningCheck): check is LearningCheck & { status: LearningCheckStatus } {
  return isScoredLearningCheckStatus(check.status);
}

function isActiveLearningCheck(check: LearningCheck): check is ActiveLearningCheck {
  return check.status === "unanswered" || check.status === "checking";
}

function mergeLearningChecks(persistedChecks: LearningCheck[], cachedChecks: LearningCheck[]) {
  const merged = new Map<string, LearningCheck>();

  for (const check of cachedChecks) {
    merged.set(check.id, check);
  }

  for (const check of persistedChecks) {
    const existing = merged.get(check.id);
    merged.set(check.id, existing ? pickMoreCompleteLearningCheck(check, existing) : check);
  }

  return Array.from(merged.values()).sort(
    (first, second) => getLearningCheckTime(second) - getLearningCheckTime(first)
  );
}

function mergeConceptMasteries(persistedMasteries: ConceptMastery[], cachedMasteries: ConceptMastery[]) {
  const merged = new Map<string, ConceptMastery>();

  for (const mastery of cachedMasteries) {
    merged.set(getConceptMasteryKey(mastery.concept, mastery.materialId), mastery);
  }

  for (const mastery of persistedMasteries) {
    const key = getConceptMasteryKey(mastery.concept, mastery.materialId);
    const existing = merged.get(key);
    merged.set(key, existing ? pickNewerConceptMastery(mastery, existing) : mastery);
  }

  return sortConceptMasteries(Array.from(merged.values()));
}

function pickMoreCompleteLearningCheck(first: LearningCheck, second: LearningCheck) {
  const firstPriority = getLearningCheckStatusPriority(first);
  const secondPriority = getLearningCheckStatusPriority(second);

  if (firstPriority !== secondPriority) {
    return firstPriority > secondPriority ? first : second;
  }

  return getLearningCheckTime(first) >= getLearningCheckTime(second) ? first : second;
}

function pickNewerConceptMastery(first: ConceptMastery, second: ConceptMastery) {
  const firstTime = new Date(first.updatedAt).getTime();
  const secondTime = new Date(second.updatedAt).getTime();

  if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
    return firstTime > secondTime ? first : second;
  }

  return first.attempts >= second.attempts ? first : second;
}

function getLearningCheckStatusPriority(check: LearningCheck) {
  if (isScoredLearningCheck(check)) {
    return 2;
  }

  return check.status === "checking" ? 1 : 0;
}

function getLearningCheckTime(check: LearningCheck) {
  const time = new Date(check.answeredAt ?? check.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortConceptMasteries(masteries: ConceptMastery[]) {
  return [...masteries].sort((first, second) => {
    const firstReview = first.nextReviewAt ? new Date(first.nextReviewAt).getTime() : Number.POSITIVE_INFINITY;
    const secondReview = second.nextReviewAt ? new Date(second.nextReviewAt).getTime() : Number.POSITIVE_INFINITY;

    if (firstReview !== secondReview) {
      return firstReview - secondReview;
    }

    return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  });
}

function mergeConceptMastery(current: ConceptMastery[], next: ConceptMastery) {
  const nextKey = getConceptMasteryKey(next.concept, next.materialId);
  const merged = current.filter((item) => getConceptMasteryKey(item.concept, item.materialId) !== nextKey);

  return sortConceptMasteries([next, ...merged]);
}

function updateConceptMasteriesFromCheck(
  current: ConceptMastery[],
  check: LearningCheck & { status: LearningCheckStatus },
  sessionId: string | null
) {
  const key = getConceptMasteryKey(check.concept, check.materialId);
  const previous = current.find((item) => getConceptMasteryKey(item.concept, item.materialId) === key) ?? null;
  const now = new Date(check.answeredAt ?? check.createdAt);
  const next = updateConceptMasteryForResult({
    previous,
    sessionId,
    concept: check.concept,
    materialId: check.materialId,
    status: check.status,
    now: Number.isNaN(now.getTime()) ? new Date() : now
  });

  return mergeConceptMastery(current, {
    ...next,
    nextReviewAt: check.nextReviewAt ?? next.nextReviewAt
  });
}

function buildConceptMasteriesFromChecks(checks: LearningCheck[], sessionId: string | null) {
  return checks
    .filter(isScoredLearningCheck)
    .sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime())
    .reduce<ConceptMastery[]>(
      (current, check) => updateConceptMasteriesFromCheck(current, check, sessionId),
      []
    );
}

function SessionsScreen({
  sessions,
  currentSessionId,
  loading,
  error,
  supabaseConfigured,
  onRefresh,
  onOpen,
  onDelete,
  onNewSession
}: {
  sessions: SavedSessionSummary[];
  currentSessionId: string | null;
  loading: boolean;
  error: string;
  supabaseConfigured: boolean;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSession: () => void;
}) {
  return (
    <div className="sessions-screen">
      <div className="sessions-screen-header">
        <div>
          <p className="settings-eyebrow">History</p>
          <h2>Saved sessions</h2>
          <p>Open a previous learning session and continue the same tutor conversation.</p>
        </div>
        <div className="sessions-header-actions">
          <button className="session-action-button" type="button" onClick={onRefresh} disabled={loading}>
            <Clock size={17} aria-hidden />
            Refresh
          </button>
          <button className="session-primary-button" type="button" onClick={onNewSession}>
            <PlusSquare size={17} aria-hidden />
            New Session
          </button>
        </div>
      </div>

      {!supabaseConfigured && (
        <div className="sessions-empty">
          <h3>Supabase is not connected</h3>
          <p>Add the Supabase env vars and restart the app to save and load session history.</p>
        </div>
      )}

      {error && <div className="sessions-error">{error}</div>}

      {loading ? (
        <div className="sessions-loading">
          <span className="processing-spinner" aria-hidden />
          Loading saved sessions...
        </div>
      ) : sessions.length > 0 ? (
        <div className="sessions-list">
          {sessions.map((session) => (
            <article
              key={session.id}
              className={`saved-session-card ${session.id === currentSessionId ? "active" : ""}`}
            >
              <button className="saved-session-open" type="button" onClick={() => onOpen(session.id)}>
                <span className="saved-session-icon">
                  <MessageSquare size={20} aria-hidden />
                </span>
                <span className="saved-session-main">
                  <strong>{session.title || "Learning session"}</strong>
                  <small>
                    {session.materialCount} material{session.materialCount === 1 ? "" : "s"} • {session.messageCount}{" "}
                    message{session.messageCount === 1 ? "" : "s"}
                  </small>
                </span>
                <span className="saved-session-meta">
                  <Clock size={14} aria-hidden />
                  {formatSessionDate(session.updatedAt || session.createdAt)}
                </span>
              </button>
              <button
                className="saved-item-delete-button"
                type="button"
                onClick={() => onDelete(session.id)}
                aria-label={`Delete ${session.title || "learning session"}`}
              >
                <Trash2 size={16} aria-hidden />
                Delete
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="sessions-empty">
          <h3>No saved sessions yet</h3>
          <p>Start a learning session from an upload or sample material, then come back here to reopen it.</p>
        </div>
      )}
    </div>
  );
}

function MaterialsScreen({
  materials,
  currentSessionId,
  loading,
  error,
  supabaseConfigured,
  onRefresh,
  onOpenSession,
  onDelete,
  onNewSession
}: {
  materials: SavedMaterial[];
  currentSessionId: string | null;
  loading: boolean;
  error: string;
  supabaseConfigured: boolean;
  onRefresh: () => void;
  onOpenSession: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSession: () => void;
}) {
  return (
    <div className="materials-screen">
      <div className="sessions-screen-header">
        <div>
          <p className="settings-eyebrow">Library</p>
          <h2>Materials</h2>
          <p>Review uploaded images, PDFs, and Word documents from saved learning sessions.</p>
        </div>
        <div className="sessions-header-actions">
          <button className="session-action-button" type="button" onClick={onRefresh} disabled={loading}>
            <Clock size={17} aria-hidden />
            Refresh
          </button>
          <button className="session-primary-button" type="button" onClick={onNewSession}>
            <PlusSquare size={17} aria-hidden />
            New Session
          </button>
        </div>
      </div>

      {!supabaseConfigured && (
        <div className="sessions-empty">
          <h3>Supabase is not connected</h3>
          <p>Add the Supabase env vars and restart the app to save uploaded files in the materials library.</p>
        </div>
      )}

      {error && <div className="sessions-error">{error}</div>}

      {loading ? (
        <div className="sessions-loading">
          <span className="processing-spinner" aria-hidden />
          Loading saved materials...
        </div>
      ) : materials.length > 0 ? (
        <div className="materials-library-grid">
          {materials.map((material) => {
            const isImage = material.mimeType.startsWith("image/");
            const sessionTitle = material.session?.title || material.learningContext.topic || "Learning session";

            return (
              <article className="material-library-card" key={material.id}>
                <div className="material-library-preview">
                  {isImage && material.viewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Signed Supabase URL for user-uploaded material preview.
                    <img src={material.viewUrl} alt={material.name} />
                  ) : (
                    <span className="material-library-file-icon">
                      <FileText size={34} aria-hidden />
                    </span>
                  )}
                  <span className="material-library-type">{describeMaterialType(material.mimeType)}</span>
                </div>

                <div className="material-library-body">
                  <div>
                    <strong>{material.name}</strong>
                    <small>
                      {sessionTitle} • {formatSessionDate(material.createdAt)}
                    </small>
                  </div>

                  <p>{material.learningContext.summary || material.learningContext.topic}</p>

                  <div className="material-library-actions">
                    {material.viewUrl ? (
                      <a className="material-action-link" href={material.viewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} aria-hidden />
                        Open
                      </a>
                    ) : (
                      <button className="material-action-link" type="button" disabled>
                        <ExternalLink size={16} aria-hidden />
                        Open
                      </button>
                    )}

                    {material.downloadUrl ? (
                      <a
                        className="material-action-link primary"
                        href={material.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        download={material.name}
                      >
                        <Download size={16} aria-hidden />
                        Download
                      </a>
                    ) : (
                      <button className="material-action-link primary" type="button" disabled>
                        <Download size={16} aria-hidden />
                        Download
                      </button>
                    )}

                    {material.session && (
                      <button
                        className={`material-action-link ${material.session.id === currentSessionId ? "active" : ""}`}
                        type="button"
                        onClick={() => onOpenSession(material.session!.id)}
                      >
                        <MessageSquare size={16} aria-hidden />
                        Session
                      </button>
                    )}

                    <button
                      className="material-action-link danger"
                      type="button"
                      onClick={() => onDelete(material.id)}
                      aria-label={`Delete ${material.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="sessions-empty">
          <h3>No saved materials yet</h3>
          <p>Start a learning session from an upload, camera photo, pasted image, or link to save it here.</p>
        </div>
      )}
    </div>
  );
}

function ProgressScreen({
  checks,
  masteries,
  activeCheck,
  hasMaterials,
  onOpenLearn,
  onPracticeConcept
}: {
  checks: LearningCheck[];
  masteries: ConceptMastery[];
  activeCheck: LearningCheck | null;
  hasMaterials: boolean;
  onOpenLearn: () => void;
  onPracticeConcept: (concept: string) => void;
}) {
  const scoredChecks = checks.filter(isScoredLearningCheck);
  const gotItCount = scoredChecks.filter((check) => check.status === "got-it").length;
  const needsPracticeCount = scoredChecks.filter((check) => check.status === "needs-practice").length;
  const confusedCount = scoredChecks.filter((check) => check.status === "confused").length;
  const accuracyPercent = scoredChecks.length > 0 ? Math.round((gotItCount / scoredChecks.length) * 100) : 0;
  const conceptMap = new Map<string, LearningCheck[]>();

  for (const check of scoredChecks) {
    const key = getConceptMasteryKey(check.concept, check.materialId);
    conceptMap.set(key, [...(conceptMap.get(key) ?? []), check]);
  }

  const masteryMap = new Map(masteries.map((mastery) => [getConceptMasteryKey(mastery.concept, mastery.materialId), mastery]));
  const conceptKeys = Array.from(new Set([...masteryMap.keys(), ...conceptMap.keys()]));
  const concepts = conceptKeys.map((key) => {
    const mastery = masteryMap.get(key) ?? null;
    const conceptChecks = conceptMap.get(key) ?? [];
    const latest = conceptChecks[0] ?? null;
    const attempts = mastery?.attempts ?? conceptChecks.length;

    return {
      key,
      concept: mastery?.concept ?? latest?.concept ?? "Current concept",
      checks: conceptChecks,
      latest,
      attempts,
      status: mastery?.lastStatus ?? latest?.status ?? "needs-practice"
    };
  });

  return (
    <div className="progress-screen">
      <div className="sessions-screen-header">
        <div>
          <p className="settings-eyebrow">Retrieval practice</p>
          <h2>Learning progress</h2>
          <p>Progress is based on answers to tutor check questions, not on model-estimated understanding.</p>
        </div>
        <div className="sessions-header-actions">
          <button className="session-primary-button" type="button" onClick={onOpenLearn}>
            <PlayCircle size={17} aria-hidden />
            {hasMaterials ? "Back to session" : "Start learning"}
          </button>
        </div>
      </div>

      {activeCheck && (
        <section className="progress-active-card">
          <div>
            <span>Current check</span>
            <h3>{activeCheck.question}</h3>
            <p>Your next voice or text reply will tag this concept in progress.</p>
          </div>
          <strong>{activeCheck.concept}</strong>
        </section>
      )}

      <div className="progress-stats-grid">
        <div className="progress-stat-card">
          <span>Answered checks</span>
          <strong>{scoredChecks.length}</strong>
        </div>
        <div className="progress-stat-card got-it">
          <span>Got it</span>
          <strong>{gotItCount}</strong>
        </div>
        <div className="progress-stat-card needs-practice">
          <span>Needs practice</span>
          <strong>{needsPracticeCount}</strong>
        </div>
        <div className="progress-stat-card confused">
          <span>Confused</span>
          <strong>{confusedCount}</strong>
        </div>
      </div>

      {checks.length === 0 && masteries.length === 0 ? (
        <div className="sessions-empty">
          <h3>No progress checks yet</h3>
          <p>
            Ask the tutor a question. After it replies, answer the follow-up question to build a concept-by-concept
            progress record.
          </p>
        </div>
      ) : (
        <>
          <section className="progress-summary-card">
            <div>
              <span>Current score</span>
              <strong>{accuracyPercent}%</strong>
              <p>Based on answers to tutor check questions.</p>
            </div>
            <div className="progress-meter" aria-label={`${accuracyPercent}% got it`}>
              <span style={{ width: `${accuracyPercent}%` }} />
            </div>
          </section>

          {concepts.length > 0 ? (
            <div className="progress-concept-grid">
              {concepts.map((item) => (
                <article className={`progress-concept-card ${item.status}`} key={item.key}>
                  <div className="progress-concept-header">
                    <div>
                      <h3>{item.concept}</h3>
                      <p>{item.attempts} attempt{item.attempts === 1 ? "" : "s"} tracked</p>
                    </div>
                    <span className={`progress-status-pill ${item.status}`}>
                      {getLearningCheckStatusLabel(item.status)}
                    </span>
                  </div>
                  <p className="progress-question">
                    {item.latest?.question ?? "Concept mastery was restored from saved progress."}
                  </p>
                  <p className="progress-feedback">{item.latest?.feedback || "No feedback yet."}</p>
                  {hasMaterials && (
                    <button
                      className="material-action-link primary"
                      type="button"
                      onClick={() => onPracticeConcept(item.concept)}
                    >
                      <HelpCircle size={16} aria-hidden />
                      Practice
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="sessions-empty">
              <h3>One check is waiting</h3>
              <p>Answer the current tutor question in the conversation to turn it into a progress tag.</p>
            </div>
          )}

          <section className="progress-history-card">
            <div className="settings-card-title">
              <Clock size={20} aria-hidden />
              <div>
                <h3>Recent checks</h3>
                <p>Each row is based on a learner answer to one retrieval question.</p>
              </div>
            </div>
            <div className="progress-history-list">
              {checks.slice(0, 8).map((check) => (
                <div className="progress-history-row" key={check.id}>
                  <span className={`progress-status-dot ${check.status}`} aria-hidden />
                  <div>
                    <strong>{check.concept}</strong>
                    <small>{check.answer || check.question}</small>
                  </div>
                  <span className={`progress-status-pill ${check.status}`}>
                    {getLearningCheckStatusLabel(check.status)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SettingsScreen({
  targetLanguage,
  sourceLanguage,
  allowDirectAnswer,
  ttsVoiceStyle,
  ttsSpeechRate,
  ttsProvider,
  ttsUsage,
  ttsUsageLoading,
  ttsUsageError,
  busy,
  onTargetLanguageChange,
  onSourceLanguageChange,
  onAllowDirectAnswerChange,
  onTtsVoiceStyleChange,
  onTtsSpeechRateChange,
  onRefreshTtsUsage
}: {
  targetLanguage: string;
  sourceLanguage: string;
  allowDirectAnswer: boolean;
  ttsVoiceStyle: TtsVoiceStyle;
  ttsSpeechRate: number;
  ttsProvider: string;
  ttsUsage: TtsUsageResponse | null;
  ttsUsageLoading: boolean;
  ttsUsageError: string;
  busy: boolean;
  onTargetLanguageChange: (value: string) => void;
  onSourceLanguageChange: (value: string) => void;
  onAllowDirectAnswerChange: (checked: boolean) => void;
  onTtsVoiceStyleChange: (value: TtsVoiceStyle) => void;
  onTtsSpeechRateChange: (value: number) => void;
  onRefreshTtsUsage: () => void;
}) {
  const activeTtsLabel =
    ttsProvider === "google" ? "Google Chirp 3 HD" : ttsProvider === "openai" ? "OpenAI TTS" : "Browser speech";
  const usageCharacters = ttsUsage?.characters ?? 0;
  const requestCount = ttsUsage?.requests ?? 0;
  const freeTierCharacters = ttsUsage?.freeTierCharacters ?? 0;
  const usagePercent = ttsUsage?.usagePercent ?? 0;
  const remainingCharacters = ttsUsage?.remainingFreeTierCharacters ?? 0;
  const usageMonth = ttsUsage?.month ? formatUsageMonth(ttsUsage.month) : "Current month";

  return (
    <div className="settings-screen">
      <div className="settings-screen-header">
        <p className="settings-eyebrow">Preferences</p>
        <h2>Settings</h2>
        <p>Configure how Phloem reads material and how the tutor should respond.</p>
      </div>

      <div className="settings-screen-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <Globe size={20} aria-hidden />
            <div>
              <h3>Language</h3>
              <p>Choose the tutoring language and source-language detection.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Tutor language</span>
            <select
              value={targetLanguage}
              disabled={busy}
              onChange={(event) => onTargetLanguageChange(event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh-CN">Chinese</option>
              <option value="es">Spanish</option>
              <option value="hi">Hindi</option>
              <option value="ms">Malay</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Source language</span>
            <select
              value={sourceLanguage}
              disabled={busy}
              onChange={(event) => onSourceLanguageChange(event.target.value)}
            >
              <option value="auto">Auto detect</option>
              <option value="en">English</option>
              <option value="zh">Chinese</option>
              <option value="es">Spanish</option>
              <option value="hi">Hindi</option>
              <option value="ms">Malay</option>
            </select>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <Settings size={20} aria-hidden />
            <div>
              <h3>Tutor behavior</h3>
              <p>Keep the tutor guided by default, with direct answers only when allowed.</p>
            </div>
          </div>

          <label className="settings-toggle-row">
            <input
              type="checkbox"
              checked={allowDirectAnswer}
              disabled={busy}
              onChange={(event) => onAllowDirectAnswerChange(event.target.checked)}
            />
            <span>
              <strong>Allow direct answers</strong>
              <small>Use this when the learner explicitly asks for the final answer.</small>
            </span>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <Volume2 size={20} aria-hidden />
            <div>
              <h3>Tutor voice</h3>
              <p>Choose the spoken voice style used for tutor replies.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Voice style</span>
            <select
              value={ttsVoiceStyle}
              disabled={busy}
              onChange={(event) => onTtsVoiceStyleChange(event.target.value as TtsVoiceStyle)}
            >
              <option value="male">Warm male</option>
              <option value="female">Warm female</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Speech speed</span>
            <div className="settings-range-row">
              <input
                type="range"
                min={MIN_TTS_SPEECH_RATE}
                max={MAX_TTS_SPEECH_RATE}
                step="0.05"
                value={ttsSpeechRate}
                disabled={busy}
                onChange={(event) => onTtsSpeechRateChange(Number(event.target.value))}
              />
              <strong>{ttsSpeechRate.toFixed(2)}x</strong>
            </div>
            <small className="settings-field-note">Applies to replay, browser speech, MP3, and streaming voice.</small>
          </label>
        </section>

        <section className="settings-card wide">
          <div className="settings-card-title">
            <BarChart3 size={20} aria-hidden />
            <div>
              <h3>TTS usage</h3>
              <p>Track characters sent to the active speech provider this month.</p>
            </div>
          </div>

          <div className="tts-usage-header">
            <div>
              <span>Active provider</span>
              <strong>{activeTtsLabel}</strong>
            </div>
            <button
              className="session-action-button"
              type="button"
              onClick={onRefreshTtsUsage}
              disabled={ttsUsageLoading}
            >
              <Clock size={17} aria-hidden />
              {ttsUsageLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {freeTierCharacters > 0 ? (
            <>
              <div className="tts-usage-meter" aria-label={`${formatNumber(usagePercent)}% of free tier used`}>
                <span style={{ width: `${usagePercent}%` }} />
              </div>

              <div className="tts-usage-stats">
                <span>
                  <strong>{formatNumber(usageCharacters)}</strong>
                  <small>characters used in {usageMonth}</small>
                </span>
                <span>
                  <strong>{formatNumber(remainingCharacters)}</strong>
                  <small>free characters remaining</small>
                </span>
                <span>
                  <strong>{formatNumber(requestCount)}</strong>
                  <small>TTS request{requestCount === 1 ? "" : "s"}</small>
                </span>
              </div>
            </>
          ) : (
            <div className="settings-note">
              Google free-tier tracking appears here after `TTS_PROVIDER=google` is active and the app has loaded
              usage from Supabase.
            </div>
          )}

          {ttsUsageError && <div className="settings-warning">{ttsUsageError}</div>}
        </section>

        <section className="settings-card wide">
          <div className="settings-card-title">
            <Folder size={20} aria-hidden />
            <div>
              <h3>Saved sessions</h3>
              <p>When Supabase is configured, sessions, materials, messages, and progress checks are saved.</p>
            </div>
          </div>

          <div className="settings-note">
            This build uses one owner key for now. Later we can add Supabase Auth and row-level security without
            changing the main learning flow.
          </div>
        </section>
      </div>
    </div>
  );
}

function ProcessingOverlay({ label }: { label: string }) {
  return (
    <div className="processing-overlay" role="status" aria-live="polite">
      <div className="processing-card">
        <span className="processing-spinner" aria-hidden />
        <p>{label || "Processing material..."}</p>
      </div>
    </div>
  );
}
