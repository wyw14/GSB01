import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as assert from 'assert';
import type { Server } from 'http';
import express from 'express';
import type { CrossBreedPreviewResponse } from '../../shared/types';

// 必须在 require 业务模块前设置临时数据目录，确保 storage 模块读取到测试路径
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alien-plant-test-'));
process.env.GAME_DATA_DIR = TEST_DATA_DIR;
process.env.PORT = '0';

// gameRouter 间接加载 jsonStorage，后者在模块加载时读取 GAME_DATA_DIR
// 因此必须在设置环境变量后再 require，不能使用顶层 import
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gameRouter: express.Router = (require('../routes/gameRouter') as { default: express.Router }).default;

function createTestServer(): Promise<{ server: Server; baseUrl: string; cleanup: () => void }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/api', gameRouter);
    const server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          server,
          baseUrl: `http://127.0.0.1:${addr.port}`,
          cleanup: () => {
            server.close();
          }
        });
      }
    });
  });
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}

function getSnapshot(): string | null {
  const stateFile = path.join(TEST_DATA_DIR, 'gamestate.json');
  if (!fs.existsSync(stateFile)) return null;
  return fs.readFileSync(stateFile, 'utf-8');
}

function fileExists(): boolean {
  return fs.existsSync(path.join(TEST_DATA_DIR, 'gamestate.json'));
}

