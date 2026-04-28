# Architecture

## App Shell

The main client experience lives in `src/app/page.tsx`. It owns session state, material processing, conversation state, TTS playback, speech tracing, and settings panels.

`src/components/CameraCapture.tsx` handles material input. `src/components/ConversationPanel.tsx` renders messages, auto-scrolls the transcript, highlights the active phrase during speech playback, and provides per-message copy/edit controls. `src/components/VoiceRecorder.tsx` manages hands-free microphone capture.

Learning progress state is also owned by `src/app/page.tsx`. A pending retrieval check is created only after the assistant message has been revealed and speech playback has completed. The next learner reply is evaluated, tagged to a concept, and surfaced in the Progress screen.

## Server Routes

- `/api/vision/extract`: extracts learning context from images and documents.
- `/api/tutor/respond`: calls the configured tutor LLM.
- `/api/tutor/evaluate`: scores one retrieval-practice answer as got it, needs practice, or confused.
- `/api/speech/transcribe`: transcribes captured voice input.
- `/api/speech/synthesize`: returns non-streamed TTS audio.
- `/api/speech/synthesize/stream`: streams PCM TTS audio for faster playback startup.
- `/api/speech/turn`: runs Smart Turn or falls back to VAD-only endpointing.
- `/api/sessions`, `/api/materials`, `/api/usage/tts`: Supabase-backed persistence and usage tracking.
- `/api/progress/checks`: upserts and deletes saved learning checks for persisted sessions.
- `PATCH /api/sessions/messages`: updates edited message text for saved sessions.

## Hands-Free Voice Flow

1. `VoiceRecorder` starts `@ricky0123/vad-web` with Silero VAD assets served from `/vad`.
2. VAD detects speech start/end in the browser and returns 16 kHz mono audio for each speech segment.
3. On pause, the browser posts PCM16 audio to `/api/speech/turn`.
4. `src/lib/speech/smartTurn.ts` checks a configured Smart Turn endpoint first. If none is configured, it starts `scripts/smart_turn_worker.py`.
5. The Python worker converts PCM to Whisper features and runs `smart-turn-v3.2-cpu.onnx`.
6. If Smart Turn says the user is not finished, the client waits for more speech. After a longer silence fallback, it submits the accumulated audio anyway.
7. Complete turns are transcribed and submitted to the tutor automatically.

If Smart Turn is disabled or unavailable, `/api/speech/turn` returns a VAD fallback result so hands-free mode still works.

## Speech Output

TTS is centralized in `src/lib/speech/tts.ts`. Browser TTS is the default fallback. Google and OpenAI can produce streaming PCM through `/api/speech/synthesize/stream`, which lets playback begin before the full response is generated. Usage tracking for paid providers is stored in `tts_usage_months`.

The Settings screen owns a speech-speed preference. The client applies it at playback time through `HTMLAudioElement.playbackRate` for MP3 audio, `AudioBufferSourceNode.playbackRate` for streaming PCM chunks, and `SpeechSynthesisUtterance.rate` for browser speech. Speech tracing scales provider timings and estimated durations to match the selected rate.

Speech tracing in the UI is estimated from text segmentation and audio playback progress. The UI highlights a short phrase window rather than a single word because the current providers do not return exact word boundary timestamps through this integration.

The retrieval-practice banner is deliberately gated on speech completion. MP3 playback, streaming PCM playback, and browser `speechSynthesis` each call the same completion path so the check does not appear before the learner has heard the tutor answer.

## Learning Progress

The progress loop uses actual learner answers:

1. `/api/tutor/respond` returns a tutor response and one focused follow-up question.
2. The client reveals the assistant text and speaks it.
3. After TTS completion, the follow-up question becomes the active progress check.
4. The learner answers by voice or text.
5. `/api/tutor/evaluate` scores the answer and returns a concept, feedback, confidence, and status.
6. `/api/progress/checks` saves the check row when the current session has a Supabase `session_id`.

Saved checks are loaded alongside a session and rendered in the Progress screen as concept cards, recent checks, status counts, and next review times. The app tolerates a missing `learning_checks` table so older Supabase projects can still load sessions before running the latest schema.

## Persistence

Supabase stores sessions, materials, messages, learning checks, and TTS usage. The schema is in `supabase/schema.sql`. Runtime access uses the server-side Supabase service key only; never expose it in client code or committed files.

`supabase/schema.sql` is written to be rerunnable in the Supabase SQL Editor. It drops and recreates only the `increment_tts_usage_month(text,text,text,integer)` RPC function before defining it, because PostgreSQL cannot change an existing function return type in place.
