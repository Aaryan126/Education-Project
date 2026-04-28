# Product Requirements Document (PRD) -- Phloem

---

## 1. Overview

**Phloem** is a voice-first, camera-based AI Learning Companion designed for learners who struggle with reading or language barriers (ESL learners, low-literacy adults, multilingual young learners). The system enables users to capture educational content via camera or upload documents (images, PDFs, Word .docx), then interact with it through voice or text.

Instead of directly giving answers, the system uses **Socratic-style guided interaction** to help users think, understand, and learn at their own pace.

**Product name:** Phloem -- AI Learning Companion  
**Core philosophy:** *Teach thinking, not just answers.*

---

## 2. Problem Statement

Millions of learners:

- Can understand spoken language but struggle with reading
- Face barriers when learning in a non-native language
- Lack personalized guidance when studying alone
- Are intimidated by dense textbook language

Existing tools:

- Translate content but don't ensure understanding
- Provide answers instead of teaching thinking
- Are not accessible for low-literacy users
- Require reading proficiency to use effectively

**Phloem's gap:** A fully voice-driven, adaptive tutor that meets learners where they are -- using their eyes (camera) and ears (speech) rather than demanding reading fluency.

---

## 3. Solution

An AI-powered web application that:

1. **Captures educational material** via device camera, file upload, clipboard paste, or URL import
2. **Extracts structured learning context** (topic, text, summary, diagrams) from images and documents
3. **Engages in Socratic conversation** -- guiding with hints, not giving answers
4. **Speaks responses aloud** in the learner's preferred language
5. **Adapts difficulty dynamically** based on conversation signals and session memory
6. **Persists sessions server-side** so learners can return to previous conversations
7. **Tracks learning progress from retrieval practice** using actual learner answers
8. **Tracks usage and cost** across TTS providers

---

## 4. Target Users

### Primary Persona

Students who understand spoken language but struggle with reading:
- ESL / EFL learners studying in a non-native language
- Students with dyslexia or reading difficulties
- Learners who learn better through auditory channels

### Secondary Personas

- Young learners (K-12) who need guided, patient tutoring
- Low-literacy adults returning to education
- Multilingual learners working across language pairs

### User Flow Summary

```
Open app -> Capture/upload material(s) -> Vision extracts context
  -> Review extracted topic & summary -> Ask question (voice or text)
  -> Intent router + session memory + extracted learning context
  -> Tutor responds with Socratic guidance + follow-up
  -> Response spoken aloud (with word-by-word highlight)
  -> Learner answers follow-up retrieval check
  -> Progress updates by concept; loop continues, difficulty adapts
```

---

## 5. Key Features

### 5.1 Multi-Modal Material Input (`CameraCapture` component)

Supports five input methods:

| Method | Details |
|---|---|
| **Camera photo** | Device camera via `getUserMedia`, rear-facing, captures JPEG frame |
| **File upload** | File picker accepting `image/*`, `.pdf`, `.docx` |
| **Drag & drop** | Drop zone on the upload panel |
| **Clipboard paste** | Paste image from clipboard (supports both event-based and Clipboard API) |
| **URL import** | Fetch image/PDF/DOCX from direct URL |

All inputs are normalized into a `CapturedInput` object with name, MIME type, size, data URL, and source type.

### 5.2 Vision Pipeline (`/api/vision/extract`)

Two extraction paths:

**Image path:**
- Sends base64 image to OpenAI GPT-4o vision model
- Returns structured `LearningContext` JSON: detected language, extracted text, topic, summary, diagram notes, suggested question, confidence score
- Uses `response_format: json_object` for reliable structured output
- Zod schema validation with graceful fallbacks for malformed LLM output

**Document path (PDF / Word):**
- Server-side parsing: `pdf-parse` for PDFs, `mammoth` for `.docx`
- Extracted plain text sent to GPT-4o as a text-only prompt (same `LearningContext` output)
- PDF uses pdfjs-dist worker; DOCX uses mammoth's raw text extraction
- Supports multi-page documents (text truncated at 20,000 characters for LLM input)

