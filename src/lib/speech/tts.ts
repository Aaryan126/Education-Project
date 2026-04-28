import OpenAI from "openai";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { getEnv, requireOpenAIKey } from "@/lib/env";
import { clampTtsInput, countTtsCharacters } from "@/lib/speech/usage";

const GOOGLE_TTS_STYLE_VOICES = {
  male: "en-US-Chirp3-HD-Orus",
  female: "en-US-Chirp3-HD-Aoede"
} as const;

const OPENAI_TTS_STYLE_VOICES = {
  male: "onyx",
  female: "nova"
} as const;

export type SpeechSynthesisResult = {
  audioBuffer: Buffer | null;
  audioBase64?: string | null;
  format: "mp3" | null;
  provider: "openai" | "google" | "browser";
  voice: string;
  fallback: "none" | "browser";
  usageCharacters?: number;
};

export type StreamingSpeechResult = {
  audioStream: ReadableStream<Uint8Array> | null;
  format: "pcm" | null;
  sampleRate: number | null;
  provider: "openai" | "google" | "browser";
  voice: string;
  fallback: "none" | "browser";
  usageCharacters?: number;
};

let googleTtsClientCache:
  | {
      key: string;
      client: TextToSpeechClient;
    }
  | undefined;

export async function synthesizeSpeech(text: string, requestedVoice?: string): Promise<SpeechSynthesisResult> {
  const env = getEnv();

  switch (env.TTS_PROVIDER) {
    case "openai":
      return synthesizeWithOpenAI(text, requestedVoice);
    case "google":
      return synthesizeWithGoogle(text, requestedVoice);
    case "browser":
    default:
      return {
        audioBuffer: null,
        format: null,
        provider: "browser",
        voice: requestedVoice || env.DEFAULT_TTS_VOICE,
        fallback: "browser"
      };
  }
}

export async function streamSpeech(text: string, requestedVoice?: string): Promise<StreamingSpeechResult> {
  const env = getEnv();

  switch (env.TTS_PROVIDER) {
    case "openai":
      return streamWithOpenAI(text, requestedVoice);
    case "google":
      return streamWithGoogle(text, requestedVoice);
    case "browser":
    default:
      return {
        audioStream: null,
        format: null,
        sampleRate: null,
        provider: "browser",
        voice: requestedVoice || env.DEFAULT_TTS_VOICE,
        fallback: "browser"
      };
  }
}

async function synthesizeWithOpenAI(text: string, requestedVoice?: string): Promise<SpeechSynthesisResult> {
  const env = getEnv();
  const voice = resolveOpenAiVoice(env.OPENAI_TTS_VOICE, requestedVoice);

  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });

  const speech = await client.audio.speech.create({
    model: env.OPENAI_TTS_MODEL,
    voice,
    input: clampTtsInput(text),
    response_format: "mp3",
    speed: 0.95,
    instructions: getVoiceInstructions(requestedVoice)
  });

  const arrayBuffer = await speech.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  return {
    audioBuffer,
    format: "mp3",
    provider: "openai",
    voice,
    fallback: "none"
  };
}

async function streamWithOpenAI(text: string, requestedVoice?: string): Promise<StreamingSpeechResult> {
  const env = getEnv();
  const voice = resolveOpenAiVoice(env.OPENAI_TTS_VOICE, requestedVoice);

  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });

  const speech = await client.audio.speech.create({
    model: env.OPENAI_TTS_MODEL,
    voice,
    input: clampTtsInput(text),
    response_format: "pcm",
    stream_format: "audio",
    speed: 0.95,
    instructions: getVoiceInstructions(requestedVoice)
  });

  if (!speech.body) {
    throw new Error("OpenAI TTS returned no audio stream.");
  }

  return {
    audioStream: speech.body,
    format: "pcm",
    sampleRate: 24000,
    provider: "openai",
    voice,
    fallback: "none"
  };
}

