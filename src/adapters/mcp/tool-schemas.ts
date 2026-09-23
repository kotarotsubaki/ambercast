import { z } from 'zod';

/*
 * Each tool has its own strict input boundary because its accepted shape
 * differs and SDK registration takes a schema per tool. Fields remain
 * optional without schema defaults: handlers must see raw input before
 * refinement and then apply command defaults explicitly.
 */

export const generateInputSchema = z.object({
  files: z.string().array().optional(),
  target: z.string().optional(),
  allowEmpty: z.boolean().optional(),
  strict: z.boolean().optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  ai: z.enum(['claude', 'codex']).optional(),
}).strict();

export const runInputSchema = z.object({
  files: z.string().array().optional(),
  target: z.string().optional(),
  allowEmpty: z.boolean().optional(),
  grep: z.string().optional().refine((v) => {
    if (v === undefined) return true;
    new RegExp(v);
    return true;
  }, { message: 'Invalid regex pattern' }),
  resolve: z.boolean().optional(),
  updateCache: z.boolean().optional(),
  ai: z.enum(['claude', 'codex']).optional(),
}).strict();

export const checkInputSchema = z.object({
  files: z.string().array().optional(),
  target: z.string().optional(),
  allowEmpty: z.boolean().optional(),
}).strict();

export const healInputSchema = z.object({
  files: z.string().array().optional(),
  target: z.string().optional(),
  allowEmpty: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  applyToken: z.string().optional(),
  ai: z.enum(['claude', 'codex']).optional(),
}).strict();
