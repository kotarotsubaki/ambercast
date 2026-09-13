import type { PlanDocument } from '../../../src/core/ir/schema.ts';

export const demoPrompt = `# Login

@ambercast-secret {{secrets.password}}

Go to /login.
Fill in the email "mika@example.com" and the password {{secrets.password}}.
Click "Sign in".
Expect to land on the dashboard and see a "Welcome" heading.`;

/** The schema-validated plan rendered by the landing-page demonstration. */
export const demoPlan = {
  schemaVersion: 3,
  source: {
    inputsDigest: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  steps: [
    {
      action: 'navigate',
      id: 'open-login',
      kind: 'action',
      url: 'https://example.test/login',
    },
    {
      action: 'fill',
      id: 'fill-email',
      kind: 'action',
      target: {
        name: 'Email',
        role: 'textbox',
        strategy: 'accessibility',
      },
      value: 'mika@example.com',
    },
    {
      action: 'fill-secret',
      id: 'fill-password',
      kind: 'action',
      secretRef: '{{secrets.password}}',
      target: {
        name: 'Password',
        role: 'textbox',
        strategy: 'accessibility',
      },
    },
    {
      action: 'click',
      id: 'click-sign-in',
      kind: 'action',
      target: {
        name: 'Sign in',
        role: 'button',
        strategy: 'accessibility',
      },
    },
    {
      check: 'url-matches',
      id: 'assert-dashboard-url',
      kind: 'assert',
      pattern: '/dashboard$',
    },
    {
      check: 'text-visible',
      id: 'assert-welcome-mika',
      kind: 'assert',
      text: 'Welcome, Mika',
    },
  ],
  targets: {
    app: {
      baseUrl: 'https://example.test',
      browser: 'chromium',
    },
  },
} satisfies PlanDocument;
