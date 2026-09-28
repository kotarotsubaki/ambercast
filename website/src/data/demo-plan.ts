import type { PlanDocument } from '../../../src/core/ir/schema.ts';

export const demoPrompt = `# Login

Go to /login.
Fill in the email "mika@example.com" and the password {{secrets.password}}.
Click "Sign in".
Expect to land on the dashboard and see a "Welcome" heading.`;

/** The schema-validated plan rendered by the landing-page demonstration. */
export const demoPlan = {
  schemaVersion: 5,
  source: {
    inputsDigest: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  steps: [
    {
      action: 'navigate',
      id: 'open-login',
      kind: 'action',
      target: 'app',
      url: 'https://example.test/login',
    },
    {
      action: 'fill',
      intent: {
        description: 'Email field on the login form',
        roleHint: 'textbox',
        sourceSpan: { startLine: 3, startColumn: 13, endLine: 3, endColumn: 18 },
      },
      id: 'fill-email',
      kind: 'action',
      target: 'app',
      value: 'mika@example.com',
    },
    {
      action: 'fill-secret',
      id: 'fill-password',
      kind: 'action',
      secretRef: '{{secrets.password}}',
      intent: {
        description: 'Password field on the login form',
        roleHint: 'textbox',
        sourceSpan: { startLine: 3, startColumn: 46, endLine: 3, endColumn: 54 },
      },
      target: 'app',
    },
    {
      action: 'click',
      id: 'click-sign-in',
      kind: 'action',
      intent: {
        description: 'Sign in button on the login form',
        roleHint: 'button',
        sourceSpan: { startLine: 4, startColumn: 8, endLine: 4, endColumn: 17 },
      },
      target: 'app',
    },
    {
      check: 'url-matches',
      id: 'assert-dashboard-url',
      kind: 'assert',
      pattern: '/dashboard$',
      target: 'app',
    },
    {
      check: 'text-visible',
      id: 'assert-welcome-mika',
      kind: 'assert',
      text: 'Welcome, Mika',
      target: 'app',
    },
  ],
  targets: {
    app: {
      baseUrl: 'https://example.test',
      surface: 'web',
    },
  },
} satisfies PlanDocument;
