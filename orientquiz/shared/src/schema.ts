import { z } from "zod";

export const QuestionScoringConfigSchema = z.object({
  timeWindow: z.number().min(0).max(1).default(0.25),
  fullPointsWindow: z.boolean().default(true),
});

export const QuizQuestionSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().min(1, "Question text is required"),
    options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
    correct: z.number().int().min(0),
    timerSeconds: z.number().int().min(5).max(300).default(30),
    points: z.number().int().min(1).default(100),
    scoring: QuestionScoringConfigSchema.default({
      timeWindow: 0.25,
      fullPointsWindow: true,
    }),
  })
  .refine((data) => data.correct < data.options.length, {
    message: "Correct answer index is out of bounds for the options provided",
    path: ["correct"],
  });

export const QuizQuestionsFileSchema = z.object({
  title: z.string().default("Orientation Quiz"),
  description: z.string().optional(),
  questions: z.array(QuizQuestionSchema).min(1, "At least 1 question is required"),
});

export const TeamCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Team name cannot be empty")
    .max(20, "Team name must be 20 characters or fewer")
    .regex(/^[a-zA-Z0-9\s._'-]+$/, "Team name contains invalid characters. Use letters, numbers, spaces, and . _ ' -"),
});

export const TeamJoinSchema = z.object({
  code: z
    .string()
    .trim()
    .length(6, "Team code must be exactly 6 characters")
    .toUpperCase(),
});

export const SubmitAnswerSchema = z.object({
  questionIndex: z.number().int().min(0),
  selectedOption: z.number().int().min(0),
});

export const AdminAuthSchema = z.object({
  passcode: z.string().min(1, "Passcode is required"),
});

export const AdminScoreOverrideSchema = z.object({
  teamId: z.string().min(1),
  delta: z.number(),
  note: z.string().optional(),
});

export type QuestionScoringConfig = z.infer<typeof QuestionScoringConfigSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizQuestionsFile = z.infer<typeof QuizQuestionsFileSchema>;
export type TeamCreateInput = z.infer<typeof TeamCreateSchema>;
export type TeamJoinInput = z.infer<typeof TeamJoinSchema>;
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
export type AdminAuthInput = z.infer<typeof AdminAuthSchema>;
export type AdminScoreOverrideInput = z.infer<typeof AdminScoreOverrideSchema>;
