# Phloem

Phloem is a Next.js learning companion that turns a captured image, PDF, or Word document into a conversational tutoring session. It can extract learning context, answer with a Socratic tutor style, speak responses aloud, and listen hands-free with browser VAD plus Smart Turn endpointing.

## Current Pipeline

1. Capture material from camera, upload, paste, or link.
2. Extract text and learning context with OpenAI vision/text models.
3. Generate a structured tutor response with Anthropic or Z.ai.
4. Speak the response with browser TTS, OpenAI TTS, or Google Cloud TTS.
5. In hands-free mode, browser Silero VAD segments speech and `/api/speech/turn` uses Smart Turn when available before transcription.

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

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

The VAD assets are copied into `public/vad` by `postinstall`; they are generated files and are intentionally ignored by Git.

## Voice Settings

`TTS_PROVIDER` controls the speech backend:

- `browser`: local browser speech synthesis fallback.
- `openai`: OpenAI TTS, including streaming PCM.
- `google`: Google Cloud Text-to-Speech, including streaming PCM.

The UI exposes a male/female style preference. Provider-specific voice names are resolved in `src/lib/speech/tts.ts`.
