import { z } from "zod";
import { shoppingItemSchema } from "./shopping-list";

export const attachmentUnderstandingSchema = z.object({
  items: z.array(shoppingItemSchema).max(30),
  answer: z.string().trim().min(1).max(1000).optional(),
}).strict().refine((value) => value.items.length > 0 || Boolean(value.answer), {
  message: "Document contains neither a clear list nor a grounded answer.",
});

export type AttachmentUnderstanding = z.infer<typeof attachmentUnderstandingSchema>;
