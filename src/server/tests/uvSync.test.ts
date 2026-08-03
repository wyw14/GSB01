import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameState } from '../../shared/types';
import { applyUVLevelLocally, mergeUVResponse } from '../../shared/uvSync';

function makeState(uvLevel: number): GameState {
  return {
    plants: [],
    unlockedSpecies: [],
    uvLevel,
    selectedParent1: 'parent-1',
    selectedParent2: 'parent-2'
  };
}

test('滑块改变后 UV 立即本地生效：预览与杂交随即使用新值', () => {
  const state = makeState(0);
  const updated = applyUVLevelLocally(state, 80);

  // 模拟 handleUVChange 之后立即构建杂交/预览请求：必须使用新 UV
  assert.equal(updated.uvLevel, 80);
  // 亲本选择等其它状态不受影响
  assert.equal(updated.selectedParent1, 'parent-1');
  assert.equal(updated.selectedParent2, 'parent-2');
  // 原状态不被修改
  assert.equal(state.uvLevel, 0);
});

test('乱序响应不会把旧 UV 覆盖回来', () => {
  // 快速拖动：先发出 UV=30 的请求，再发出 UV=90 的请求
  let state = applyUVLevelLocally(makeState(0), 30);
  state = applyUVLevelLocally(state, 90);

  // UV=30 的响应后到（乱序），不是最后一次操作，必须被忽略
  const stale = mergeUVResponse(state, makeState(30), false);
  assert.equal(stale.uvLevel, 90, '过期响应不应覆盖最新 UV');

  // UV=90 的响应到达且为最后一次操作，正常合并
  const latest = mergeUVResponse(state, makeState(90), true);
  assert.equal(latest.uvLevel, 90);
});

test('合并响应只更新 uvLevel，不覆盖等待期间的本地状态', () => {
  const local = applyUVLevelLocally(makeState(0), 60);
  // 等待响应期间服务端状态中的亲本选择已被清空（例如其它操作）
  const response: GameState = { ...makeState(60), selectedParent1: null, selectedParent2: null };

  const merged = mergeUVResponse(local, response, true);
  assert.equal(merged.uvLevel, 60);
  assert.equal(merged.selectedParent1, 'parent-1', '响应不应覆盖本地亲本选择');
  assert.equal(merged.selectedParent2, 'parent-2');
});