### 5.3 Voice Interaction

#### Speech-to-Text (`/api/speech/transcribe`)
- Accepts a browser-generated audio file posted via `FormData`
- Current client path uses hands-free VAD audio, converts the captured speech segment to a 16 kHz mono WAV blob, and posts it for transcription
- Transcribes via OpenAI GPT-4o-transcribe
- Configurable source language (or auto-detect)

#### Voice Activity Detection (VAD)
- Client-side VAD using `@ricky0123/vad-web` (Silero VAD model running on ONNX Runtime Web)
- Automatically detects when the user stops speaking
- Auto-submits the transcript when speech ends (hands-free mode)
- Configurable sensitivity threshold

#### Smart Turn Analysis (`/api/speech/turn`)
- Optional Python-based smart turn detection endpoint
- Analyzes PCM audio to determine if the user has finished speaking
- Configurable via `SMART_TURN_MODE` env var (auto/off)

#### Voice Interaction Signals
- Hands-free voice turns attach lightweight metadata after transcription, including Smart Turn completion probability/source, incomplete pause count, speech segment count, long-silence fallback, answer audio duration, short/numeric answer flags, and transcript uncertainty markers
- Signals are passed into `/api/tutor/evaluate` and `/api/tutor/respond` as soft coaching context
- Signals do not determine correctness by themselves; pauses, short audio, and short transcripts must not lower scores without answer-content evidence
- One-word or numeric answers can be fully correct when the question asks for a fact, count, label, or value
- In development, submitted voice turns log `[Phloem voice signals]` in the browser console for verification

### 5.4 Guided Tutor Engine (Socratic-Inspired) (`/api/tutor/respond`)

**Behavior rules (encoded in system prompt):**
- Teach thinking, not just answers
- Give hints and guiding questions before revealing an answer
- Ask exactly one focused follow-up question at the end of each response
- Use short, spoken-friendly sentences (no emojis, no em dashes)
- Adapt to learner's understanding level (low/medium/high)
- If learner explicitly asks for the final answer, provide it briefly with reasoning
- If learner seems confused, simplify and use smaller steps

**Output format:** Strict JSON with response text, follow-up question, adapted understanding level, direct-answer flag, confidence score, and provider identifier.

**Resilient JSON parsing:** Three-tier fallback:
1. Clean JSON parse
2. Regex field extraction from malformed JSON
3. Raw text as response with sensible defaults

### 5.5 Text-to-Speech (TTS) System

Three-tier provider architecture:

| Priority | Provider | Voice Quality | Cost Model |
|---|---|---|---|
| 1 | Google Cloud TTS (Chirp 3 HD) | Highest -- SSML word marks for sync highlighting | Free tier (1M chars/month), then pay-as-you-go |
| 2 | OpenAI TTS (gpt-4o-mini-tts) | High -- MP3, streaming supported | Pay-per-character |
| 3 | Browser `speechSynthesis` | Basic -- OS-dependent voices | Free, always available |

**Voice styles:**
- Male default: Google "en-US-Chirp3-HD-Orus" / OpenAI "onyx"
- Female option: Google "en-US-Chirp3-HD-Aoede" / OpenAI "nova"

**Speech speed:**
- Settings exposes a speech-speed slider from 0.75x to 1.5x
- Speed applies to browser speech, generated MP3 playback, streaming PCM playback, and replay
- Speech trace timing is scaled to match the selected playback speed

**Streaming support:**
- `/api/speech/synthesize/stream` returns raw PCM audio stream
- Client plays via Web Audio API (`AudioContext`) with chunked scheduling
- Reduces time-to-first-audio significantly vs. full MP3 generation

**Speech trace / word highlighting:**
- Real-time word-by-word progress tracking during playback
- Google TTS: precise timing from SSML `<mark>` word boundaries + `enableTimePointing`
- OpenAI/browser: estimated timing based on word weights (punctuation-aware)
- Visual indicator shows which word is being spoken in the conversation panel

