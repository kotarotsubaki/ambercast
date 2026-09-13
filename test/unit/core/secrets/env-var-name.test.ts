import { describe, expect, it } from 'vitest';
import { assertNoEnvVarCollision, envVarNameFor } from '#core/secrets/env-var-name.js';

describe('envVarNameFor', () => {
  it.each([
    ['{{secrets.a}}', 'AMBERCAST_SECRET_A'],
    ['{{secrets.a.b}}', 'AMBERCAST_SECRET_A_B'],
    ['{{secrets.a.b.c}}', 'AMBERCAST_SECRET_A_B_C'],
    ['{{secrets.api_v2.tenant_42.key}}', 'AMBERCAST_SECRET_API_V2_TENANT_42_KEY'],
  ])('maps %s to the provider environment spelling %s', (ref, expected) => {
    expect(envVarNameFor(ref as never)).toBe(expected);
  });
});

describe('assertNoEnvVarCollision', () => {
  it('accepts distinct environment-variable spellings and repeated identical refs', () => {
    expect(() => assertNoEnvVarCollision(['{{secrets.a}}', '{{secrets.a}}', '{{secrets.b}}'] as never)).not.toThrow();
  });

  it('reports one collision group with deduplicated UTF-16-sorted refs', () => {
    try {
      assertNoEnvVarCollision(['{{secrets.a.b}}', '{{secrets.a_b}}', '{{secrets.a.b}}'] as never);
      throw new Error('expected collision');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'secret-env-var-collision', details: {
        envVar: 'AMBERCAST_SECRET_A_B', refs: ['{{secrets.a.b}}', '{{secrets.a_b}}'],
      } });
    }
  });

  it('reports the UTF-16-smallest environment collision when multiple groups collide', () => {
    expect(() => assertNoEnvVarCollision([
      '{{secrets.z.z}}', '{{secrets.z_z}}', '{{secrets.a.b}}', '{{secrets.a_b}}',
    ] as never)).toThrow(expect.objectContaining({ details: expect.objectContaining({ envVar: 'AMBERCAST_SECRET_A_B' }) }));
  });

  it('reports collision groups in UTF-16 order rather than host locale order', () => {
    expect(() => assertNoEnvVarCollision([
      '{{secrets.é.a}}', '{{secrets.é_a}}', '{{secrets.Z.a}}', '{{secrets.Z_a}}',
    ] as never)).toThrow(expect.objectContaining({ details: expect.objectContaining({ envVar: 'AMBERCAST_SECRET_Z_A' }) }));
  });
});
