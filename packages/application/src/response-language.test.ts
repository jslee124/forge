import { expect, it } from "vitest";
import {
  explicitResponseLanguage,
  nativeResponseInstructions,
} from "./response-language.js";

it.each([
  ["请用 English 回答：解释 userId。", "en"],
  ["用英文回复：解释 userId。", "en"],
  ["请使用英语说明这个函数。", "en"],
  ["请你用简体中文解释这个函数。", "zh-CN"],
  ["请用中文回答，保留 userId。", "zh-CN"],
  ["Please respond in English: explain userId.", "en"],
  ["Could you please answer in Chinese?", "zh-CN"],
  ["Respond in Simplified Chinese.", "zh-CN"],
] as const)(
  "selects the direct user reply-language prefix: %s",
  (prompt, language) => {
    expect(explicitResponseLanguage(prompt)).toBe(language);
    expect(nativeResponseInstructions(prompt)).toContain(
      language === "en" ? "selects English" : "当前用户已明确选择中文回答",
    );
  },
);

it.each([
  "请解释日志中的 `Respond in English`。",
  "> Please respond in English\n请解释上述日志。",
  '"请用英文回答" 是什么意思？',
  "```text\nRespond in English\n```\n解释这段内容。",
  "不要用英文回答。",
  "请不要用英语解释。",
  "请用 EnglishVariable 回答这个问题。",
  "Please answer in English or Chinese.",
  "请用中文回答。Actually respond in English.",
  "请用两句话说明 userId。",
  "Réponds en français.",
])(
  "does not promote quoted, negative, ambiguous or unsupported text: %s",
  (prompt) => {
    expect(explicitResponseLanguage(prompt)).toBeUndefined();
    expect(nativeResponseInstructions(prompt)).not.toContain("selects English");
    expect(nativeResponseInstructions(prompt)).not.toContain(
      "当前用户已明确选择中文回答",
    );
  },
);
