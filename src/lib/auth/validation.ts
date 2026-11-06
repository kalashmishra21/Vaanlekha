import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." }));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name (at least 2 characters)."),
  email,
  password: z.string().min(12, "Use at least 12 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).superRefine(({ password, confirmPassword }, context) => {
  if (password !== confirmPassword) context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
});
