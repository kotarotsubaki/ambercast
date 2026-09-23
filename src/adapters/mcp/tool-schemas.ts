import { z } from 'zod';

/*
 * Each tool has its own strict input boundary because its accepted shape
 * differs and SDK registration takes a schema per tool. Fields will remain
 * optional without schema defaults: handlers must see raw input before
 * refinement and then apply command defaults explicitly.
 */
export const generateInputSchema = z.object({}).strict();
export const runInputSchema = z.object({}).strict();
export const checkInputSchema = z.object({}).strict();
export const healInputSchema = z.object({}).strict();
