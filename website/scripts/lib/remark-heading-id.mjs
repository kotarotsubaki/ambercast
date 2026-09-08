/**
 * Creates the Remark plugin that preserves explicit heading anchors in rendered documents.
 *
 * The plugin targets only a heading node whose last child is text ending in a trailing
 * `{#id}` token, where `id` follows the accepted lowercase-hyphen identifier grammar
 * `[a-z0-9-]+`. It removes that token from the visible text and writes `id` to
 * `data.hProperties.id` so Starlight, heading permalinks, and both table-of-contents variants
 * share the requested anchor. Headings without a matching trailing token, or whose last child
 * is not text, are left unchanged. This local plugin avoids a package path that requires
 * `@astrojs/markdown-remark` as a second direct dependency merely to enter Astro 7's pipeline,
 * preserving the site's constrained dependency surface.
 *
 * @returns {unknown} A Remark transformer plugin suitable for Astro's `remarkPlugins` list.
 */
export default function remarkHeadingId() {
  return (tree) => {
    visit(tree);
  };
}

function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'heading' && Array.isArray(node.children)) {
    const lastChild = node.children.at(-1);
    const match = lastChild?.type === 'text' && /\s*\{#([a-z0-9-]+)\}$/.exec(lastChild.value);
    if (match) {
      lastChild.value = lastChild.value.slice(0, match.index);
      node.data ??= {};
      node.data.hProperties ??= {};
      node.data.hProperties.id = match[1];
    }
  }
  for (const child of node.children ?? []) visit(child);
}
