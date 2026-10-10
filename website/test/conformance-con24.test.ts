import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));

describe('CON-24 conformance documentation', () => {
  it.each([
    ['en', '../docs/spec/conformance.md', 'Generation MUST additionally reject a `text-equals` assertion whose expected text equals its own target intent quote', "since neither prompt quote then supports the other's role"],
    ['ja', 'src/content/docs/ja/spec/conformance.md', '生成（Generation）は、期待テキストが対象の意図引用と一致する `text-equals` アサーションも拒否しなければならない（MUST）', 'どちらの引用も互いの役割を支持しないためである'],
    ['zh-cn', 'src/content/docs/zh-cn/spec/conformance.md', '生成（Generation）还必须拒绝期望文本与其目标意图引用相同的 `text-equals` 断言', '因为这样两个引用都无法支持对方的角色'],
  ])('%s row includes the self-quote rule, issue code, and reference', (_locale, path, rationale, reason) => {
    const row = readFileSync(join(websiteRoot, path), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('| CON-24 |'));
    expect(row).toBeDefined();
    const cells = row!.split('|').map((cell) => cell.trim());
    expect(cells[3]).toContain(rationale);
    expect(cells[3]).toContain(reason);
    expect(cells[4]).toContain('`text-equals-self-quote`');
    expect(cells[5]).toContain('generate.ts:222');
  });
});
