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
  fileName,
  pageImageDataUrls = []
}: {
  text: string;
  targetLanguage: string;
  fileName: string;
  pageImageDataUrls?: string[];
}): Promise<LearningContext> {
  const cleanedText = text.trim();
  const pageImages = pageImageDataUrls.slice(0, 4);

  if (!cleanedText && pageImages.length === 0) {
    throw new Error("No readable text was found in that document.");
  }

  const env = getEnv();
  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });
  const userContent = [
    {
      type: "text" as const,
      text: [
        `File name: ${fileName}`,
        `Preferred tutoring language: ${targetLanguage}`,
        "Return JSON with detectedLanguage, extractedText, topic, summary, diagramNotes, suggestedQuestion, confidence.",
        "If rendered PDF page images are provided, read visible text from those images and include important labels or diagram text in extractedText.",
        "Document text:",
        cleanedText ? cleanedText.slice(0, 20000) : "No selectable text was extracted. Use the rendered page images."
      ].join("\n\n")
    },
    ...pageImages.map((imageDataUrl) => ({
      type: "image_url" as const,
      image_url: {
        url: imageDataUrl,
        detail: "high" as const
      }
    }))
  ];

  try {
    const response = await client.chat.completions.create({
      model: env.OPENAI_VISION_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You extract learning context from textbook, worksheet, slide, or study-note text and rendered PDF page images.",
            "Infer the educational topic, preserve useful extracted text, read visible text in images, and identify diagrams or layout.",
            "Do not solve the whole exercise unless the source text already contains the answer.",
            "Return concise valid JSON only."
          ].join(" ")
        },
        {
          role: "user",
          content: userContent
        }
      ]
    });

    const responseText = response.choices[0]?.message.content ?? "";
    return parseVisionJson(responseText);
  } catch {
    return buildFallbackTextLearningContext(cleanedText, fileName, pageImages.length > 0);
  }
}

function buildFallbackTextLearningContext(text: string, fileName: string, usedPageImages = false): LearningContext {
  const compact = text.replace(/\s+/g, " ").trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const topic = firstLine && firstLine.length <= 90 ? firstLine : fileName.replace(/\.[^.]+$/, "") || "Uploaded document";

  return {
    detectedLanguage: "unknown",
    extractedText: text.slice(0, 20000),
    topic,
    summary: compact.slice(0, 500) || "Text was extracted from the uploaded document.",
    diagramNotes: usedPageImages
      ? "Rendered PDF page images were available, but automatic image context extraction fell back to text parsing."
      : "No diagram notes were generated because automatic context extraction fell back to text parsing.",
    suggestedQuestion: `What is the main idea of ${topic}?`,
    confidence: 0.45
  };
}