function dirExists(): boolean {
  return fs.existsSync(TEST_DATA_DIR) && fs.statSync(TEST_DATA_DIR).isDirectory();
}

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => Promise<void> | void): void {
  const run = async (): Promise<void> => {
    try {
      await fn();
      testsPassed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      testsFailed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(error as Error).message}`);
    }
  };
  tests.push(run);
}

const tests: (() => Promise<void>)[] = [];

async function main(): Promise<void> {
  const { server, baseUrl, cleanup } = await createTestServer();

  console.log('\n🔌 接口级回归测试\n');

  let parent1Id = '';
  let parent2Id = '';
  const allSpeciesIds = [
    'crystal-moss', 'magenta-vine', 'giant-glow-crystal',
    'dim-sprite', 'floating-lotus', 'abyss-spirit', 'starlight-titan'
  ];

  // ========== 测试1：七个物种均未解锁时返回全部7个（含0.00%） ==========
  test('七个物种均未解锁时返回全部7个，含0.00%结果', async () => {
    // 先通过API重置并获取初始状态
    const resetRes = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    const state = await resetRes.json() as { plants: { id: string; genotype: { glowColor: string[] } }[]; unlockedSpecies: string[]; uvLevel: number };

    assert.strictEqual(state.unlockedSpecies.length, 0, '初始应无已解锁物种');

    parent1Id = state.plants[0].id;
    parent2Id = state.plants[1].id;

    const { status, data } = await postJson<CrossBreedPreviewResponse>(`${baseUrl}/api/preview`, {
      parent1Id,
      parent2Id,
      uvLevel: 0
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.speciesUnlockProbabilities.length, 7,
      `应返回7个未解锁物种，实际返回${data.speciesUnlockProbabilities.length}个`);

    // 验证所有7个物种ID都在结果中
    const resultIds = data.speciesUnlockProbabilities.map(s => s.speciesId);
    for (const id of allSpeciesIds) {
      assert.ok(resultIds.includes(id), `结果中应包含物种 ${id}`);
    }

    // 验证至少有一个物种概率为0.00%
    const zeroProbs = data.speciesUnlockProbabilities.filter(s => s.probability === 0);
    assert.ok(zeroProbs.length > 0, '应至少有一个物种概率为0.00%');

    // 验证所有概率保留两位小数
    for (const sp of data.speciesUnlockProbabilities) {
      const rounded = Math.round(sp.probability * 100) / 100;
      assert.ok(Math.abs(sp.probability - rounded) < 1e-9,
        `${sp.speciesName} 概率${sp.probability}应保留两位小数`);
    }

    // 物种概率不要求合计100%
    const totalProb = data.speciesUnlockProbabilities.reduce((a, s) => a + s.probability, 0);
    console.log(`    (七个物种概率合计: ${totalProb.toFixed(2)}%，不要求100%)`);
  });

  // ========== 测试2：连续预览不创建或改写存档 ==========
  test('存档不存在时连续预览不创建文件或目录', async () => {
    // 清空目录
    for (const f of fs.readdirSync(TEST_DATA_DIR)) {
      fs.unlinkSync(path.join(TEST_DATA_DIR, f));
    }
    fs.rmdirSync(TEST_DATA_DIR);
    assert.ok(!dirExists(), '测试前置：目录应不存在');

    // 多次预览请求（错误请求和正常请求）
    await postJson(`${baseUrl}/api/preview`, {
      parent1Id: 'fake1',
      parent2Id: 'fake2',
      uvLevel: 0
    });
    await postJson(`${baseUrl}/api/preview`, {
      parent1Id: 'fake1',
      parent2Id: 'fake2',
      uvLevel: 100
    });
    await postJson(`${baseUrl}/api/preview`, {
      parent1Id: '',
      parent2Id: '',
      uvLevel: 0
    });

    assert.ok(!dirExists(), '预览不应创建数据目录');
    assert.ok(!fileExists(), '预览不应创建存档文件');

    // 重建目录供后续测试使用
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  test('已有存档时连续预览不改变存档内容', async () => {
    // 先通过正常流程初始化存档
    await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    const before = getSnapshot();
    assert.ok(before !== null, '存档应存在');

    const state = await (await fetch(`${baseUrl}/api/state`)).json() as { plants: { id: string }[] };
    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;

    // 连续5次预览，使用不同UV
    for (const uv of [0, 25, 50, 75, 100]) {
      await postJson(`${baseUrl}/api/preview`, { parent1Id: p1, parent2Id: p2, uvLevel: uv });
    }

    const after = getSnapshot();
    assert.strictEqual(after, before, '连续预览后存档内容不应改变');
  });

  // ========== 测试3：四类错误请求不写存档 ==========
  test('四类错误请求均不写存档', async () => {
    await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    const state = await (await fetch(`${baseUrl}/api/state`)).json() as { plants: { id: string }[] };
    const p1 = state.plants[0].id;
    const before = getSnapshot();

    // MISSING_PARENT
    const r1 = await postJson(`${baseUrl}/api/preview`, { parent1Id: '', parent2Id: '', uvLevel: 0 });
    assert.strictEqual(r1.status, 400);
    assert.strictEqual((r1.data as { code: string }).code, 'MISSING_PARENT');

    // SAME_PARENT
    const r2 = await postJson(`${baseUrl}/api/preview`, { parent1Id: p1, parent2Id: p1, uvLevel: 0 });
    assert.strictEqual(r2.status, 400);
    assert.strictEqual((r2.data as { code: string }).code, 'SAME_PARENT');

    // UV_OUT_OF_RANGE
    const r3 = await postJson(`${baseUrl}/api/preview`, { parent1Id: p1, parent2Id: state.plants[1].id, uvLevel: 150 });
    assert.strictEqual(r3.status, 400);
    assert.strictEqual((r3.data as { code: string }).code, 'UV_OUT_OF_RANGE');

    // PARENT_NOT_FOUND
    const r4 = await postJson(`${baseUrl}/api/preview`, { parent1Id: 'nonexist1', parent2Id: 'nonexist2', uvLevel: 0 });
    assert.strictEqual(r4.status, 404);
    assert.strictEqual((r4.data as { code: string }).code, 'PARENT_NOT_FOUND');

    const after = getSnapshot();
    assert.strictEqual(after, before, '错误请求不应写存档');
  });

  // ========== 测试4：快速改变UV后立即杂交，使用同一UV ==========
  test('预览使用UV=0后立即杂交也使用UV=0（非旧值）', async () => {
    // 重置并设置服务器UV为100
    await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    await postJson(`${baseUrl}/api/uv`, { uvLevel: 100 });

    const state = await (await fetch(`${baseUrl}/api/state`)).json() as {
      plants: { id: string }[];
      uvLevel: number;
      selectedParent1: string | null;
      selectedParent2: string | null;
    };
    assert.strictEqual(state.uvLevel, 100, '前置：服务器UV应为100');
    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;

    const beforeCount = state.plants.length;

    // 预览使用UV=0（新值，模拟滑块刚拖到0）
    const previewRes = await postJson<CrossBreedPreviewResponse>(`${baseUrl}/api/preview`, {
      parent1Id: p1,
      parent2Id: p2,
      uvLevel: 0
    });
    assert.strictEqual(previewRes.status, 200);
    // UV=0时突变概率应约为18.29%
    assert.ok(Math.abs(previewRes.data.mutationProbability - 18.29) < 0.1,
      `预览UV=0突变概率应约18.29%，实际${previewRes.data.mutationProbability}%`);

    // 立即杂交，也使用UV=0（不等UV保存完成）
    const crossRes = await postJson<{
      offspring: { isMutant: boolean };
    }>(`${baseUrl}/api/crossbreed`, {
      parent1Id: p1,
      parent2Id: p2,
      uvLevel: 0
    });
    assert.strictEqual(crossRes.status, 200, '杂交应成功');

    // 验证存档UV已被持久化为0（而非旧值100）
    const afterState = await (await fetch(`${baseUrl}/api/state`)).json() as {
      uvLevel: number;
      plants: unknown[];
    };
    assert.strictEqual(afterState.uvLevel, 0, '杂交后存档UV应为0（与预览一致）');
    assert.strictEqual(afterState.plants.length, beforeCount + 1, '杂交应新增一株后代');
  });

  // ========== 测试5：调用预览后真实杂确实新增一株后代 ==========
  test('预览后执行杂交，植物数量恰好增加1', async () => {
    await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    const stateBefore = await (await fetch(`${baseUrl}/api/state`)).json() as {
      plants: { id: string }[];
    };
    const p1 = stateBefore.plants[0].id;
    const p2 = stateBefore.plants[1].id;
    const countBefore = stateBefore.plants.length;

    // 多次预览
    for (let i = 0; i < 3; i++) {
      await postJson(`${baseUrl}/api/preview`, { parent1Id: p1, parent2Id: p2, uvLevel: 50 });
    }

    // 预览不改变植物数量
    const stateAfterPreview = await (await fetch(`${baseUrl}/api/state`)).json() as { plants: unknown[] };
    assert.strictEqual(stateAfterPreview.plants.length, countBefore, '预览不应增加植物');

    // 执行杂交
    const crossRes = await postJson(`${baseUrl}/api/crossbreed`, {
      parent1Id: p1,
      parent2Id: p2,
      uvLevel: 50
    });
    assert.strictEqual(crossRes.status, 200, '杂交应成功');
    assert.ok((crossRes.data as { offspring: unknown }).offspring, '应返回后代');

    // 杂交后植物数量恰好+1
    const stateAfterCross = await (await fetch(`${baseUrl}/api/state`)).json() as { plants: unknown[] };
    assert.strictEqual(stateAfterCross.plants.length, countBefore + 1,
      `杂交后应恰好增加1株，实际从${countBefore}变为${stateAfterCross.plants.length}`);
  });

  // 运行所有测试
  for (const t of tests) {
    await t();
  }

  cleanup();

  // 清理临时目录
  try {
    for (const f of fs.readdirSync(TEST_DATA_DIR)) {
      fs.unlinkSync(path.join(TEST_DATA_DIR, f));
    }
    fs.rmdirSync(TEST_DATA_DIR);
  } catch {
    // ignore cleanup errors
  }

  console.log('\n' + '='.repeat(50));
  console.log(`接口测试结果: ${testsPassed} 通过, ${testsFailed} 失败`);
  console.log('='.repeat(50) + '\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
