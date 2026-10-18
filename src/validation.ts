import { z } from "zod";

export const AdminLoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const TeamLoginBody = AdminLoginBody;

export const CreateTeamBody = z.object({
  teamName: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(4),
  active: z.boolean().optional(),
});

export const UpdateTeamBody = z.object({
  teamName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(4).nullish(),
  active: z.boolean().optional(),
});

export const UpdateTeamParams = z.object({ teamId: z.coerce.string() });
export const DeactivateTeamParams = UpdateTeamParams;

export const SubmitAnswerBody = z.object({
  questionId: z.string().min(1),
  selectedAnswer: z.string().min(1),
});

export const HealthCheckResponse = z.object({ status: z.string() });