**TTS Usage tracking:**
- Google TTS character count tracked per month in Supabase (`tts_usage_months` table)
- Settings screen shows usage meter, free tier remaining, request counts
- Background recording (non-blocking) after each synthesis call

### 5.6 Multilingual Support

**Supported languages (tutor output):**
- English (`en`)
- Chinese Simplified (`zh-CN`)
- Spanish (`es`)
- Hindi (`hi`)
- Malay (`ms`)

**Source language detection:**
- Auto-detect (default)
- Manual override: English, Chinese, Spanish, Hindi, Malay

**Language display:**
- User-facing badges and menus show full language names (for example, "English") rather than raw locale codes (`en`)
- The landing page language selector uses a custom themed menu instead of native browser dropdown styling

Default tutoring language is configurable via `DEFAULT_TUTOR_LANGUAGE` env var (default: `zh-CN`).

### 5.7 Adaptive Learning

Three understanding levels tracked per conversation:
- **low** -- Tutor gives very small steps, simplest vocabulary
- **medium** (default) -- Balanced hints and questions
- **high** -- Tutor assumes more competence, faster pacing

The level is updated after each tutor response based on the model's assessment (`TutorResponse.understandingLevel`).

**Direct answer toggle:**
- User can enable "Allow direct answers" in settings
- Passed to tutor engine as `allowDirectAnswer` flag
- Tutor respects it but still encourages reasoning first

### 5.8 Retrieval Practice & Progress Tracking

Phloem now separates real learning progress from model-guessed understanding. The tutor still estimates `understandingLevel` for response style, but the Progress screen is driven by learner answers to retrieval checks.

**Core loop:**
1. Tutor generates a normal Socratic response plus one focused follow-up question.
2. Assistant text is revealed and spoken aloud.
3. Only after TTS playback completes, the follow-up question becomes the active progress check.
4. The learner answers by voice or text.
5. `/api/tutor/evaluate` scores the answer and returns one of three statuses:
   - `got-it`
   - `needs-practice`
   - `confused`
6. The scored check updates concept mastery locally.
7. The check and concept mastery row are saved through `/api/progress/checks` when the session exists in Supabase.
8. The evaluation is passed into the next tutor turn so feedback is corrective instead of treating the check answer as a normal user question.

**Progress dashboard:**
- Groups checks and mastery by concept, not just by session
- Shows answered check count, got-it count, needs-practice count, confused count
- Shows latest question, learner answer, tutor feedback, mastery score, accuracy, and next review time
- Supports practice prompts for a concept from the Progress screen
- Continues to work in memory when Supabase is not configured

### 5.9 Session Persistence & History (Supabase)

**Database schema (7 tables):**

| Table | Purpose |
|---|---|
| `sessions` | Learning session metadata (title, languages, status, timestamps) |
| `materials` | Uploaded files (name, MIME type, storage path, learning_context JSONB) |
| `session_memories` | Rolling session memory and lightweight single-user learner profile |
| `messages` | Conversation history (role, content, client-side ID for optimistic UI) |
| `learning_checks` | Retrieval-practice answers, concept status, feedback, and spaced review timestamps |
| `concept_mastery` | Per-concept attempts, correct count, mastery score, last status, and next scheduled review |
| `tts_usage_months` | Monthly TTS character/request tracking per provider |

**Features:**
- Sessions auto-saved on start (materials stored in Supabase Storage bucket)
- Messages saved optimistically after each tutor exchange
- Learning checks saved when created, scored, or skipped
- Concept mastery updated after each scored retrieval check
- Session list view with material/message counts, last-updated sorting
- Materials library grid with preview thumbnails, download links, session linkage
- Full session reload (restores materials, messages, language settings, session memory, learner profile, progress checks, and concept mastery)
- Browser refresh restores the last saved session and merges local progress cache with Supabase progress
- Delete session (cascades to materials, messages, learning checks, and concept mastery)
- Delete individual material (removes storage file + DB row)
- Graceful degradation when Supabase is not configured (in-memory only)

