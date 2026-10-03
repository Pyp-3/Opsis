import { z } from 'zod';
const nonEmptyString = z.string().min(1);
export const ErrorResponseSchema = z
  .object({
    code: nonEmptyString,
    message: nonEmptyString,
    stage: nonEmptyString,
    retryable: z.boolean(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
