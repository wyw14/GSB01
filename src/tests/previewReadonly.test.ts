import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';

import { Allele, Genotype, GameState, Plant, CrossBreedResponse } from '../shared/types';
import { genotypeToPhenotype, generateName } from '../server/genetics/genotypeToPhenotype';
import { app } from '../server/index';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'gamestate.json');
const PREVIEW_URL = '/api/crossbreed/preview';

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// 快照当前存档：记录“是否存在”与原始字节，供用例结束后精确还原，保证测试可重复。
type StateSnapshot = { existed: boolean; content: string | null };

function snapshotState(): StateSnapshot {
  if (fs.existsSync(STATE_FILE)) {
    return { existed: true, content: fs.readFileSync(STATE_FILE, 'utf-8') };
  }
  return { existed: false, content: null };
}

function restoreState(snapshot: StateSnapshot): void {
  if (snapshot.existed && snapshot.content !== null) {
    fs.writeFileSync(STATE_FILE, snapshot.content, 'utf-8');
  } else if (fs.existsSync(STATE_FILE)) {
    fs.rmSync(STATE_FILE);
  }
}

function homozygous(a: Allele, b: Allele, c: Allele, d: Allele, e: Allele): Genotype {
  return {
    glowColor: [a, a],
    leafShape: [b, b],
    plantSize: [c, c],
    glowIntensity: [d, d],
    specialTrait: [e, e]
  };
}

function makePlant(id: string, genotype: Genotype): Plant {
  const phenotype = genotypeToPhenotype(genotype);
  return { id, name: generateName(phenotype), genotype, phenotype, generation: 0, isMutant: false };
}

function previewRequest(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${PREVIEW_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('预览：存档不存在时不创建文件（严格只读）', async () => {
  const { server, baseUrl } = await startServer();
  const snapshot = snapshotState();
  try {
    // 先获取合法亲本 ID（此调用允许创建存档），随后删除文件，验证预览不会重建它。
    const state = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;

    if (fs.existsSync(STATE_FILE)) {
      fs.rmSync(STATE_FILE);
    }
    assert.equal(fs.existsSync(STATE_FILE), false, '前置条件：存档应已删除');

    const res = await previewRequest(baseUrl, { parent1Id: p1, parent2Id: p2, uvLevel: 50 });
    assert.equal(res.status, 409, '存档不存在应返回错误而非静默创建');
    assert.equal(fs.existsSync(STATE_FILE), false, '预览不得创建存档文件');
  } finally {
    server.close();
    restoreState(snapshot);
  }
});

test('预览：存档损坏时不改写文件原始内容', async () => {
  const { server, baseUrl } = await startServer();
  const snapshot = snapshotState();
  try {
    const corrupted = '{ this is not valid json ]';
    fs.writeFileSync(STATE_FILE, corrupted, 'utf-8');

    const res = await previewRequest(baseUrl, { parent1Id: 'a', parent2Id: 'b', uvLevel: 0 });
    assert.equal(res.status, 409, '损坏存档应返回错误');

    const after = fs.readFileSync(STATE_FILE, 'utf-8');
    assert.equal(after, corrupted, '预览不得修复或重写损坏的存档');
  } finally {
    server.close();
    restoreState(snapshot);
  }
});

test('预览：存档需要归一化时不落盘（内存归一化）', async () => {
  const { server, baseUrl } = await startServer();
  const snapshot = snapshotState();
  try {
    const parent1 = makePlant('parent-1', homozygous('A', 'B', 'C', 'D', 'E'));
    const parent2 = makePlant('parent-2', homozygous('a', 'b', 'c', 'd', 'e'));
    // 构造需归一化的存档：uvLevel 越界、unlockedSpecies 含重复与非法项、selectedParent2 与 1 相同。
    // loadGameState 会把这些修正并回写；readGameStateReadOnly 必须只在内存修正、不落盘。
    const needsNormalizing: GameState = {
      plants: [parent1, parent2],
      unlockedSpecies: ['crystal-moss', 'crystal-moss', 'not-a-real-species'],
      uvLevel: 150,
      selectedParent1: 'parent-1',
      selectedParent2: 'parent-1'
    };
    const original = JSON.stringify(needsNormalizing, null, 2);
    fs.writeFileSync(STATE_FILE, original, 'utf-8');

    const res = await previewRequest(baseUrl, {
      parent1Id: 'parent-1',
      parent2Id: 'parent-2',
      uvLevel: 50
    });
    assert.equal(res.status, 200, '合法预览请求应成功');

    const after = fs.readFileSync(STATE_FILE, 'utf-8');
    assert.equal(after, original, '预览不得因归一化而重写存档');
  } finally {
    server.close();
    restoreState(snapshot);
  }
});

test('预览：四类错误请求均不写存档', async () => {
  const { server, baseUrl } = await startServer();
  const snapshot = snapshotState();
  try {
    const state = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    const id = state.plants[0].id;
    const otherId = state.plants[1].id;

    const before = fs.readFileSync(STATE_FILE, 'utf-8');

    // 1) 缺少亲本；2) 亲本相同；3) 亲本不存在；4) UV 越界。
    const cases: Array<{ body: Record<string, unknown>; status: number }> = [
      { body: { parent2Id: otherId, uvLevel: 0 }, status: 400 },
      { body: { parent1Id: id, parent2Id: id, uvLevel: 0 }, status: 400 },
      { body: { parent1Id: id, parent2Id: 'missing', uvLevel: 0 }, status: 404 },
      { body: { parent1Id: id, parent2Id: otherId, uvLevel: 150 }, status: 400 }
    ];

    for (const c of cases) {
      const res = await previewRequest(baseUrl, c.body);
      assert.equal(res.status, c.status, `错误请求应返回 ${c.status}`);
    }

    const after = fs.readFileSync(STATE_FILE, 'utf-8');
    assert.equal(after, before, '任何错误预览请求都不得改写存档');
  } finally {
    server.close();
    restoreState(snapshot);
  }
});

test('杂交：使用请求携带的 UV，并在预览后能新增一株后代', async () => {
  const { server, baseUrl } = await startServer();
  const snapshot = snapshotState();
  try {
    const state = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;
    const plantsBefore = state.plants.length;

    // 模拟“UV 从 100 改到 0”：先把存档 UV 设为 100 并等待完成。
    await fetch(`${baseUrl}/api/uv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uvLevel: 100 })
    });

    // 立即发起“改为 0”的保存（不等待）与预览，再紧接着以当前 UV=0 执行真实杂交。
    const uvSave = fetch(`${baseUrl}/api/uv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uvLevel: 0 })
    });
    const previewRes = await previewRequest(baseUrl, { parent1Id: p1, parent2Id: p2, uvLevel: 0 });
    assert.equal(previewRes.status, 200);

    const crossRes = await fetch(`${baseUrl}/api/crossbreed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 0 })
    });
    assert.equal(crossRes.status, 200, '预览后真实杂交应成功');
    const crossResult = await readJson<CrossBreedResponse>(crossRes);
    assert.ok(crossResult.offspring, '杂交应返回后代');

    await uvSave;

    const afterState = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    assert.equal(afterState.plants.length, plantsBefore + 1, '应新增一株后代');
    // 显示/预览/真实杂交所用的 UV 一致：最终存档 UV 为当前值 0。
    assert.equal(afterState.uvLevel, 0, '最终存档 UV 应与当前值一致');
  } finally {
    server.close();
    restoreState(snapshot);
  }
});