**Owner key model:** Single `owner_key` (default: `"main"`) for current single-user mode. Designed to migrate to Supabase Auth + row-level security later without changing the learning flow.

**Schema migration note:** `supabase/schema.sql` is intended to be rerunnable in the Supabase SQL Editor. It drops and recreates only the `increment_tts_usage_month(text,text,text,integer)` RPC function before redefining it, because PostgreSQL cannot change an existing function return type in place.

### 5.10 UI / UX Design

**Application structure:**
- **Landing page** (capture phase): Sidebar navigation (Learn, Sessions, Materials, Progress, Settings) + main content area with greeting, upload panel, example cards, pending materials queue, processing overlay, and custom themed language menu
- **Session page** (learn phase): Same sidebar + header with session title/page count/language + workspace with material rail (thumbnail strip + detail panel) and conversation panel
- **Legacy review phase:** Two-panel layout (material rail + conversation) retained for backward compatibility

**Key UI components:**
- `CameraCapture` -- Multi-input capture component with drag/drop, camera, paste, link
- `ConversationPanel` -- Chat-like interface with message bubbles, quick action buttons ("Simplify this", "Give me a hint", "Summarize", "Ask a question"), voice recorder integration, speech trace visualization, stop/response controls
- Message controls -- User and assistant messages can be copied or edited inline; saved-session edits are persisted server-side
- `VoiceRecorder` -- Hands-free VAD microphone control with speech/start/end status, Smart Turn completion checks, and automatic transcription/submission
- Phase navigation -- The current app uses the sidebar and view state for Capture/Learn navigation; there is no standalone `StepIndicator` component in the current UI
- `MaterialRail` -- Thumbnail strip for multi-material sessions with selection and detail panel
- `ProgressScreen` -- Concept-level learning progress from retrieval checks
- `SettingsScreen` -- Language selectors, direct-answer toggle, TTS voice style, TTS usage meter, session persistence info
- `SessionsScreen` -- Saved session history list with open/delete actions
- `MaterialsScreen` -- Library grid of uploaded materials with preview, download, session linkage, delete
- `ProcessingOverlay` -- Full-screen spinner during material processing

**Design system:** Custom vanilla CSS (~3900 lines) with CSS custom properties (design tokens). No Tailwind. Lucide React icons. Mobile-responsive layout.

---

## 6. System Architecture

### 6.1 High-Level Pipeline

```
                         VISION FLOW                          VOICE FLOW
                         ===========                          ==========

Browser Input            Image / PDF / DOCX                   Audio Recording
(Camera / Upload /         |                                    |
 Paste / Link)             v                                    v
                    /api/vision/extract                   /api/speech/transcribe
                            |                                    |
                     VisionService (GPT-4o)              SpeechService (Whisper)
                      - OR - Text extract              /api/speech/turn (VAD)
                        then GPT-4o text                    |
                            |                                v
                    LearningContext (JSON)              Transcript text
                            |                                    |
                            v                                    |
          LearningContextPanel <---------+                       |
                |                                              |
                v                                              v
        User asks question (text or voice) ---------------------+
                |
                v
        /api/tutor/respond
                |
          TutorEngine
   (Anthropic Claude Sonnet 4.6  OR  Z.ai GLM)
                |
          TutorResponse (JSON)
                |
        +-------+-------+
        |               |
        v               v
ConversationPanel  /api/speech/synthesize
(display)          /api/speech/synthesize/stream
                   |
             +-----+-----+
             |     |     |
             v     v     v
          Google  OpenAI  Browser
          (Chirp)  (TTS)  (Web Speech)
             |     |     |
             +--+--+-----+
                |
           Audio Playback
      (with word-by-word
       speech trace highlight)
                |
                v
       Retrieval check appears
       after TTS completion
                |
                v
       Learner answer -> /api/tutor/evaluate
                |
                v
       /api/progress/checks -> Supabase
```

