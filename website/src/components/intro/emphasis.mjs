// Hot marks the generate and heal paths because both resolve an AI provider; cool marks the
// grounded replay path because it performs zero AI calls. The landing figure uses the same
// semantics, so this shared map keeps the introduction figures consistent without using color
// as the only way to identify a node.
export const NODE_EMPHASIS = { generate: 'hot', heal: 'hot', replay: 'cool' };
