/**
 * Derives the public report schema from the report-layer Zod contract.
 *
 * This pure, filesystem-free conversion follows the core schema getters while
 * remaining beside {@link ReportEnvelope}, which this layer owns. The report
 * role reaches core only through a type-only edge, so it cannot import a
 * value-level shared metadata helper; attaching three fields inline is simpler
 * than introducing that helper for four call sites.
 */
import { z } from 'zod';
import { ReportEnvelope } from './schema.js';

/**
 * Returns a newly derived JSON Schema 2020-12 document for the complete
 * versioned report artifact.
 *
 * Each call is pure and independent, allowing strict-AJV consumers and the
 * build tool to use the same report-layer contract without filesystem access.
 *
 * @returns A newly derived schema suitable for independent validation or
 *   packaged-schema generation.
 */
export function getReportJsonSchema(): z.core.JSONSchema.BaseSchema {
  return {
    ...z.toJSONSchema(ReportEnvelope),
    $id: 'https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json',
    title: 'ambercast report schema v3.0',
    description: 'Zod schema for the complete versioned output of a reporting command.',
  };
}
