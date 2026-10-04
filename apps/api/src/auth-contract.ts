import { z } from 'zod';

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const SignUpSchema = z
  .object({
    name: z.string().trim().min(1, 'Tell us your name.').max(60),
    email: EmailSchema,
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(200, 'Use at most 200 characters.'),
  })
  .strict();
export const LogInSchema = z
  .object({ email: EmailSchema, password: z.string().min(1).max(200) })
  .strict();
export const AgentKeyNameSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
