import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Genotype, Plant, GameState, CrossBreedPreviewResponse } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../../shared/constants';
import { genotypeToPhenotype } from '../genetics/genotypeToPhenotype';

function makeGenotype(dominantCount: 0 | 1 | 2): Genotype {
  const genotype = {} as Genotype;
  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    if (dominantCount === 2) genotype[gene] = [info.dominantAllele, info.dominantAllele];
    else if (dominantCount === 1) genotype[gene] = [info.dominantAllele, info.recessiveAllele];
    else genotype[gene] = [info.recessiveAllele, info.recessiveAllele];
  }
  return genotype;
}

function makePlant(id: string, genotype: Genotype): Plant {
  return {
    id,
    name: `test-${id}`,
    genotype,
    phenotype: genotypeToPhenotype(genotype),
    generation: 0,
    isMutant: false
  };
}

let server: Server;
let baseUrl: string;
let tmpRoot: string;
const createdDirs: string[] = [];

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  createdDirs.push(dir);
  process.env.GAME_DATA_DIR = dir;
  return dir;
}

async function postPreview(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-readonly-'));
  const app = (await import('../index')).default;
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

after(() => {
  server.close();
  delete process.env.GAME_DATA_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('存档缺失：预览返回清晰错误且不创建存档文件', async () => {
  const dir = freshDir();
  const stateFile = path.join(dir, 'gamestate.json');

  const res = await postPreview({ parent1Id: 'a', parent2Id: 'b' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'No valid game state available');
  assert.equal(fs.existsSync(stateFile), false, '预览不应创建存档文件');
});

test('存档损坏：预览返回清晰错误且文件内容不变', async () => {
  const dir = freshDir();
  const stateFile = path.join(dir, 'gamestate.json');
  const corrupted = '{"plants": [broken';
  fs.writeFileSync(stateFile, corrupted, 'utf-8');

  const res = await postPreview({ parent1Id: 'a', parent2Id: 'b' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'No valid game state available');
  assert.equal(fs.readFileSync(stateFile, 'utf-8'), corrupted, '损坏的存档不应被覆盖');
});

test('存档需归一化：预览使用内存归一化结果且文件内容不变', async () => {
  const dir = freshDir();
  const stateFile = path.join(dir, 'gamestate.json');
  // uvLevel 超界、selectedParent1 指向不存在的植物：触发归一化
  const dirtyState: GameState = {
    plants: [makePlant('p1', makeGenotype(1)), makePlant('p2', makeGenotype(2))],
    unlockedSpecies: [],
    uvLevel: 150,
    selectedParent1: 'ghost-plant',
    selectedParent2: null
  };
  const raw = JSON.stringify(dirtyState, null, 2);
  fs.writeFileSync(stateFile, raw, 'utf-8');

  const res = await postPreview({ parent1Id: 'p1', parent2Id: 'p2' });
  assert.equal(res.status, 200);
  const preview = res.body as unknown as CrossBreedPreviewResponse;
  assert.equal(preview.uvLevel, 100, '未传 uvLevel 时应使用内存中归一化（钳制到 100）的 UV');
  assert.equal(preview.traits.length, 5);
  assert.equal(fs.readFileSync(stateFile, 'utf-8'), raw, '归一化不应回写存档');
});
