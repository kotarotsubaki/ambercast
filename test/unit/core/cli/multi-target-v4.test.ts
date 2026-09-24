import { describe, expect, it } from 'vitest';
import { main } from '../../../../src/cli/main.js';
import { CLI_MANIFEST } from '../../../../src/core/cli/manifest.js';

describe('Target CLI flags in Plan v4', () => {
  it('declares --target only for generate', () => {
    for (const name of ['run', 'check', 'heal']) {
      expect(CLI_MANIFEST.commands.find((command) => command.name === name)?.flags.some((flag) => flag.name === 'target')).toBe(false);
    }
    expect(CLI_MANIFEST.commands.find((command) => command.name === 'generate')?.flags.some((flag) => flag.name === 'target')).toBe(true);
  });

  it.each(['run', 'check', 'heal'])('%s --target fails at usage parsing with exit 2', async (command) => {
    const output: string[] = [];
    const errors: string[] = [];
    const stdout = { write: (chunk: string) => { output.push(chunk); return true; } } as NodeJS.WritableStream;
    const stderr = { write: (chunk: string) => { errors.push(chunk); return true; } } as NodeJS.WritableStream;
    const priorExitCode = process.exitCode;
    try {
      await main([command, '--target', 'app'], stdout, stderr);
      expect(process.exitCode).toBe(2);
      expect(errors.join('')).toMatch(/unknown|unrecognized|usage/i);
    } finally {
      process.exitCode = priorExitCode;
    }
  });

  it('keeps generate --target app in the accepted parser grammar', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const stdout = { write: (chunk: string) => { output.push(chunk); return true; } } as NodeJS.WritableStream;
    const stderr = { write: (chunk: string) => { errors.push(chunk); return true; } } as NodeJS.WritableStream;
    const priorExitCode = process.exitCode;
    try {
      await main(['generate', '--target', 'app', '--list'], stdout, stderr);
      expect(errors.join('')).not.toMatch(/Unknown (?:option|flag)|Unrecognized (?:option|flag)/i);
    } finally {
      process.exitCode = priorExitCode;
    }
  });
});