### 6.2 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Strict mode, Turbopack, ES2022 target |
| Vision / OCR | OpenAI GPT-4o | Structured JSON output, high-detail image analysis |
| Document Parsing | `pdf-parse` (pdfjs-dist worker) + `mammoth` | Server-side text extraction |
| STT | OpenAI GPT-4o-transcribe | Audio transcription from browser recordings |
| Tutor LLM (primary) | Anthropic Claude Sonnet 4.6 | Tool-use capable, high reasoning quality |
| Tutor LLM (alt) | Z.ai GLM (OpenAI-compatible) | Switchable via `LLM_PROVIDER` env var |
| TTS (primary) | Google Cloud TTS Chirp 3 HD | SSML word marks, streaming, free tier |
| TTS (secondary) | OpenAI gpt-4o-mini-tTS | MP3 + PCM streaming support |
| TTS (fallback) | Browser Web Speech API | Zero-config, works everywhere |
| VAD | @ricky0123/vad-web | Silero VAD on ONNX Runtime Web (client-side) |
| Database | Supabase (PostgreSQL) | Sessions, materials, messages, learning checks, concept mastery, usage tracking |
| Storage | Supabase Storage | Uploaded file blobs |
| Validation | Zod | All API inputs and LLM outputs |
| Icons | Lucide React | Consistent icon set |
| Testing | Playwright (E2E) | QA automation script with mocked APIs |

### 6.3 LLM Provider Abstraction

```typescript
interface LLMProvider {
  readonly name: string;
  generateTutorResponse(input: TutorRequest): Promise<TutorResponse>;
}
```

Factory function `getTutorProvider()` reads `LLM_PROVIDER` env var:
- `"anthropic"` (default) -> `AnthropicTutorProvider` via `@anthropic-ai/sdk`
- `"zai"` -> `ZaiTutorProvider` via OpenAI SDK with custom base URL

Both providers share:
- Common `buildTutorSystemPrompt()` / `buildTutorUserPrompt()` from `src/lib/tutor/prompt.ts`
- Resilient `parseTutorJson()` output parser
- Confidence normalization via `normalizeConfidence()`

### 6.4 API Route Catalog

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Validate environment config, check missing keys |
| POST | `/api/vision/extract` | Image/document -> LearningContext |
| POST | `/api/speech/transcribe` | Audio -> Text (STT) |
| POST | `/api/speech/turn` | VAD turn analysis (smart turn detection) |
| POST | `/api/speech/synthesize` | Text -> Audio (MP3 base64) |
| POST | `/api/speech/synthesize/stream` | Text -> Audio (PCM streaming) |
| POST | `/api/tutor/respond` | Conversation -> Socratic response |
| POST | `/api/tutor/evaluate` | Retrieval answer -> concept status and feedback |
| GET | `/api/sessions` | List saved sessions |
| POST | `/api/sessions` | Create new session with materials |
| GET | `/api/sessions/[id]` | Load full session (materials + messages + progress checks + concept mastery) |
| DELETE | `/api/sessions/[id]` | Delete session (cascade) |
| POST | `/api/sessions/messages` | Save conversation messages |
| PATCH | `/api/sessions/messages` | Update edited conversation message text |
| POST | `/api/progress/checks` | Upsert a learning progress check and update concept mastery |
| DELETE | `/api/progress/checks` | Delete a skipped learning progress check |
| GET | `/api/materials` | List saved materials library |
| DELETE | `/api/materials/[id]` | Delete material (file + row) |
| GET | `/api/usage/tts` | Current month TTS usage stats |

---

## 7. Functional Requirements

### 7.1 Material Input

- [x] Camera capture with live preview
- [x] File upload (images, PDFs, DOCX)
- [x] Drag-and-drop upload
- [x] Clipboard image paste
- [x] Import from URL
- [x] Multiple materials per session (batched processing)
- [x] Pending material queue with remove/reorder before starting
- [x] Sample/demo data mode (photosynthesis example)

