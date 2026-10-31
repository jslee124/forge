import { useCallback, useEffect, useRef, useState } from "react";

const MAX_ANSWER_CHARACTERS = 1_000_000;
/** Text is frame-batched; approvals, cancellation and completion stay on the immediate event path. */
export function useStreamedAnswer() {
  const [value, setValue] = useState({ text: "", omitted: 0 });
  const published = useRef("");
  const queued = useRef<string[]>([]);
  const queuedCharacters = useRef(0);
  const omitted = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const flush = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (!queued.current.length) return published.current;
    const combined = published.current + queued.current.join("");
    omitted.current += Math.max(0, combined.length - MAX_ANSWER_CHARACTERS);
    published.current = combined.slice(-MAX_ANSWER_CHARACTERS);
    queued.current = [];
    queuedCharacters.current = 0;
    setValue({ text: published.current, omitted: omitted.current });
    return published.current;
  }, []);
  const append = useCallback(
    (text: string) => {
      queued.current.push(text);
      queuedCharacters.current += text.length;
      if (queuedCharacters.current > MAX_ANSWER_CHARACTERS) {
        const combined = queued.current.join("");
        omitted.current += combined.length - MAX_ANSWER_CHARACTERS;
        queued.current = [combined.slice(-MAX_ANSWER_CHARACTERS)];
        queuedCharacters.current = MAX_ANSWER_CHARACTERS;
      }
      if (frame.current !== undefined) return;
      const currentGeneration = generation.current;
      frame.current = requestAnimationFrame(() => {
        if (generation.current === currentGeneration) flush();
      });
    },
    [flush],
  );
  const reset = useCallback(() => {
    generation.current++;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    queued.current = [];
    queuedCharacters.current = 0;
    published.current = "";
    omitted.current = 0;
    setValue({ text: "", omitted: 0 });
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    },
    [],
  );
  return {
    answer: value.text,
    omittedCharacters: value.omitted,
    append,
    flush,
    reset,
  };
}
