/** Editor guides use the same coordinate contract in local and project scope. */
export function validateGuides(guides, label, { keys, array, number, fail }) {
  keys(guides, ['horizontal', 'vertical'], label);
  for (const axis of ['horizontal', 'vertical']) {
    array(guides[axis], label, 500);
    const distinct = new Set();
    for (const position of guides[axis]) {
      number(position, `${label}位置`, -100000, 100000);
      if (distinct.has(position)) fail(`${label}同方向的参考线不能重复`);
      distinct.add(position);
    }
  }
}

/** A master canvas never inherits the project's ordinary-page guide set. */
export function canvasGuideSets(project, containerId) {
  const page = project.pages.find(item => item.id === containerId);
  const container = page || project.components.find(item => item.id === containerId);
  if (!container) return [];
  const local = { scope: 'page', guides: container.guides };
  return page ? [local, { scope: 'project', guides: project.globalGuides }] : [local];
}
