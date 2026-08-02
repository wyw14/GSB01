import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameState } from '../../shared/types';
import { applyParentSelection, applyPlantRemoval } from '../../shared/stateTransitions';
import { createLatestRequestTracker } from '../../shared/latestRequest';

function makeState(): GameState {
  return {
    plants: [
      { id: 'a', name: 'a', genotype: {} as GameState['plants'][number]['genotype'], phenotype: {} as GameState['plants'][number]['phenotype'], generation: 0, isMutant: false },
      { id: 'b', name: 'b', genotype: {} as GameState['plants'][number]['genotype'], phenotype: {} as GameState['plants'][number]['phenotype'], generation: 0, isMutant: false }
    ],
    unlockedSpecies: [],
    uvLevel: 0,
    selectedParent1: null,
    selectedParent2: null
  };
}

test('亲本选择转移：选入、再次点击取消、另一槽去重', () => {
  let state = makeState();

  state = applyParentSelection(state, 'a', 1);
  assert.equal(state.selectedParent1, 'a');

  state = applyParentSelection(state, 'b', 2);
  assert.equal(state.selectedParent2, 'b');

  // 再次点击同一植物：取消选择
  state = applyParentSelection(state, 'a', 1);
  assert.equal(state.selectedParent1, null);
  assert.equal(state.selectedParent2, 'b');

  // 把已在槽2的植物选入槽1：槽2被清理，避免同一植物占两槽
  state = applyParentSelection(state, 'b', 1);
  assert.equal(state.selectedParent1, 'b');
  assert.equal(state.selectedParent2, null);
});

test('删除植物转移：移除植物并清空指向它的亲本槽', () => {
  let state = makeState();
  state = applyParentSelection(state, 'a', 1);
  state = applyParentSelection(state, 'b', 2);

  state = applyPlantRemoval(state, 'a');
  assert.equal(state.plants.length, 1);
  assert.equal(state.selectedParent1, null, '被删植物的亲本槽应清空');
  assert.equal(state.selectedParent2, 'b', '另一槽不受影响');
});

test('取消/删除亲本的点击瞬间即废止在途预览，旧响应不得覆盖提示', async () => {
  const tracker = createLatestRequestTracker();
  let state = makeState();
  state = applyParentSelection(state, 'a', 1);
  state = applyParentSelection(state, 'b', 2);

  // 模拟：预览请求在途（令牌已发放）
  const inflightToken = tracker.invalidate();

  // 模拟：用户在服务端响应返回前点击取消亲本（乐观更新 + 同步废止）
  const clickTimeState = applyParentSelection(state, 'a', 1);
  tracker.invalidate();

  // 延迟到达的旧预览响应必须被丢弃
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(tracker.isLatest(inflightToken), false);
  assert.equal(clickTimeState.selectedParent1, null, '点击瞬间亲本已在本地清空');
});
