# Architecture

## App Shell

The main client experience lives in `src/app/page.tsx`. It owns session state, material processing, conversation state, TTS playback, speech tracing, and settings panels.

`src/components/CameraCapture.tsx` handles material input. `src/components/ConversationPanel.tsx` renders messages, auto-scrolls the transcript, highlights the active phrase during speech playback, and provides per-message copy/edit controls. `src/components/VoiceRecorder.tsx` manages hands-free microphone capture.

Learning progress and session memory state are also owned by `src/app/page.tsx`. A pending retrieval check is created only after the assistant message has been revealed and speech playback has completed. The next learner reply is evaluated before the next tutor response, tagged to a concept, folded into concept mastery, and surfaced in the Progress screen. A rolling session memory is returned by `/api/tutor/respond` and persisted for saved sessions.

## Server Routes

- `/api/vision/extract`: extracts learning context from images and documents.
- `/api/tutor/respond`: calls the configured tutor LLM.
- `/api/tutor/evaluate`: scores one retrieval-practice answer as got it, needs practice, or confused.
- `/api/speech/transcribe`: transcribes captured voice input.
- `/api/speech/synthesize`: returns non-streamed TTS audio.
- `/api/speech/synthesize/stream`: streams PCM TTS audio for faster playback startup.
- `/api/speech/turn`: runs Smart Turn or falls back to VAD-only endpointing.
- `/api/sessions`, `/api/materials`, `/api/usage/tts`: Supabase-backed persistence and usage tracking.
- `/api/progress/checks`: upserts and deletes saved learning checks, and updates concept mastery for scored checks.
- `PATCH /api/sessions/messages`: updates edited message text for saved sessions.

## Material Extraction

Material processing starts in `src/app/page.tsx`. Images are sent to `/api/vision/extract` as image data URLs and analyzed by the OpenAI vision model. PDFs keep the existing text-layer path through `src/lib/documents/extractText.ts`, and the client also renders up to four PDF pages to JPEGs with `src/lib/documents/renderPdfPages.ts`. `/api/vision/extract` sends the extracted text plus rendered page images to the same OpenAI vision/text context extractor, so scanned pages, embedded screenshots, and diagram labels can be read when they are visible in the rendered pages. If browser-side page rendering fails, PDF processing falls back to text-only extraction.

## Tutor Pipeline

`/api/tutor/respond` builds a layered tutor request:

1. Validate the browser payload with the selected material, recent messages, settings, active check, and current session memory.
2. Classify the latest learner turn with `src/lib/tutor/intent.ts` as a normal question, check answer, summary request, direct-answer request, practice request, translation/read-aloud request, or off-topic turn.
3. Build prompts with `src/lib/tutor/prompt.ts`. The system prompt contains tutor behavior and safety rules only. Uploaded material is passed as explicitly untrusted context in the user prompt.
4. Call the configured provider from `src/lib/llm`. Anthropic uses a strict tool schema; Z.ai uses JSON mode.
5. Return structured tutor output, including response, follow-up question, target concept, tutor move, memory update candidates, and the updated session memory.

The tutor remains model-stateless. Durable continuity comes from app-owned memory, saved messages, saved progress checks, and concept mastery rows.

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

1. `/api/tutor/respond` returns a tutor response, target concept, tutor move, updated session memory, and one focused follow-up question.
2. The client reveals the assistant text and speaks it.
3. After TTS completion, the follow-up question becomes the active progress check.
4. The learner answers by voice or text.
5. The client routes active-check answers through `/api/tutor/evaluate` before calling the tutor again.
6. `/api/tutor/evaluate` scores the answer and returns a concept, feedback, confidence, and status.
7. The scored check updates local concept mastery immediately.
8. `/api/progress/checks` saves the check row and updates `concept_mastery` when the current session has a Supabase `session_id`.
9. `/api/tutor/respond` receives the evaluation context and uses it for corrective feedback before moving to the next small step.

Saved checks and concept mastery rows are loaded alongside a session and rendered in the Progress screen as concept cards, mastery score, accuracy, recent checks, status counts, and next review times. The browser remembers the last saved session ID and keeps a small per-session progress cache, then merges that cache with Supabase on reload. This covers fast-refresh cases where the UI showed an evaluated check before the background save finished. The app tolerates missing progress tables so older Supabase projects can still load sessions before running the latest schema.

## Persistence

Supabase stores sessions, materials, session memories, messages, learning checks, concept mastery, and TTS usage. The schema is in `supabase/schema.sql`. Runtime access uses the server-side Supabase service key only; never expose it in client code or committed files.

`supabase/schema.sql` is written to be rerunnable in the Supabase SQL Editor. It drops and recreates RPC functions before defining them, because PostgreSQL cannot change an existing function return type in place.
