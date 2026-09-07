import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Availability is content metadata rather than an inferred build state: locales must
      // declare the same value so parity checks can protect planned-page badges.
      extend: z.object({ status: z.enum(['available', 'planned']).optional() }),
    }),
  }),
};
