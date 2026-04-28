import { z } from "zod";

export function normalizeConfidence(value: unknown, fallback = 0.7) {
  let confidence = fallback;

  if (typeof value === "number" && Number.isFinite(value)) {
    confidence = value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const numeric = Number.parseFloat(normalized.replace("%", ""));

    if (Number.isFinite(numeric)) {
      confidence = normalized.includes("%") || numeric > 1 ? numeric / 100 : numeric;
    } else if (["high", "strong", "certain", "likely"].includes(normalized)) {
      confidence = 0.9;
    } else if (["medium", "moderate", "partial", "uncertain"].includes(normalized)) {
      confidence = 0.65;
    } else if (["low", "weak", "unknown", "unclear"].includes(normalized)) {
      confidence = 0.35;
    }
  }

  return Math.max(0, Math.min(1, confidence));
}

export const confidenceSchema = z.preprocess((value) => normalizeConfidence(value), z.number().min(0).max(1));

export const modelTextSchema = (fallback = "") =>
  z.preprocess((value) => {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join("\n");
    }

    return String(value);
  }, z.string());
