import test from 'node:test';
import assert from 'node:assert/strict';
import { styleColor, resolveNodeVisual, styleGradientGeometry, styleRoundedPath } from '../app/core/style-renderer.mjs';

const node = (type = 'rectangle', style = {}) => ({ type, x: 10, y: 20, width: 200, height: 100, style: { fill: '#FFFFFF', stroke: '#191919', strokeWidth: 2, radius: 5, color: '#191919', fontSize: 20, fontWeight: 400, align: 'left', opacity: 1, ...style } });
test('unequal border widths and text padding are independent from image pixels', () => {
  const value = node('image', { borderSides: { top: 1, right: 2, bottom: 3, left: 4 }, padding: { top: 5, right: 6, bottom: 7, left: 8 } }), before = structuredClone(value), result = resolveNodeVisual(value);
  assert.deepEqual(result.inner, { x: 4, y: 1, width: 194, height: 96 });
  assert.deepEqual(result.content, { x: 12, y: 6, width: 180, height: 84 }); assert.deepEqual(value, before);
});
test('nullable typography preserves image text and rich text defaults; explicit line height is px', () => {
  const image = node('image'); image.image = { text: { padding: 17, verticalAlign: 'bottom' } };
  assert.deepEqual(resolveNodeVisual(image).padding, { top: 17, right: 17, bottom: 17, left: 17 }); assert.equal(resolveNodeVisual(image).text.verticalAlign, 'bottom');
  const rich = node('text', { fontFamily: null, lineHeight: null }); rich.richText = { fontFamily: 'Microsoft YaHei', lineHeight: 1.8 };
  assert.equal(resolveNodeVisual(rich).text.lineHeight, 36); assert.match(resolveNodeVisual(rich).text.fontFamily, /^"Microsoft YaHei"/);
  rich.style.lineHeight = 31; rich.style.verticalAlign = 'middle'; assert.equal(resolveNodeVisual(rich).text.lineHeight, 31); assert.equal(resolveNodeVisual(rich).text.verticalAlign, 'middle');
});
test('large per-corner radii use a common factor and do not mutate authored values', () => {
  const value = node('rectangle', { radiusCorners: { topLeft: 100, topRight: 100, bottomRight: 100, bottomLeft: 100 } }), before = structuredClone(value);
  assert.deepEqual(resolveNodeVisual(value).radii, { topLeft: 50, topRight: 50, bottomRight: 50, bottomLeft: 50 }); assert.deepEqual(value, before);
});
test('rounded inner rectangle accepts elliptical radii without modifying them', () => {
  const corners = { topLeft: { x: 20, y: 10 }, topRight: { x: 20, y: 10 }, bottomRight: 0, bottomLeft: 0 }, before = structuredClone(corners);
  const path = styleRoundedPath(4, 2, 30, 18, corners); assert.match(path, /A 15 7.5/); assert.deepEqual(corners, before); assert(!path.includes('NaN'));
});
test('linear gradient angles agree with CSS on non-square boxes', () => {
  const right = styleGradientGeometry({ type: 'linear', angle: 90 }, 200, 100); assert(Math.abs(right.x1) < 1e-8); assert(Math.abs(right.x2 - 200) < 1e-8); assert(Math.abs(right.y1 - 50) < 1e-8);
  assert.deepEqual(styleGradientGeometry({ type: 'linear', angle: 0 }, 200, 100), { x1: 100, y1: 100, x2: 100, y2: 0 });
  assert.deepEqual(styleGradientGeometry({ type: 'radial', cx: .25, cy: .75, radius: .5 }, 200, 100), { cx: 50, cy: 75, rx: 100, ry: 50 });
});
test('fill/stroke/shadow opacity multiplies existing color alpha', () => {
  assert.equal(styleColor('#FF000080', .5), `rgba(255,0,0,${128 / 255 * .5})`); assert.equal(styleColor('#0F08', .25), `rgba(0,255,0,${136 / 255 * .25})`); assert.equal(styleColor('transparent', 1), 'rgba(0,0,0,0)'); assert.equal(styleColor('white', .3), 'rgba(255,255,255,0.3)');
});
test('vector paths do not consume CSS border space or rectangular text padding', () => {
  const result = resolveNodeVisual(node('path', { strokeWidth: 10, borderSides: { top: 20, right: 30, bottom: 40, left: 50 } })); assert.deepEqual(result.inner, { x: 0, y: 0, width: 200, height: 100 });
});
test('font names remain a quoted family and combined decorations preserve both choices', () => {
  const result = resolveNodeVisual(node('text', { fontFamily: 'Noto Sans CJK SC', italic: true, underline: true, strike: true, textCase: 'uppercase', letterSpacing: 3 }));
  assert.match(result.text.fontFamily, /^"Noto Sans CJK SC",/); assert.equal(result.text.decoration, 'underline line-through'); assert.equal(result.text.italic, true); assert.equal(result.text.letterSpacing, 3); assert.equal(result.text.textCase, 'uppercase');
});

test('approved color names are case insensitive', () => { assert.equal(styleColor('TRANSPARENT', .5), 'rgba(0,0,0,0)'); assert.equal(styleColor('WHITE', .25), 'rgba(255,255,255,0.25)'); });

test('overlapping border widths shrink to the authored outer dimensions', () => { const n=node('rectangle',{borderSides:{top:80,right:160,bottom:80,left:160}}),m=resolveNodeVisual(n);assert.deepEqual(m.border,{top:50,right:100,bottom:50,left:100});assert.equal(m.inner.width,0);assert.equal(m.inner.height,0); });
