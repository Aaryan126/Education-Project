"use client";

import {
  Check,
  CircleHelp,
  Copy,
  Lightbulb,
  List,
  Lock,
  Pencil,
  Send,
  Sparkles,
  Square,
  Volume2,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getSpeechTraceParts } from "@/lib/speech/trace";
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
  activeLearningCheck: ActiveLearningCheck | null;
  quickActions: Array<{
    label: string;
    text: string;
  }>;
  voiceRecorder: ReactNode;
  onQuestionChange: (question: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onSend: () => void;
  onQuickAction: (text: string) => void;
  onSkipLearningCheck: () => void;
  onStopResponding: () => void;
  onStopSpeaking: () => void;
  onSpeakLast: () => void;
};

type ActiveLearningCheck = {
  concept: string;
  question: string;
  status: "unanswered" | "checking";
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

const SPEECH_TRACE_FORWARD_WORDS = 0;

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
  activeLearningCheck,
  quickActions,
  voiceRecorder,
  onQuestionChange,
  onEditMessage,
  onSend,
  onQuickAction,
  onSkipLearningCheck,
  onStopResponding,
  onStopSpeaking,
  onSpeakLast
}: ConversationPanelProps) {
  const conversationBodyRef = useRef<HTMLDivElement | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
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

  function beginEdit(message: ConversationMessage) {
    if (!message.id || busy) {
      return;
    }

    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  function saveEdit() {
    if (!editingMessageId || !editingDraft.trim()) {
      return;
    }

    onEditMessage(editingMessageId, editingDraft);
    cancelEdit();
  }

  async function copyMessage(message: ConversationMessage) {
    if (!message.id) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = message.content;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();

      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (!copied) {
        return;
      }
    }
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1400);
  }

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
                {editingMessageId === message.id ? (
                  <div className="message-edit">
                    <textarea
                      value={editingDraft}
                      autoFocus
                      rows={Math.min(8, Math.max(3, editingDraft.split("\n").length))}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          saveEdit();
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />
                    <div className="message-edit-actions">
                      <button type="button" onClick={saveEdit} disabled={!editingDraft.trim()}>
                        <Check size={14} aria-hidden />
                        Save
                      </button>
                      <button type="button" onClick={cancelEdit}>
                        <X size={14} aria-hidden />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="message-content">
                      <MessageContent message={message} speechTrace={speechTrace} />
                    </div>
                    <div className="message-actions" aria-label={`${message.role} message actions`}>
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        disabled={!message.id}
                        title="Copy message"
                        aria-label="Copy message"
                      >
                        <Copy size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEdit(message)}
                        disabled={!message.id || busy}
                        title="Edit message"
                        aria-label="Edit message"
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                    </div>
                  </>
                )}
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
        {activeLearningCheck && (
          <div className="learning-check-banner">
            <div>
              <span>{activeLearningCheck.status === "checking" ? "Checking answer" : "Progress check"}</span>
              <strong>{activeLearningCheck.question}</strong>
              <p>
                {activeLearningCheck.status === "checking"
                  ? "Phloem is scoring this answer from your reply."
                  : `Your next reply updates progress for ${activeLearningCheck.concept}.`}
              </p>
            </div>
            {activeLearningCheck.status === "unanswered" && (
              <button type="button" onClick={onSkipLearningCheck} disabled={busy}>
                Skip
              </button>
            )}
          </div>
        )}

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

  const parts = getSpeechTraceParts(message.content);
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
