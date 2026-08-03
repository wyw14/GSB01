import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Genotype, Plant, GameState, CrossBreedPreviewResponse } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../../shared/constants';
import { roundPercentages } from '../../shared/probability';
import { computeCrossBreedPreview } from '../genetics/crossbreedPreview';
import { genotypeToPhenotype } from '../genetics/genotypeToPhenotype';

const EPS = 1e-12;

function makeGenotype(dominantCounts: Record<string, 0 | 1 | 2>): Genotype {
  const genotype = {} as Genotype;
  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    const count = dominantCounts[gene];
    if (count === 2) genotype[gene] = [info.dominantAllele, info.dominantAllele];
    else if (count === 1) genotype[gene] = [info.dominantAllele, info.recessiveAllele];
    else genotype[gene] = [info.recessiveAllele, info.recessiveAllele];
  }
  return genotype;
}

const ALL_HETERO = makeGenotype({ glowColor: 1, leafShape: 1, plantSize: 1, glowIntensity: 1, specialTrait: 1 });
const ALL_DOM_HOMO = makeGenotype({ glowColor: 2, leafShape: 2, plantSize: 2, glowIntensity: 2, specialTrait: 2 });
const ALL_REC_HOMO = makeGenotype({ glowColor: 0, leafShape: 0, plantSize: 0, glowIntensity: 0, specialTrait: 0 });

function outcomeProb(preview: CrossBreedPreviewResponse, gene: keyof Genotype, value: string | null): number {
  const trait = preview.traits.find(t => t.gene === gene)!;
  return trait.outcomes.find(o => o.value === value)!.probability;
}

function speciesProb(preview: CrossBreedPreviewResponse, speciesId: string): number {
  return preview.speciesUnlocks.find(s => s.speciesId === speciesId)!.probability;
}

test('roundPercentages 舍入后合计为 100.00', () => {
  const thirds = roundPercentages([1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(thirds, ['33.34', '33.33', '33.33']);
  assert.equal(thirds.reduce((s, v) => s + Number(v), 0).toFixed(2), '100.00');

  assert.deepEqual(roundPercentages([0.5, 0.25, 0.25]), ['50.00', '25.00', '25.00']);
  assert.deepEqual(roundPercentages([1, 0]), ['100.00', '0.00']);
  // 最大余数法：余数最大的项获得进位
  const odd = roundPercentages([0.42625, 0.34125, 0.2325]);
  assert.equal(odd.reduce((s, v) => s + Number(v), 0).toFixed(2), '100.00');
});

test('纯合亲本（显性纯合 × 隐性纯合）UV=0：性状分布只受基础突变率影响', () => {
  // UV=0 时单等位基因突变率 r=0.02；子代固定 1 个显性等位基因，
  // 隐性表型概率 = r(1-r) = 0.0196，显性 = 1 - 0.0196 = 0.9804
  const preview = computeCrossBreedPreview('p1', 'p2', ALL_DOM_HOMO, ALL_REC_HOMO, 0, []);
  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    assert.ok(Math.abs(outcomeProb(preview, gene, info.dominantTrait) - 0.9804) < EPS, `${gene} 显性应为 0.9804`);
  }
  // 突变可能把某个基因翻成显性纯合：星辉巨灵解锁概率 = (r(1-r))^5
  assert.ok(Math.abs(speciesProb(preview, 'starlight-titan') - Math.pow(0.0196, 5)) < 1e-15);
});

test('杂合亲本（Aa × Aa）UV=0：每类性状 75% 显性 / 25% 隐性', () => {
  const preview = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 0, []);
  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    const recessiveValue = gene === 'specialTrait' ? null : info.recessiveTrait;
    assert.ok(Math.abs(outcomeProb(preview, gene, info.dominantTrait) - 0.75) < EPS, `${gene} 显性应为 0.75`);
    assert.ok(Math.abs(outcomeProb(preview, gene, recessiveValue) - 0.25) < EPS, `${gene} 隐性应为 0.25`);
  }
});

test('UV=0 与 UV=100 的整株突变概率符合公式 1-(1-r)^10', () => {
  const uv0 = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 0, []);
  const expected0 = 1 - Math.pow(1 - 0.02, 10);
  assert.ok(Math.abs(uv0.mutationProbability - expected0) < EPS);

  const uv100 = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 100, []);
  const expected100 = 1 - Math.pow(1 - 0.1, 10);
  assert.ok(Math.abs(uv100.mutationProbability - expected100) < EPS);
  assert.ok(uv100.mutationProbability > uv0.mutationProbability, 'UV 越高突变概率越大');
});

test('UV=100 时杂合×杂合性状分布保持对称，纯合×纯合受突变影响', () => {
  // 对称杂交：突变对显/隐性影响对称，隐性概率仍为 0.25
  const het = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 100, []);
  assert.ok(Math.abs(outcomeProb(het, 'glowColor', 'magenta') - 0.25) < EPS);

  // 显性纯合 × 隐性纯合：子代固定 1 个显性等位基因，
  // 隐性表型概率 = 显性翻转(r) × 隐性不翻转(1-r) = 0.1 * 0.9 = 0.09
  const homo = computeCrossBreedPreview('p1', 'p2', ALL_DOM_HOMO, ALL_REC_HOMO, 100, []);
  assert.ok(Math.abs(outcomeProb(homo, 'glowColor', 'magenta') - 0.09) < EPS);
  assert.ok(Math.abs(outcomeProb(homo, 'glowColor', 'cyan') - 0.91) < EPS);
});

