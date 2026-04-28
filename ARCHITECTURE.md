# Architecture

## App Shell

The main client experience lives in `src/app/page.tsx`. It owns session state, material processing, conversation state, TTS playback, speech tracing, and settings panels.

`src/components/CameraCapture.tsx` handles material input. `src/components/ConversationPanel.tsx` renders messages, auto-scrolls the transcript, and highlights the active phrase during speech playback. `src/components/VoiceRecorder.tsx` manages hands-free microphone capture.

## Server Routes

- `/api/vision/extract`: extracts learning context from images and documents.
- `/api/tutor/respond`: calls the configured tutor LLM.
- `/api/speech/transcribe`: transcribes captured voice input.
- `/api/speech/synthesize`: returns non-streamed TTS audio.
- `/api/speech/synthesize/stream`: streams PCM TTS audio for faster playback startup.
- `/api/speech/turn`: runs Smart Turn or falls back to VAD-only endpointing.
- `/api/sessions`, `/api/materials`, `/api/usage/tts`: Supabase-backed persistence and usage tracking.

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

Speech tracing in the UI is estimated from text segmentation and audio playback progress. The UI highlights a short phrase window rather than a single word because the current providers do not return exact word boundary timestamps through this integration.

## Persistence

Supabase stores sessions, materials, messages, and TTS usage. The schema is in `supabase/schema.sql`. Runtime access uses the server-side Supabase service key only; never expose it in client code or committed files.
