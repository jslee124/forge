import { NATIVE_RESPONSE_INSTRUCTIONS } from "./investigation-instructions.js";

// Deliberately narrow: only direct reply-language prefixes in the current user
// request select a hint. Other languages/ambiguous wording retain model guidance.
const chinesePrefix =
  /^(?:请(?:你)?\s*)?(?:使用|用)\s*(English|英文|英语|en|Simplified Chinese|简体中文|中文|汉语|Chinese|zh-CN)\s*(?:来\s*)?(?:回答|回复|作答|解释|说明|总结|输出)/iu;
const englishPrefix =
  /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:answer|reply|respond|explain|summarize)\s+in\s+(English|Simplified Chinese|Chinese|zh-CN)\b/iu;
const additionalDirective = new RegExp(
  `${chinesePrefix.source.slice(1)}|${englishPrefix.source.slice(1)}`,
  "iu",
);
const alternativeLanguage =
  /^\s*(?:or|或者|或|\/)\s*(?:English|Chinese|英文|中文|英语|汉语|zh-CN)/iu;

export function explicitResponseLanguage(
  prompt: string,
): "en" | "zh-CN" | undefined {
  const text = prompt.trimStart();
  const match = chinesePrefix.exec(text) ?? englishPrefix.exec(text);
  if (!match) return undefined;
  const rest = text.slice(match[0].length);
  // Multiple/alternative directives may be quoted or contradictory. Do not turn
  // partial parsing into a stronger constraint than the user's complete request.
  if (additionalDirective.test(rest) || alternativeLanguage.test(rest))
    return undefined;
  return /^(?:English|英文|英语|en)$/iu.test(match[1] ?? "") ? "en" : "zh-CN";
}

export function nativeResponseInstructions(prompt: string): string {
  const language = explicitResponseLanguage(prompt);
  const hint =
    language === "en"
      ? "The current user's explicit response-language request selects English. Respond in English for progress and the final answer; retain literal code and identifiers."
      : language === "zh-CN"
        ? "当前用户已明确选择中文回答。进度说明和最终回答均使用简体中文，保留代码与标识符原文。"
        : undefined;
  return [NATIVE_RESPONSE_INSTRUCTIONS, hint].filter(Boolean).join("\n\n");
}
