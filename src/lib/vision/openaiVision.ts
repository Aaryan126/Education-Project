import OpenAI from "openai";
import { z } from "zod";
import { getEnv, requireOpenAIKey } from "@/lib/env";
import { confidenceSchema, modelTextSchema } from "@/lib/modelOutput";
import type { LearningContext } from "@/lib/tutor/types";

const learningContextSchema = z.object({
  detectedLanguage: modelTextSchema("unknown"),
  extractedText: modelTextSchema(""),
  topic: modelTextSchema("Untitled learning material"),
  summary: modelTextSchema(""),
  diagramNotes: modelTextSchema(""),
  suggestedQuestion: modelTextSchema("What do you notice first?"),
  confidence: confidenceSchema.default(0.7)
});

function parseVisionJson(raw: string): LearningContext {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Vision model did not return JSON.");
  }

  return learningContextSchema.parse(JSON.parse(trimmed.slice(start, end + 1)));
}

export async function extractLearningContext(imageDataUrl: string, targetLanguage: string): Promise<LearningContext> {
  const env = getEnv();
  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });

  const response = await client.chat.completions.create({
    model: env.OPENAI_VISION_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You extract learning context from textbook or worksheet images.",
          "Read all visible text, infer the educational topic, and describe diagrams or layout.",
          "Do not solve the whole exercise unless the image itself already contains the answer.",
          "Return concise valid JSON only."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this learning material for a voice tutor. Preferred tutoring language: ${targetLanguage}. Return JSON with detectedLanguage, extractedText, topic, summary, diagramNotes, suggestedQuestion, confidence.`
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
              detail: "high"
            }
          }
        ]
      }
    ]
  });

  const text = response.choices[0]?.message.content ?? "";
  return parseVisionJson(text);
}

export async function extractTextLearningContext({
  text,
  targetLanguage,
  fileName
}: {
  text: string;
  targetLanguage: string;
  fileName: string;
}): Promise<LearningContext> {
  const cleanedText = text.trim();

  if (!cleanedText) {
    throw new Error("No readable text was found in that document.");
  }

  const env = getEnv();
  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });

  const response = await client.chat.completions.create({
    model: env.OPENAI_VISION_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You extract learning context from textbook, worksheet, slide, or study-note text.",
          "Infer the educational topic, preserve useful extracted text, and identify any likely layout or diagram notes if the text implies them.",
          "Do not solve the whole exercise unless the source text already contains the answer.",
          "Return concise valid JSON only."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `File name: ${fileName}`,
          `Preferred tutoring language: ${targetLanguage}`,
          "Return JSON with detectedLanguage, extractedText, topic, summary, diagramNotes, suggestedQuestion, confidence.",
          "Document text:",
          cleanedText.slice(0, 20000)
        ].join("\n\n")
      }
    ]
  });

  const responseText = response.choices[0]?.message.content ?? "";
  return parseVisionJson(responseText);
}
