import type { PlanDocument } from '../../../src/core/ir/schema.ts';

export const demoPrompt = `# Login

Go to /login.
Fill in the email "mika@example.com" and the password {{secrets.password}}.
Click "Sign in".
Expect to land on the dashboard and see a "Welcome" heading.`;

/** The schema-validated plan rendered by the landing-page demonstration. */
export const demoPlan = {
  schemaVersion: 4,
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
      element: {
        name: 'Email',
        role: 'textbox',
        strategy: 'accessibility',
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
      element: {
        name: 'Password',
        role: 'textbox',
        strategy: 'accessibility',
      },
      target: 'app',
    },
    {
      action: 'click',
      id: 'click-sign-in',
      kind: 'action',
      element: {
        name: 'Sign in',
        role: 'button',
        strategy: 'accessibility',
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
