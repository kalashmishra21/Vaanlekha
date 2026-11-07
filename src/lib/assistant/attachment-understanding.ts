import { z } from "zod";
import { shoppingItemSchema } from "./shopping-list";

export const attachmentUnderstandingSchema = z.object({
  items: z.array(shoppingItemSchema).max(30),
  answer: z.string().trim().min(1).max(1000).optional(),
}).strict().refine((value) => value.items.length > 0 || Boolean(value.answer), {
  message: "Document contains neither a clear list nor a grounded answer.",
});

export type AttachmentUnderstanding = z.infer<typeof attachmentUnderstandingSchema>;

export type AttachmentQuestionMode = "visual-question" | "shopping-list";

export function attachmentQuestionMode(question: string): AttachmentQuestionMode {
  const text = question.normalize("NFKC").toLocaleLowerCase("en-IN");
  if (/\b(?:shopping\s+list|list|inventory|stock|compare|check\s+(?:this\s+)?list)\b|सूची|लिस्ट/u.test(text)) return "shopping-list";
  if (/\b(?:what|which|describe|see|image|picture|photo|products?|quantities|visible)\b|क्या|कौन|दिख/u.test(text)) return "visual-question";
  return "shopping-list";
}
