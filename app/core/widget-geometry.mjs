/** Original geometry shared by design tools and the offline player. Coordinates
 * are in the node's containing canvas before any ancestor transform is applied. */
export function getNodeOrigin(node) {
  const origin = node.style?.transformOrigin || { x: .5, y: .5 };
  return { x: node.x + node.width * origin.x, y: node.y + node.height * origin.y };
}

export function rotateNodePoint(node, x, y) {
  const origin = getNodeOrigin(node), angle = (node.rotation || 0) * Math.PI / 180;
  const dx = x - origin.x, dy = y - origin.y, cosine = Math.cos(angle), sine = Math.sin(angle);
  return { x: origin.x + dx * cosine - dy * sine, y: origin.y + dx * sine + dy * cosine };
}

export function getNodeBounds(node) {
  const points = [[node.x, node.y], [node.x + node.width, node.y], [node.x + node.width, node.y + node.height], [node.x, node.y + node.height]].map(([x, y]) => rotateNodePoint(node, x, y));
  const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}