### 7.2 Content Extraction (Vision)

- [x] Image OCR and understanding via GPT-4o vision
- [x] PDF text extraction via pdfjs-dist
- [x] PDF page rendering for vision OCR on embedded images and scanned page text
- [x] DOCX text extraction via mammoth
- [x] Structured LearningContext output (7 fields)
- [x] Confidence scoring
- [x] Malformed output resilience (Zod preprocessing)
- [x] Per-material processing with progress status

### 7.3 Conversation Engine

- [x] Maintain full conversation history (last 8 messages sent to LLM)
- [x] Maintain rolling session memory for current goal, misconceptions, strengths, open questions, and strategy
- [x] Route tutor turns by intent before prompt construction
- [x] Keep uploaded source material out of the system prompt and mark it as untrusted context
- [x] Generate Socratic-guided responses
- [x] Ask one adaptive follow-up per response
- [x] Dynamic understanding level adjustment (low/medium/high)
- [x] Direct-answer mode (toggleable)
- [x] Quick-action buttons for common requests
- [x] Abort/cancel in-flight tutor requests
- [x] Copy user and assistant messages
- [x] Edit previous user and assistant messages inline

### 7.4 Audio Interaction

- [x] Hands-free VAD voice recording (`@ricky0123/vad-web`, 16 kHz mono speech segments)
- [x] VAD auto-detection of speech start/end
- [x] Optional smart turn analysis (Python subprocess)
- [x] Voice interaction signals for pause/hesitation-aware tutor scaffolding
- [x] Speech-to-text transcription from client-generated WAV audio (OpenAI Whisper/GPT-4o-transcribe)
- [x] Three-tier TTS (Google > OpenAI > browser fallback)
- [x] Streaming PCM audio playback (Web Audio API)
- [x] Word-by-word speech trace / highlighting during playback
- [x] Stop speech / stop response controls
- [x] Re-play last assistant response
- [x] Speech speed control for tutor voice playback

### 7.5 Session Management

- [x] Create sessions with one or more materials
- [x] Auto-save to Supabase on session start
- [x] Save messages after each exchange
- [x] Save retrieval progress checks for persisted sessions
- [x] Save concept mastery for persisted sessions
- [x] Save session memory and learner profile for persisted sessions
- [x] List past sessions with summary info
- [x] Load full session (materials + messages + settings + progress checks + concept mastery)
- [x] Delete sessions (cascade delete materials/messages/progress checks/concept mastery)
- [x] Materials library with previews and downloads
- [x] Delete individual materials
- [x] Graceful in-memory operation without Supabase

### 7.6 Language Handling

- [x] Source language auto-detection
- [x] Target tutoring language selection (5 languages)
- [x] Bilingual tutoring capability
- [x] Language preserved across session save/load
- [x] Full language names in user-facing badges and menus
- [x] Themed custom language menu on the home screen

### 7.7 Settings & Preferences

- [x] Tutor language selector
- [x] Source language selector
- [x] Direct-answer toggle
- [x] TTS voice style (male/female)
- [x] TTS speech speed
- [x] TTS usage dashboard (monthly tracking)
- [x] Health status indicator (API key configuration)

### 7.8 Learning Progress

- [x] Create a retrieval check from each tutor follow-up question
- [x] Delay the progress check banner until TTS playback fully completes
- [x] Accept progress-check answers by text or voice
- [x] Score answers as got it, needs practice, or confused
- [x] Evaluate active progress checks before the next tutor response
- [x] Track concept mastery with attempts, correct count, mastery score, and scheduled review
- [x] Persist checks to Supabase when a session is saved
- [x] Load persisted checks and concept mastery with saved sessions
- [x] Show concept-level progress cards, mastery, status counts, recent checks, and next review times
- [x] Delete skipped active checks from persisted progress

---

## 8. Non-Functional Requirements

