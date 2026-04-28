"use client";

import { CircleHelp, Lightbulb, List, Lock, Send, Sparkles, Square, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ConversationMessage, UnderstandingLevel } from "@/lib/tutor/types";

type ConversationPanelProps = {
  messages: ConversationMessage[];
  question: string;
  busy: boolean;
  status: string;
  error: string;
  responseStopped: boolean;
  tutorSpeaking: boolean;
  speechTrace: SpeechTraceState | null;
  understandingLevel: UnderstandingLevel;
  quickActions: Array<{
    label: string;
    text: string;
  }>;
  voiceRecorder: ReactNode;
  onQuestionChange: (question: string) => void;
  onSend: () => void;
  onQuickAction: (text: string) => void;
  onStopResponding: () => void;
  onStopSpeaking: () => void;
  onSpeakLast: () => void;
};

export type SpeechTraceState = {
  messageId: string;
  wordIndex: number;
  totalWords: number;
};

const UNDERSTANDING_LABELS: Record<UnderstandingLevel, string> = {
  low: "Building",
  medium: "Progressing",
  high: "Confident"
};

const SPEECH_TRACE_FORWARD_WORDS = 3;

type BrowserSegment = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

type BrowserSegmenter = {
  segment(input: string): Iterable<BrowserSegment>;
};

type BrowserSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "word" | "sentence" | "grapheme" }
) => BrowserSegmenter;

type TracePart = {
  text: string;
  wordIndex: number | null;
};

