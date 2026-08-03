import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PreviewRequestController,
  validatePreviewInputs
} from '../client/previewController';

// 模拟一次“合法预览在途 → 期间亲本/UV 变化 → 旧响应回来”的时序，
// 断言旧响应因令牌过期被丢弃，不会覆盖当前提示。

type RenderTarget = { text: string | null; preview: string | null };

function makeRenderer() {
  const target: RenderTarget = { text: null, preview: null };
  return {
    target,
    renderMessage: (msg: string) => {
      target.text = msg;
      target.preview = null;
    },
    renderPreview: (label: string) => {
      target.preview = label;
      target.text = null;
    }
  };
}

// 用受控 Promise 模拟慢响应。
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('废止：合法预览在途时亲本变同株，旧成功响应不得覆盖当前提示', async () => {
  const controller = new PreviewRequestController();
  const r = makeRenderer();

  // 第 1 次：合法预览，请求慢。
  const token1 = controller.begin();
  const slow = deferred<string>();
  const call1 = (async () => {
    const preview = await slow.promise;
    if (!controller.isCurrent(token1)) return; // 应命中：已过期
    r.renderPreview(preview);
  })();

  // 第 2 次：亲本变为同一株 → 立即渲染提示（废止 token1）。
  const token2 = controller.begin();
  const msg2 = validatePreviewInputs({
    selectedParent1: 'same',
    selectedParent2: 'same',
    uvLevel: 50,
    plantExists: () => true
  });
  assert.equal(msg2, '请选择两株不同的亲本植物。');
  assert.ok(controller.isCurrent(token2));
  r.renderMessage(msg2!);

  // 现在旧的慢响应才返回。
  slow.resolve('OLD-PREVIEW');
  await call1;

  assert.equal(r.target.preview, null, '过期预览不得写入');
  assert.equal(r.target.text, '请选择两株不同的亲本植物。', '当前提示必须保留');
});

test('废止：合法预览在途时亲本被删除，旧响应被丢弃', async () => {
  const controller = new PreviewRequestController();
  const r = makeRenderer();

  const token1 = controller.begin();
  const slow = deferred<string>();
  const call1 = (async () => {
    const preview = await slow.promise;
    if (!controller.isCurrent(token1)) return;
    r.renderPreview(preview);
  })();

  // 亲本被删除：plantExists 返回 false。
  const token2 = controller.begin();
  const msg = validatePreviewInputs({
    selectedParent1: 'p1',
    selectedParent2: 'p2',
    uvLevel: 10,
    plantExists: (id: string) => id === 'p1' // p2 已删除
  });
  assert.equal(msg, '亲本植物不存在或已被删除。');
  r.renderMessage(msg!);
  assert.ok(controller.isCurrent(token2));

  slow.resolve('OLD');
  await call1;
  assert.equal(r.target.text, '亲本植物不存在或已被删除。');
  assert.equal(r.target.preview, null);
});

test('废止：UV 变为无效值时旧响应不得覆盖，且能识别 UV 越界', async () => {
  const controller = new PreviewRequestController();
  const r = makeRenderer();

  const token1 = controller.begin();
  const slow = deferred<string>();
  const call1 = (async () => {
    const preview = await slow.promise;
    if (!controller.isCurrent(token1)) return;
    r.renderPreview(preview);
  })();

  controller.begin();
  const msg = validatePreviewInputs({
    selectedParent1: 'p1',
    selectedParent2: 'p2',
    uvLevel: 150,
    plantExists: () => true
  });
  assert.equal(msg, '紫外线强度需在 0 到 100 之间。');
  r.renderMessage(msg!);

  slow.resolve('OLD');
  await call1;
  assert.equal(r.target.text, '紫外线强度需在 0 到 100 之间。');
  assert.equal(r.target.preview, null);
});

test('废止：只有最新令牌的响应才会写入 UI', async () => {
  const controller = new PreviewRequestController();
  const t1 = controller.begin();
  const t2 = controller.begin();
  assert.equal(controller.isCurrent(t1), false);
  assert.equal(controller.isCurrent(t2), true);
});

test('废止：亲本变更时同步清掉已渲染的旧预览，旧响应回来也不恢复', async () => {
  // 建模 main.ts 的时序：先渲染出预览面板，随后 handlePlantClick/handleDeletePlant
  // 在 await 之前调用 invalidatePreviewNow()（= controller.begin() + 同步清面板）。
  const controller = new PreviewRequestController();
  const r = makeRenderer();

  // 1) 一次合法预览已完成并渲染出遗传面板。
  const token1 = controller.begin();
  const slow = deferred<string>();
  const call1 = (async () => {
    const preview = await slow.promise;
    if (!controller.isCurrent(token1)) return; // 应命中：已被 invalidate 作废
    r.renderPreview(preview);
  })();
  r.renderPreview('已渲染的旧遗传数字'); // 面板此刻显示旧预览

  // 2) 用户改变亲本 → 同步废止：递增令牌 + 立即清面板（此处以“正在更新预览…”表示）。
  const token2 = controller.begin();
  r.renderMessage('正在更新预览…');
  assert.equal(r.target.preview, null, '旧遗传面板应被同步清除');
  assert.equal(r.target.text, '正在更新预览…');

  // 3) 旧的在途预览响应此时才返回，必须被丢弃。
  slow.resolve('OLD-PREVIEW');
  await call1;
  assert.equal(r.target.preview, null, '过期预览不得恢复');
  assert.equal(r.target.text, '正在更新预览…', '过渡提示应保留，随后由刷新给出新结果');
  assert.ok(controller.isCurrent(token2));
});
