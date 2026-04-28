# Phloem

Phloem is a Next.js learning companion that turns a captured image, PDF, or Word document into a conversational tutoring session. It can extract learning context, answer with a Socratic tutor style, speak responses aloud, and listen hands-free with browser VAD plus Smart Turn endpointing.

## Current Pipeline

1. Capture material from camera, upload, paste, or link.
2. Extract text and learning context with OpenAI vision/text models.
3. Route each learner turn by intent, such as answer check, summary, direct-answer request, or practice.
4. Generate a structured tutor response with Anthropic or Z.ai using layered context: recent turns, session memory, a lightweight single-user learner profile, and the extracted learning context.
5. Speak the response with browser TTS, OpenAI TTS, or Google Cloud TTS.
6. After speech playback completes, ask one retrieval-practice progress check.
7. If a check is active, score the learner's answer first, update concept mastery, then pass the evaluation into the next tutor turn for corrective feedback.
8. In hands-free mode, browser Silero VAD segments speech and `/api/speech/turn` uses Smart Turn when available before transcription.
9. Voice answers attach lightweight interaction signals, such as incomplete pauses, long-silence fallback, short or numeric answer flags, and uncertainty markers, so tutor feedback can be more supportive without changing correctness rules by itself.

## Setup

Install JavaScript dependencies:

```bash
npm install
```

Optional local Smart Turn dependencies:

```bash
python3 -m pip install -r requirements-smart-turn.txt
```

If you want real local Smart Turn, place `smart-turn-v3.2-cpu.onnx` at `models/smart-turn-v3.2-cpu.onnx` or set `SMART_TURN_MODEL_PATH`.

Copy `.env.example` to `.env` and fill the provider keys you use. Keep Supabase service role keys in `.env` only.

If you use Supabase persistence, run `supabase/schema.sql` in the Supabase SQL Editor. The schema creates sessions, materials, messages, learning checks, concept mastery, session memories, and TTS usage tables. It is intended to be rerunnable; RPC functions are dropped and recreated without deleting usage rows.

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

The VAD assets are copied into `public/vad` by `postinstall`; they are generated files and are intentionally ignored by Git.

In development, each submitted voice answer logs its voice interaction metadata to the browser console as `[Phloem voice signals]`. The same object is included in `/api/tutor/evaluate` and `/api/tutor/respond` request payloads for debugging.

## Progress Checks

Phloem now tracks learning progress from retrieval practice instead of only model-estimated understanding. Each tutor answer ends with a small check question after TTS playback finishes. When the learner answers by voice or text, the app first calls `/api/tutor/evaluate`, then sends the evaluation into `/api/tutor/respond` so the tutor can give targeted corrective feedback instead of treating the answer like a normal question.

Voice answers may include hesitation signals, but evaluation remains content-first. Pauses, short audio, and short transcripts do not lower the score by themselves, and one-word or numeric answers can be fully correct when the question asks for a fact, count, label, or value. Hesitation signals only guide tutor tone and scaffolding when the answer content is incomplete or uncertain.

`/api/progress/checks` saves the raw check and updates `concept_mastery` with attempts, correct count, mastery score, last status, and the next spaced review time. The Progress screen shows concept cards, status counts, and recent checks. If Supabase is not configured or the latest progress tables have not been migrated yet, checks and mastery still work in memory for the current session.

The browser also remembers the last saved session ID and keeps a small per-session progress cache. On refresh, Phloem reopens the last saved session and merges cached progress with Supabase data so a recently answered check does not disappear if the page reloads before the network save finishes.

## Material Extraction

Images are sent directly to the OpenAI vision model, which reads visible text and diagram labels. PDFs use both extraction paths: selectable text is extracted server-side with `pdf-parse`, and the browser renders up to the first four PDF pages to JPEG images so OpenAI vision can read text embedded in page images or diagrams. If page rendering fails, PDFs fall back to text-only extraction. Word documents use `mammoth` raw text extraction.

## Tutor Memory

The tutor uses layered context rather than a long transcript dump:

- last 8 conversation messages for immediate turn memory
- rolling session memory with current goal, strengths, misconceptions, open questions, and effective strategy
- a lightweight single-user learner profile derived from app settings and current understanding level
- extracted learning context from the selected material

Uploaded source text is treated as untrusted context. The system prompt carries tutor behavior and safety rules; material text is passed separately so worksheet text cannot override tutor instructions.

## Conversation Controls

Each visible user and tutor message can be copied from the conversation panel. Messages can also be edited inline; edited content updates the local conversation state and is persisted to Supabase for saved sessions.

## Voice Settings

`TTS_PROVIDER` controls the speech backend:

- `browser`: local browser speech synthesis fallback.
- `openai`: OpenAI TTS, including streaming PCM.
- `google`: Google Cloud Text-to-Speech, including streaming PCM.

The UI exposes a male/female style preference and a speech-speed slider. The speed control applies to browser speech, MP3 playback, streaming PCM playback, and replay. Provider-specific voice names are resolved in `src/lib/speech/tts.ts`.