export function ConversationPanel({
  messages,
  question,
  busy,
  status,
  error,
  responseStopped,
  tutorSpeaking,
  speechTrace,
  understandingLevel,
  quickActions,
  voiceRecorder,
  onQuestionChange,
  onSend,
  onQuickAction,
  onStopResponding,
  onStopSpeaking,
  onSpeakLast
}: ConversationPanelProps) {
  const conversationBodyRef = useRef<HTMLDivElement | null>(null);
  const tutorIsThinking = status.startsWith("Tutor is thinking");
  const tutorIsPreparingVoice = status.startsWith("Preparing voice") || status.startsWith("Preparing speech");
  const tutorSpeechStatus =
    tutorIsPreparingVoice || status.startsWith("Playing") || status === "Tutor speech stopped";
  const canStopResponse = busy && tutorIsThinking;
  const showStatus = Boolean(error || (busy && tutorIsThinking) || responseStopped || tutorSpeaking || tutorSpeechStatus);
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const latestMessage = visibleMessages[visibleMessages.length - 1];
  const showTyping = busy && (tutorIsThinking || tutorIsPreparingVoice) && visibleMessages.length > 0;

  useEffect(() => {
    const body = conversationBodyRef.current;

    if (!body) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [latestMessage?.id, latestMessage?.content, showTyping, tutorSpeaking, responseStopped, error]);

  useEffect(() => {
    const body = conversationBodyRef.current;

    if (!body || !speechTrace) {
      return;
    }

    const currentWord = body.querySelector(".speech-word.current");
    currentWord?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [speechTrace]);

  return (
    <section
      className="panel conversation-panel"
      aria-label={`Tutor conversation, ${UNDERSTANDING_LABELS[understandingLevel]} understanding`}
    >
      <div className="conversation-header">
        <div className="conversation-title-group">
          <span className="tutor-avatar" aria-hidden>
            <Sparkles size={22} />
          </span>
          <div>
            <h2 className="panel-title">Tutor Conversation</h2>
            <p>AI Tutor</p>
          </div>
        </div>
        <div className="conversation-header-right">
          <button
            className="button ghost"
            type="button"
            onClick={onSpeakLast}
            disabled={busy}
            title="Replay last response"
            aria-label="Replay last response"
          >
            <Volume2 size={17} aria-hidden />
            Replay
          </button>
          {tutorSpeaking && (
            <button
              className="button danger"
              type="button"
              onClick={onStopSpeaking}
              title="Stop tutor voice"
              aria-label="Stop tutor voice"
            >
              <Square size={16} aria-hidden />
              Stop voice
            </button>
          )}
        </div>
      </div>

      <div ref={conversationBodyRef} className="conversation-body conversation" role="log" aria-live="polite">
        {visibleMessages.length === 0 ? (
          <div className="conversation-intro-bubble">
            I&apos;ve analyzed your material. What would you like to learn about?
          </div>
        ) : (
          <>
            {visibleMessages.map((message, index) => (
              <div key={message.id || `${message.role}-${index}`} className={`message ${message.role}`}>
                <MessageContent message={message} speechTrace={speechTrace} />
              </div>
            ))}

            {showTyping && (
              <div className="typing-indicator" aria-label="Tutor is typing">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="composer">
        <div className="quick-actions" aria-label="Quick tutor actions">
          {canStopResponse && (
            <button className="stop-response-chip" type="button" onClick={onStopResponding}>
              <Square size={15} aria-hidden />
              Stop response
            </button>
          )}
          {quickActions.map((action) => (
            <button
              key={action.label}
              className="quick-action-chip"
              type="button"
              disabled={busy}
              onClick={() => onQuickAction(action.text)}
            >
              {action.label.toLowerCase().includes("hint") ? (
                <Lightbulb size={17} aria-hidden />
              ) : action.label.toLowerCase().includes("summar") ? (
                <List size={17} aria-hidden />
              ) : action.label.toLowerCase().includes("question") ? (
                <CircleHelp size={17} aria-hidden />
              ) : (
                <Sparkles size={17} aria-hidden />
              )}
              {action.label}
            </button>
          ))}
        </div>

        <div className="composer-input-row">
          <textarea
            className="text-area"
            value={question}
            placeholder="Ask a question, request a hint, or answer..."
            disabled={busy}
            rows={1}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          <button
            className="send-button"
            type="button"
            onClick={onSend}
            disabled={busy || !question.trim()}
            title="Send message"
            aria-label="Send message"
          >
            <Send size={18} aria-hidden />
          </button>

          {voiceRecorder}
        </div>

        {showStatus && (
          <div className={error ? "status-text error" : "status-text"}>
            {responseStopped && !error ? (
              "Tutor response stopped"
            ) : busy && (tutorIsThinking || tutorIsPreparingVoice) && !error ? (
              <>
                <span className="spinner" /> {status}
              </>
            ) : error || status}
          </div>
        )}

        <p className="composer-footnote">
          <Lock size={14} aria-hidden />
          Your conversations are private and secure.
          <button type="button">Learn more</button>
        </p>
      </div>
    </section>
  );
}

function MessageContent({
  message,
  speechTrace
}: {
  message: ConversationMessage;
  speechTrace: SpeechTraceState | null;
}) {
  if (message.role !== "assistant" || !message.id || speechTrace?.messageId !== message.id) {
    return <>{message.content}</>;
  }

  const parts = getTraceParts(message.content);
  const currentPhraseStart = speechTrace.wordIndex;
  const currentPhraseEnd = Math.min(speechTrace.totalWords - 1, currentPhraseStart + SPEECH_TRACE_FORWARD_WORDS);

  return (
    <span className="speech-trace-text">
      {parts.map((part, index) => {
        if (part.wordIndex === null) {
          return part.text;
        }

        const state =
          part.wordIndex < currentPhraseStart
            ? "spoken"
            : part.wordIndex <= currentPhraseEnd
              ? "current"
              : "pending";

        return (
          <span key={`${part.text}-${index}`} className={`speech-word ${state}`}>
            {part.text}
          </span>
        );
      })}
    </span>
  );
}

function getTraceParts(text: string): TracePart[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: BrowserSegmenterConstructor }).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: "word" });
    let wordIndex = 0;

    return Array.from(segmenter.segment(text), (part) => {
      if (!isTraceableSegment(part.segment, part.isWordLike)) {
        return { text: part.segment, wordIndex: null };
      }

      const nextPart = { text: part.segment, wordIndex };
      wordIndex += 1;
      return nextPart;
    });
  }

  let wordIndex = 0;

  return (text.match(/\s+|\S+/g) ?? [text]).map((part) => {
    if (/^\s+$/.test(part)) {
      return { text: part, wordIndex: null };
    }

    const nextPart = { text: part, wordIndex };
    wordIndex += 1;
    return nextPart;
  });
}

function isTraceableSegment(segment: string, isWordLike?: boolean) {
  if (isWordLike) {
    return true;
  }

  return /\S/.test(segment) && /[\p{L}\p{N}]/u.test(segment);
}