test('多个物种条件重叠时按优先级实际解锁（杂合×杂合 UV=0）', () => {
  const preview = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 0, []);

  // 星辉巨灵优先级最高：5 个基因全部显性纯合，概率 (1/4)^5
  assert.ok(Math.abs(speciesProb(preview, 'starlight-titan') - Math.pow(0.25, 5)) < EPS);

  // 晶光苔匹配条件为 glowColor=Aa 且 leafShape=BB（P=0.125），
  // 但巨光晶(CC∧DD)与幽暗微灵(cc∧dd)优先级更高且条件重叠，
  // 实际解锁概率 = 0.125 × (1 - 1/16 - 1/16) = 0.109375
  assert.ok(Math.abs(speciesProb(preview, 'crystal-moss') - 0.109375) < EPS);

  // 已解锁的物种不再出现
  const withUnlocked = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_HETERO, 0, ['crystal-moss']);
  assert.equal(withUnlocked.speciesUnlocks.find(s => s.speciesId === 'crystal-moss'), undefined);
});

test('每组概率精确合计为 1，百分比舍入后合计为 100.00', () => {
  const preview = computeCrossBreedPreview('p1', 'p2', ALL_HETERO, ALL_REC_HOMO, 73, []);

  for (const trait of preview.traits) {
    const sum = trait.outcomes.reduce((s, o) => s + o.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${trait.gene} 概率合计应为 1`);
    const pctSum = trait.outcomes.reduce((s, o) => s + Number(o.percentage), 0);
    assert.equal(pctSum.toFixed(2), '100.00', `${trait.gene} 百分比合计应为 100.00`);
    for (const o of trait.outcomes) {
      assert.match(o.percentage, /^\d+\.\d{2}$/, '百分比需保留两位小数');
    }
  }

  const speciesSum = preview.speciesUnlocks.reduce((s, sp) => s + sp.probability, 0) + preview.noNewSpeciesProbability;
  assert.ok(Math.abs(speciesSum - 1) < 1e-9, '物种组概率合计应为 1');
  const speciesPctSum = preview.speciesUnlocks.reduce((s, sp) => s + Number(sp.percentage), 0) + Number(preview.noNewSpeciesPercentage);
  assert.equal(speciesPctSum.toFixed(2), '100.00', '物种组百分比合计应为 100.00');
});

// ---------- 路由级测试：只读性与原有杂交流程 ----------

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

let tmpDir: string;
let server: Server;
let baseUrl: string;
let stateFile: string;

const SEED_STATE: GameState = {
  plants: [makePlant('plant-het', ALL_HETERO), makePlant('plant-dom', ALL_DOM_HOMO)],
  unlockedSpecies: [],
  uvLevel: 0,
  selectedParent1: 'plant-het',
  selectedParent2: 'plant-dom'
};

async function post(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
  stateFile = path.join(tmpDir, 'gamestate.json');
  process.env.GAME_DATA_DIR = tmpDir;

  const { saveGameState } = await import('../storage/jsonStorage');
  saveGameState(SEED_STATE);

  const app = (await import('../index')).default;
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.GAME_DATA_DIR;
});

test('连续预览不修改存档文件', async () => {
  const before1 = fs.readFileSync(stateFile, 'utf-8');

  const res1 = await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: 50 });
  assert.equal(res1.status, 200);
  const res2 = await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: 50 });
  assert.equal(res2.status, 200);

  const after1 = fs.readFileSync(stateFile, 'utf-8');
  assert.equal(after1, before1, '预览不应写入存档');

  const preview = res1.body as unknown as CrossBreedPreviewResponse;
  assert.equal(preview.uvLevel, 50);
  assert.equal(preview.traits.length, 5);
  assert.equal(preview.speciesUnlocks.length, 7);
  assert.deepEqual(res2.body, res1.body, '相同输入的预览结果应一致');
});

test('预览参数校验给出明确错误', async () => {
  assert.equal((await post('/api/preview', { parent2Id: 'plant-dom' })).status, 400);
  const sameParent = await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-het' });
  assert.equal(sameParent.status, 400);
  assert.equal(sameParent.body.error, 'Parents must be two different plants');

  assert.equal((await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'deleted-plant' })).status, 404);
  assert.equal((await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: 101 })).status, 400);
  assert.equal((await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: -1 })).status, 400);
});

test('预览不传 uvLevel 时使用存档中的 UV', async () => {
  const res = await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom' });
  assert.equal(res.status, 200);
  assert.equal((res.body as unknown as CrossBreedPreviewResponse).uvLevel, SEED_STATE.uvLevel);
});

test('预览后原有杂交仍能正常使用', async () => {
  await post('/api/preview', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: 0 });

  const before = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as GameState;
  const res = await post('/api/crossbreed', { parent1Id: 'plant-het', parent2Id: 'plant-dom', uvLevel: 0 });
  assert.equal(res.status, 200);

  const afterState = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as GameState;
  assert.equal(afterState.plants.length, before.plants.length + 1, '杂交应新增一株子代');
  assert.equal(afterState.selectedParent1, null);
  assert.equal(afterState.selectedParent2, null);
});