| Requirement | Target | Status |
|---|---|---|
| Vision extraction latency | <5 seconds for typical textbook page | Achieved (depends on GPT-4o response time) |
| Tutor response latency | <3-5 seconds | Achieved (depends on LLM provider) |
| TTS time-to-first-audio | <1 second (streaming) | Achieved via PCM streaming |
| STT latency | <2 seconds | Achieved (depends on audio length) |
| Input validation | 100% of API routes | Achieved (Zod schemas) |
| Error recovery | Graceful degradation at every layer | Achieved (fallback chain) |
| Browser support | Modern Chromium browsers (camera/VAD/AudioContext) | Tested |
| Accessibility | Keyboard nav, ARIA labels, semantic HTML | Partially implemented |

---

## 9. Environment Configuration

All behavior is configurable via environment variables (validated by Zod schema in `src/lib/env.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required if LLM_PROVIDER=anthropic)* | Claude API key |
| `OPENAI_API_KEY` | *(required)* | Vision, STT, OpenAI TTS |
| `ZAI_API_KEY` | *(required if LLM_PROVIDER=zai)* | Alternative LLM provider |
| `ZAI_BASE_URL` | *(required if LLM_PROVIDER=zai)* | Z.ai endpoint |
| `LLM_PROVIDER` | `anthropic` | Which tutor LLM to use |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude model ID |
| `ZAI_MODEL` | `glm-4.6` | Z.ai model ID |
| `OPENAI_VISION_MODEL` | `gpt-4o` | Vision extraction model |
| `OPENAI_STT_MODEL` | `gpt-4o-transcribe` | Speech-to-text model |
| `TTS_PROVIDER` | `browser` | Active TTS backend |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | OpenAI TTS model |
| `OPENAI_TTS_VOICE` | `onyx` | Default OpenAI voice |
| `GOOGLE_TTS_CREDENTIALS_JSON` | *(optional)* | Google service account credentials |
| `GOOGLE_TTS_PROJECT_ID` | *(optional)* | Google Cloud project |
| `GOOGLE_TTS_LANGUAGE_CODE` | `en-US` | Google TTS language |
| `GOOGLE_TTS_VOICE` | `en-US-Chirp3-HD-Orus` | Default Google voice |
| `SUPABASE_URL` | *(optional)* | Supabase project URL |
| `SUPABASE_SECRET_KEY` | *(optional)* | Supabase anon/service key |
| `DEFAULT_TUTOR_LANGUAGE` | `zh-CN` | Default output language |
| `DEFAULT_SOURCE_LANGUAGE` | `auto` | Default input language |
| `SMART_TURN_MODE` | `auto` | Enable/disable VAD turn analysis |
| `SMART_TURN_THRESHOLD` | `0.5` | VAD sensitivity (0-1) |
| `APP_ENV` | `development` | Environment label |
| `APP_PORT` | `3000` | Dev server port |

---

## 10. Demo Scenario (Hackathon Reference)

1. User opens Phloem landing page, sees greeting and upload panel
2. User uploads an English biology textbook photo (photosynthesis chapter)
3. System extracts topic ("Photosynthesis"), reads text aloud, summarizes
4. User asks verbally: *"What do plants need for photosynthesis?"*
5. Tutor responds (in Chinese): Guided hint about sunlight, water, air + follow-up question
6. Response is spoken aloud with word-by-word highlighting
7. After speech completes, the follow-up becomes a progress check
8. User answers; Phloem tags the concept as got it, needs practice, or confused
9. Session auto-saves; user can reopen later from Sessions screen with progress restored

---

## 11. Success Metrics

| Metric | Measurement |
|---|---|
| Engagement | Conversation length (number of exchanges per session) |
| Learning effectiveness | Retrieval-check status by concept, got-it rate, and reduction in confused/needs-practice checks over time |
| Socratic fidelity | Ratio of hint/guidance responses vs. direct-answer responses |
| Platform reliability | Vision extraction success rate, STT accuracy |
| TTS efficiency | Characters consumed per session, free-tier utilization |
| Retention | Return visits, sessions loaded from history, progress checks resumed from saved sessions |

---

## 12. Future Enhancements (Planned / In Progress)

### Near-term
- [ ] **Streaming tutor responses** -- Reduce perceived latency with token-streaming from LLM (Plan Phase 7)
- [ ] **Spaced-review scheduling UI** -- Turn saved next-review timestamps into reminders and review queues
- [ ] **Session sharing** -- Share button in session header (non-functional currently)
- [ ] **User authentication** -- Supabase Auth integration, replace owner_key model
- [ ] **Rate limiting & cost controls** -- Prevent abuse of paid API calls

### Medium-term
- [ ] **Emotion detection from voice** -- Tone/sentiment analysis on audio input. Current voice interaction signals cover pause/hesitation cues only and intentionally avoid inferring emotion.
- [ ] **Personalized learning profiles** -- Per-user preferences and history
- [ ] **PWA / offline mode** -- Service worker, installable app, cached sample content
- [ ] **Video-based learning** -- Screen capture or video file as input
- [ ] **More languages** -- Expand beyond current 5 supported languages
- [ ] **Image generation** -- AI-generated diagrams to explain concepts visually

### Long-term
- [ ] **Real-time collaboration** -- Study groups with shared sessions
- [ ] **Curriculum alignment** -- Map to specific syllabi/exams
- [ ] **Teacher dashboard** -- Classroom management and analytics

---

## 13. Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OCR inaccuracies on handwritten/poor-quality images | Wrong learning context | Confidence scoring; allow manual correction; suggest re-capture |
| Latency from multi-step pipeline (vision -> tutor -> TTS) | Poor UX, user abandonment | Streaming TTS; processing overlay with status; abort capability |
| LLM gives direct answers despite instructions | Breaks Socratic contract | Explicit system prompt rules; `allowDirectAnswer` gate; output validation |
| Over-guidance frustrates capable learners | Disengagement | Adaptive difficulty levels; quick actions for "just tell me"; user feedback loop |
| TTS cost overruns (Google/OpenAI) | Budget exhaustion | Usage tracking dashboard; free-tier awareness; browser fallback |
| Large uploaded files DoS the server / inflate costs | Availability/cost impact | Need input size limits on vision route; file type validation |
| No auth exposes API keys to public use | Security risk | Owner key model is interim; need Auth before public deployment |

---

## 14. Architecture Decisions & Rationale

### Why turn-based (not real-time) responses?
Per Plan Phase 7: The initial version is intentionally turn-based to reduce demo risk and complexity. Streaming will be added as an enhancement.

### Why two (three) LLM providers?
Hackathon requirement for Z.ai GLM support plus production preference for Anthropic Claude. The abstraction layer makes switching a single env var change.

### Why three-tier TTS?
Google offers the best quality (Chirp 3 HD) with word-level timing for highlighting, plus a generous free tier. OpenAI provides strong fallback with streaming. Browser speechSynthesis ensures zero-config functionality even with no API keys.

### Why Supabase for persistence?
Zero-infrastructure PostgreSQL + Storage + ready-made Auth (for future use). Single-owner-key model keeps it simple for now while supporting migration to multi-user later.

### Why vanilla CSS (not Tailwind)?
Design philosophy prioritizes distinctive, non-generic aesthetics. Custom CSS with design tokens allows full creative control without framework constraints.

### Why centralized state in `page.tsx`?
Single source of truth simplifies the data flow for the MVP. The component tree is shallow enough that prop drilling is manageable. This should be refactored to hooks + Context as the app grows.

---

## 15. Conclusion

Phloem enables learners who struggle with reading to access and understand educational content through multimodal AI interaction. The core innovation is the **guided Socratic learning loop** -- combining vision, voice, adaptive tutoring, and speech synthesis into a cohesive experience that teaches thinking, not just answers.

The current implementation covers the full core pipeline from material capture through persistent conversation history, with a robust multi-provider architecture that balances quality, cost, and availability.
