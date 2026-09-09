import { describe, expect, it } from 'vitest';
import { jaLanding } from '../src/content/ja-landing.ts';
import { zhCnLanding } from '../src/content/zh-cn-landing.ts';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';

describe('siteDescriptions', () => {
  it('defines the specified machine-readable description for every published locale', () => {
    expect(siteDescriptions).toMatchObject({
      en: 'Prompt-native end-to-end testing.',
      ja: 'プロンプトネイティブな E2E テスト。',
      'zh-cn': '提示词原生的 E2E 测试。',
    });
  });

  it('shares the localized landing hero titles rather than duplicating them', () => {
    expect(jaLanding.hero.title).toBe(siteDescriptions.ja);
    expect(zhCnLanding.hero.title).toBe(siteDescriptions['zh-cn']);
  });
});
