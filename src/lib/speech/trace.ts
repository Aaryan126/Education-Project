export type SpeechTraceWord = {
  text: string;
  startIndex: number;
  endIndex: number;
};

export type SpeechTracePart = {
  text: string;
  wordIndex: number | null;
};

export type SpeechTimingPoint = {
  wordIndex: number;
  timeMs: number;
};

type BrowserSegment = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

type BrowserSegmenter = {
  segment(input: string): Iterable<BrowserSegment>;
};

type BrowserSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "word" | "sentence" | "grapheme" }
) => BrowserSegmenter;

export function getSpeechTraceParts(text: string): SpeechTracePart[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: BrowserSegmenterConstructor }).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: "word" });
    let wordIndex = 0;

    return Array.from(segmenter.segment(text), (part) => {
      if (!isTraceableSpeechSegment(part.segment, part.isWordLike)) {
        return { text: part.segment, wordIndex: null };
      }

      const nextPart = { text: part.segment, wordIndex };
      wordIndex += 1;
      return nextPart;
    });
  }

  let wordIndex = 0;

  return (text.match(/\s+|\S+/g) ?? [text]).map((part) => {
    if (/^\s+$/.test(part)) {
      return { text: part, wordIndex: null };
    }

    const nextPart = { text: part, wordIndex };
    wordIndex += 1;
    return nextPart;
  });
}

export function getSpeechTraceWords(text: string): SpeechTraceWord[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: BrowserSegmenterConstructor }).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: "word" });

    return Array.from(segmenter.segment(text))
      .filter((part) => isTraceableSpeechSegment(part.segment, part.isWordLike))
      .map((part) => ({
        text: part.segment,
        startIndex: part.index,
        endIndex: part.index + part.segment.length
      }));
  }

  const words = Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu), (match) => {
    const startIndex = match.index ?? 0;

    return {
      text: match[0],
      startIndex,
      endIndex: startIndex + match[0].length
    };
  });

  if (words.length > 0) {
    return words;
  }

  return Array.from(text.matchAll(/\S+/g), (match) => {
    const startIndex = match.index ?? 0;

    return {
      text: match[0],
      startIndex,
      endIndex: startIndex + match[0].length
    };
  });
}

export function getSpeechTraceWordWeights(text: string, words: SpeechTraceWord[]) {
  return words.map((word, index) => {
    const spokenLength = Math.max(1, Array.from(word.text.replace(/[^\p{L}\p{N}]/gu, "") || word.text).length);
    const separator = text.slice(word.endIndex, words[index + 1]?.startIndex ?? text.length);
    let weight = 0.72 + Math.min(2.6, spokenLength * 0.18);

    if (/[.!?]/.test(separator)) {
      weight += 0.55;
    } else if (/\p{P}/u.test(separator)) {
      weight += 0.28;
    }

    if (index === words.length - 1) {
      weight += 0.18;
    }

    return weight;
  });
}

export function buildSpeechTraceWordEndTimesMs(wordWeights: number[], durationMs: number) {
  const safeDurationMs = Math.max(durationMs, 500);
  const totalWeight = wordWeights.reduce((total, weight) => total + weight, 0) || 1;
  let elapsedMs = 0;

  return wordWeights.map((weight) => {
    elapsedMs += (weight / totalWeight) * safeDurationMs;
    return elapsedMs;
  });
}

export function getSpeechTraceWordIndex(wordEndTimesMs: number[], elapsedMs: number) {
  if (wordEndTimesMs.length === 0 || elapsedMs <= 0) {
    return 0;
  }

  const nextIndex = wordEndTimesMs.findIndex((endTimeMs) => elapsedMs < endTimeMs);
  return nextIndex === -1 ? wordEndTimesMs.length - 1 : nextIndex;
}

export function getSpeechTraceWordIndexFromStartTimes(
  wordStartTimesMs: number[],
  elapsedMs: number,
  totalWords: number
) {
  if (wordStartTimesMs.length === 0 || elapsedMs <= 0) {
    return 0;
  }

  let currentIndex = 0;

  for (let index = 0; index < wordStartTimesMs.length; index += 1) {
    const wordStartTimeMs = wordStartTimesMs[index];

    if (!Number.isFinite(wordStartTimeMs)) {
      continue;
    }

    if (elapsedMs < wordStartTimeMs) {
      break;
    }

    currentIndex = index;
  }

  return Math.min(totalWords - 1, Math.max(0, currentIndex));
}

export function getSpeechTraceWordIndexAtChar(text: string, charIndex: number) {
  if (!Number.isFinite(charIndex)) {
    return null;
  }

  const words = getSpeechTraceWords(text);
  const nextIndex = words.findIndex((word) => charIndex >= word.startIndex && charIndex < word.endIndex);

  if (nextIndex !== -1) {
    return nextIndex;
  }

  let previousIndex: number | null = null;

  for (let index = 0; index < words.length; index += 1) {
    if (words[index].startIndex > charIndex) {
      break;
    }

    previousIndex = index;
  }

  return previousIndex;
}

function isTraceableSpeechSegment(segment: string, isWordLike?: boolean) {
  if (isWordLike) {
    return true;
  }

  return /\S/.test(segment) && /[\p{L}\p{N}]/u.test(segment);
}
