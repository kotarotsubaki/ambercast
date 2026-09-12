// Hot marks the generate and heal paths because both resolve an AI provider; cool marks the run
// path because it performs zero AI calls on a grounding hit. The cycle figure uses the same
// semantics, so this shared map keeps the how-it-works figure consistent without using color as
// the only way to identify a node.
export const NODE_EMPHASIS = { generate: 'hot', heal: 'hot', run: 'cool' };