async function synthesizeWithGoogle(text: string, requestedVoice?: string): Promise<SpeechSynthesisResult> {
  const env = getEnv();
  const inputText = clampTtsInput(text);
  const client = getGoogleTtsClient();
  const voice = resolveGoogleVoice(env.GOOGLE_TTS_VOICE, requestedVoice);

  const [response] = await client.synthesizeSpeech({
    input: { text: inputText },
    voice: {
      languageCode: env.GOOGLE_TTS_LANGUAGE_CODE,
      name: voice
    },
    audioConfig: {
      audioEncoding: "MP3"
    }
  });

  if (!response.audioContent) {
    throw new Error("Google Text-to-Speech returned no audio content.");
  }

  const audioBuffer =
    typeof response.audioContent === "string"
      ? Buffer.from(response.audioContent, "base64")
      : Buffer.from(response.audioContent);

  return {
    audioBuffer,
    format: "mp3",
    provider: "google",
    voice,
    fallback: "none",
    usageCharacters: countTtsCharacters(inputText)
  };
}

async function streamWithGoogle(text: string, requestedVoice?: string): Promise<StreamingSpeechResult> {
  const env = getEnv();
  const inputText = clampTtsInput(text);
  const client = getGoogleTtsClient();
  const sampleRate = 24000;
  const voice = resolveGoogleVoice(env.GOOGLE_TTS_VOICE, requestedVoice);

  const audioStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const synthesizeStream = client.streamingSynthesize();

      synthesizeStream.on("data", (response: { audioContent?: Uint8Array | Buffer | string | null }) => {
        if (!response.audioContent) {
          return;
        }

        const chunk =
          typeof response.audioContent === "string"
            ? Buffer.from(response.audioContent, "base64")
            : Buffer.from(response.audioContent);

        if (chunk.length > 0) {
          controller.enqueue(new Uint8Array(chunk));
        }
      });

      synthesizeStream.on("error", (error: Error) => {
        controller.error(error);
      });

      synthesizeStream.on("end", () => {
        controller.close();
      });

      synthesizeStream.write({
        streamingConfig: {
          voice: {
            languageCode: env.GOOGLE_TTS_LANGUAGE_CODE,
            name: voice
          },
          streamingAudioConfig: {
            audioEncoding: "PCM",
            sampleRateHertz: sampleRate,
            speakingRate: 0.95
          }
        }
      });
      synthesizeStream.write({
        input: { text: inputText }
      });
      synthesizeStream.end();
    }
  });

  return {
    audioStream,
    format: "pcm",
    sampleRate,
    provider: "google",
    voice,
    fallback: "none",
    usageCharacters: countTtsCharacters(inputText)
  };
}

function getGoogleTtsClient() {
  const env = getEnv();
  const credentialsJson = env.GOOGLE_TTS_CREDENTIALS_JSON ? JSON.parse(env.GOOGLE_TTS_CREDENTIALS_JSON) : null;
  const projectId = env.GOOGLE_TTS_PROJECT_ID || credentialsJson?.project_id;
  const cacheKey = JSON.stringify({
    apiEndpoint: env.GOOGLE_TTS_API_ENDPOINT ?? "",
    projectId: projectId ?? "",
    credentialsEmail: credentialsJson?.client_email ?? "",
    credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? ""
  });

  if (googleTtsClientCache?.key === cacheKey) {
    return googleTtsClientCache.client;
  }

  const client = new TextToSpeechClient({
    ...(env.GOOGLE_TTS_API_ENDPOINT ? { apiEndpoint: env.GOOGLE_TTS_API_ENDPOINT } : {}),
    ...(projectId ? { projectId } : {}),
    ...(credentialsJson
      ? {
          credentials: {
            client_email: credentialsJson.client_email,
            private_key: credentialsJson.private_key
          }
        }
      : {})
  });

  googleTtsClientCache = { key: cacheKey, client };

  return client;
}

function resolveGoogleVoice(defaultVoice: string, requestedVoice?: string) {
  if (requestedVoice === "male" || requestedVoice === "female") {
    return GOOGLE_TTS_STYLE_VOICES[requestedVoice];
  }

  return requestedVoice || defaultVoice;
}

function resolveOpenAiVoice(defaultVoice: string, requestedVoice?: string) {
  if (requestedVoice === "male" || requestedVoice === "female") {
    return OPENAI_TTS_STYLE_VOICES[requestedVoice];
  }

  return requestedVoice || defaultVoice;
}

function getVoiceInstructions(requestedVoice?: string) {
  if (requestedVoice === "female") {
    return "Speak clearly and warmly for a learner. Use a natural female-presenting voice if available.";
  }

  return "Speak clearly and warmly for a learner. Use a natural male-presenting voice if available.";
}
