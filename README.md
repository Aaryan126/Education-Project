# Phloem

Phloem is a Next.js learning companion that turns a captured image, PDF, or Word document into a conversational tutoring session. It can extract learning context, answer with a Socratic tutor style, speak responses aloud, and listen hands-free with browser VAD plus Smart Turn endpointing.

## Current Pipeline

1. Capture material from camera, upload, paste, or link.
2. Extract text and learning context with OpenAI vision/text models.
3. Generate a structured tutor response with Anthropic or Z.ai.
4. Speak the response with browser TTS, OpenAI TTS, or Google Cloud TTS.
5. After speech playback completes, ask one retrieval-practice progress check.
6. Score the learner's answer as `got-it`, `needs-practice`, or `confused`, then save the concept progress in Supabase.
7. In hands-free mode, browser Silero VAD segments speech and `/api/speech/turn` uses Smart Turn when available before transcription.

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

If you use Supabase persistence, run `supabase/schema.sql` in the Supabase SQL Editor. The schema creates sessions, materials, messages, learning checks, and TTS usage tables. It is intended to be rerunnable; the TTS usage RPC is dropped and recreated without deleting usage rows.

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

The VAD assets are copied into `public/vad` by `postinstall`; they are generated files and are intentionally ignored by Git.

## Progress Checks

Phloem now tracks learning progress from retrieval practice instead of only model-estimated understanding. Each tutor answer ends with a small check question after TTS playback finishes. The learner answers by voice or text, `/api/tutor/evaluate` scores the answer, and `/api/progress/checks` saves the result to Supabase when a session is persisted.

The Progress screen groups saved checks by concept and shows status, feedback, score, and next review time. If Supabase is not configured or the `learning_checks` table has not been migrated yet, checks still work in memory for the current session.

## Voice Settings

`TTS_PROVIDER` controls the speech backend:

- `browser`: local browser speech synthesis fallback.
- `openai`: OpenAI TTS, including streaming PCM.
- `google`: Google Cloud Text-to-Speech, including streaming PCM.

The UI exposes a male/female style preference. Provider-specific voice names are resolved in `src/lib/speech/tts.ts`.
