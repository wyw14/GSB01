import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLatestRequestTracker } from '../../shared/latestRequest';
import { createUVSaveQueue } from '../../shared/uvSync';

/** 可手动控制完成时机的 Promise，用于模拟延迟响应 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

test('状态变化立即使在途预览请求失效（取消/删除亲本场景）', () => {
  const tracker = createLatestRequestTracker();

  // 模拟：亲本选好后发出预览请求，拿到令牌
  const staleToken = tracker.invalidate();

  // 模拟：响应未返回时用户取消/删除亲本，状态变化立即废止
  tracker.invalidate();

  // 延迟到达的旧响应必须被丢弃，不允许覆盖“请选择亲本”提示
  assert.equal(tracker.isLatest(staleToken), false);
});

test('延迟响应乱序到达时只应用最新请求的结果', async () => {
  const tracker = createLatestRequestTracker();
  const applied: string[] = [];

  // 请求 A 先发出，响应延迟更久
  const tokenA = tracker.invalidate();
  const slowA = deferred<string>();
  // 请求 B 后发出（如更换亲本），响应更快
  const tokenB = tracker.invalidate();
  const fastB = deferred<string>();

  const renderA = slowA.promise.then(result => {
    if (tracker.isLatest(tokenA)) applied.push(result);
  });
  const renderB = fastB.promise.then(result => {
    if (tracker.isLatest(tokenB)) applied.push(result);
  });

  // B 先返回，A 后返回（乱序）
  fastB.resolve('preview-B');
  slowA.resolve('preview-A');
  await Promise.all([renderA, renderB]);

  assert.deepEqual(applied, ['preview-B'], '旧请求的延迟响应不得覆盖新结果');
});

test('UV 保存按发起顺序串行执行，drain 等待全部落盘', async () => {
  const queue = createUVSaveQueue();
  const executed: number[] = [];
  const gate1 = deferred<void>();
  const gate2 = deferred<void>();

  // 模拟快速拖动滑块产生的三次保存，前两次有延迟
  void queue.enqueue(async () => { await gate1.promise; executed.push(30); });
  void queue.enqueue(async () => { await gate2.promise; executed.push(60); });
  const last = queue.enqueue(async () => { executed.push(100); });

  // 无论各请求实际耗时如何，完成顺序必须等于发起顺序
  gate2.resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  // 用 length 断言而非 deepEqual(executed, [])，避免断言签名把 executed 窄化成 never[]
  assert.equal(executed.length, 0, '前一保存未完成时后续保存不得提前执行');

  gate1.resolve();
  await last;
  assert.deepEqual(executed, [30, 60, 100]);

  // 杂交前 drain：所有已入队保存完成后才返回
  const extra = queue.enqueue(async () => { executed.push(70); });
  await queue.drain();
  await extra;
  assert.deepEqual(executed, [30, 60, 100, 70]);
});

test('单个 UV 保存失败不阻断后续保存与 drain', async () => {
  const queue = createUVSaveQueue();
  const executed: string[] = [];

  void queue.enqueue(async () => { throw new Error('network error'); });
  const next = queue.enqueue(async () => { executed.push('saved'); });

  await next;
  await queue.drain();
  assert.deepEqual(executed, ['saved'], '失败的保存不应卡住队列');
});
