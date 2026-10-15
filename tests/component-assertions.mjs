import assert from 'node:assert/strict';
import { STYLE_KEYS } from '../app/core/style-model.mjs';

/** Detaching materializes local style provenance, while every other field,
 * including interaction data, image data, IDs and geometry must stay equal. */
export function assertSameDetachedNodes(actual, expected) {
  const strip=nodes=>nodes.map(({styleOverrideKeys,...node})=>node);
  assert.deepEqual(strip(actual),strip(expected));
  for(let index=0;index<actual.length;index++) {
    if(JSON.stringify(actual[index].styleOverrideKeys)!==JSON.stringify(expected[index].styleOverrideKeys)) {
      assert.deepEqual(new Set(actual[index].styleOverrideKeys),new Set(STYLE_KEYS),'detached appearance must become an explicit complete local style');
    }
  }
}
