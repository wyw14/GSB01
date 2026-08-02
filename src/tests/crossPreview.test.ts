import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';

import { Allele, Genotype, Plant, GameState, CrossBreedResponse, CrossPreviewResponse } from '../shared/types';
import { GENE_KEYS } from '../shared/constants';
import { genotypeToPhenotype, generateName } from '../server/genetics/genotypeToPhenotype';
import { computeCrossPreview, toPercentagesSummingTo100 } from '../server/genetics/crossPreview';
import { getMutationRate } from '../server/genetics/mendel';
import { app } from '../server/index';

// ---- 测试辅助：构造纯合/杂合亲本 ----
function makePlant(id: string, genotype: Genotype): Plant {
  const phenotype = genotypeToPhenotype(genotype);
  return {
    id,
    name: generateName(phenotype),
    genotype,
    phenotype,
    generation: 0,
    isMutant: false
  };
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

const ALL_DOMINANT = homozygous('A', 'B', 'C', 'D', 'E');
const ALL_RECESSIVE = homozygous('a', 'b', 'c', 'd', 'e');
const HETERO: Genotype = {
  glowColor: ['A', 'a'],
  leafShape: ['B', 'b'],
  plantSize: ['C', 'c'],
  glowIntensity: ['D', 'd'],
  specialTrait: ['E', 'e']
};

function traitByGene(preview: ReturnType<typeof computeCrossPreview>, gene: keyof Genotype) {
  const trait = preview.traits.find(t => t.gene === gene);
  assert.ok(trait, `missing trait ${gene}`);
  return trait!;
}

function sumProbabilities(values: number[]): number {
  // 保留两位小数相加后再四舍五入到两位，避免浮点误差影响合计断言。
  return Math.round(values.reduce((sum, v) => sum + v, 0) * 100) / 100;
}

test('纯合显性亲本 + UV0：受 2% 基础突变率影响，结果为 99.96/0.04', () => {
  // UV0 仍有 2% 基础突变率（getMutationRate(0)=0.02），因此并非确定的 100/0。
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);
  const preview = computeCrossPreview(p1, p2, 0, []);

  const glow = traitByGene(preview, 'glowColor');
  const dominant = glow.outcomes.find(o => o.value === 'cyan');
  const recessive = glow.outcomes.find(o => o.value === 'magenta');
  assert.equal(dominant!.probability, 99.96);
  assert.equal(recessive!.probability, 0.04);
  // 每类性状合计仍为 100.00。
  assert.equal(sumProbabilities(glow.outcomes.map(o => o.probability)), 100);
  // 整株突变概率 = 1-(0.98)^10。
  assert.equal(preview.mutationProbability, 18.29);
});

test('杂合亲本 + UV0：孟德尔 3:1 → 75.00/25.00', () => {
  const p1 = makePlant('p1', HETERO);
  const p2 = makePlant('p2', HETERO);
  const preview = computeCrossPreview(p1, p2, 0, []);

  for (const gene of GENE_KEYS) {
    const trait = traitByGene(preview, gene);
    const dominant = trait.outcomes[0];
    const recessive = trait.outcomes[1];
    assert.equal(dominant.probability, 75);
    assert.equal(recessive.probability, 25);
  }
});

test('UV0 与 UV100：整株突变概率与公式一致', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);

  const preview0 = computeCrossPreview(p1, p2, 0, []);
  const rate0 = getMutationRate(0); // 0.02
  const expected0 = Math.round((1 - Math.pow(1 - rate0, 10)) * 10000) / 100;
  assert.equal(preview0.mutationProbability, expected0);
  assert.equal(expected0, 18.29);

  const preview100 = computeCrossPreview(p1, p2, 100, []);
  const rate = getMutationRate(100); // 0.10
  const expected = Math.round((1 - Math.pow(1 - rate, 10)) * 10000) / 100;
  assert.equal(preview100.mutationProbability, expected);
  assert.equal(expected, 65.13);
});

test('UV100 杂合亲本：每类性状概率合计仍为 100.00', () => {
  const p1 = makePlant('p1', HETERO);
  const p2 = makePlant('p2', HETERO);
  const preview = computeCrossPreview(p1, p2, 100, []);

  for (const trait of preview.traits) {
    assert.equal(sumProbabilities(trait.outcomes.map(o => o.probability)), 100);
  }
});

test('多物种条件重叠：更高特异度物种优先解锁；已解锁后份额转移而非落入“不解锁”', () => {
  const p1 = makePlant('p1', ALL_RECESSIVE);
  const p2 = makePlant('p2', ALL_RECESSIVE);

  // 全隐性后代同时满足 magenta-vine、dim-sprite 与 abyss-spirit，abyss-spirit 特异度最高应优先。
  const preview = computeCrossPreview(p1, p2, 0, []);
  const abyss = preview.speciesUnlock.chances.find(c => c.speciesId === 'abyss-spirit')!;
  const vine = preview.speciesUnlock.chances.find(c => c.speciesId === 'magenta-vine')!;
  const dim = preview.speciesUnlock.chances.find(c => c.speciesId === 'dim-sprite')!;
  assert.ok(abyss.probability > vine.probability, 'abyss-spirit 应比 magenta-vine 概率高');
  assert.ok(abyss.probability > dim.probability, 'abyss-spirit 应比 dim-sprite 概率高');

  // abyss-spirit 已解锁后：其占据的组合仍会匹配其它物种，故“不解锁”概率不应升高（份额转移给次优物种）。
  const preview2 = computeCrossPreview(p1, p2, 0, ['abyss-spirit']);
  assert.ok(!preview2.speciesUnlock.chances.some(c => c.speciesId === 'abyss-spirit'), '已解锁物种不再列出');
  assert.ok(
    preview2.speciesUnlock.noUnlockProbability <= preview.speciesUnlock.noUnlockProbability + 0.01,
    '不解锁概率不应因份额转移而升高'
  );
});

test('物种解锁概率 + 不解锁概率合计为 100.00', () => {
  const p1 = makePlant('p1', HETERO);
  const p2 = makePlant('p2', HETERO);
  const preview = computeCrossPreview(p1, p2, 50, []);

  const all = [
    ...preview.speciesUnlock.chances.map(c => c.probability),
    preview.speciesUnlock.noUnlockProbability
  ];
  assert.equal(sumProbabilities(all), 100);
});

test('大余数舍入：非整除分布仍合计 100.00 且各项非负', () => {
  const percentages = toPercentagesSummingTo100([1 / 3, 1 / 3, 1 / 3]);
  assert.equal(sumProbabilities(percentages), 100);
  for (const value of percentages) {
    assert.ok(value >= 0);
  }
});

// ---- HTTP 集成：无副作用 & 原有杂交仍可用 ----
const STATE_FILE = path.join(process.cwd(), 'data', 'gamestate.json');

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

// 泛型 JSON 解析，避免测试里出现 any/unknown。
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test('连续预览不改存档，且预览后原有杂交仍能正常使用', async () => {
  const { server, baseUrl } = await startServer();
  // 备份存档：本用例会真实执行一次杂交（写存档），结束后恢复，保证测试可重复且不污染存档。
  const savedState = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf-8') : null;
  try {
    const state = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    assert.ok(state.plants.length >= 2, '需要至少两株植物');
    const parent1Id: string = state.plants[0].id;
    const parent2Id: string = state.plants[1].id;

    const before = fs.readFileSync(STATE_FILE, 'utf-8');

    // 连续多次只读预览。
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/crossbreed/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id, parent2Id, uvLevel: i * 25 })
      });
      assert.equal(res.status, 200);
      const preview = await readJson<CrossPreviewResponse>(res);
      assert.equal(preview.traits.length, 5);
    }

    const after = fs.readFileSync(STATE_FILE, 'utf-8');
    assert.equal(before, after, '预览不应写入存档');

    const plantsBefore = state.plants.length;

    // 预览之后原有杂交流程仍应正常工作并新增一株后代。
    const crossRes = await fetch(`${baseUrl}/api/crossbreed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id, parent2Id, uvLevel: 0 })
    });
    assert.equal(crossRes.status, 200);
    const crossResult = await readJson<CrossBreedResponse>(crossRes);
    assert.ok(crossResult.offspring, '应返回后代');

    const afterState = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    assert.equal(afterState.plants.length, plantsBefore + 1);
  } finally {
    server.close();
    if (savedState !== null) {
      fs.writeFileSync(STATE_FILE, savedState, 'utf-8');
    }
  }
});

test('错误输入：亲本相同 / 缺失 / UV越界 返回明确错误', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const state = await readJson<GameState>(await fetch(`${baseUrl}/api/state`));
    const id: string = state.plants[0].id;
    const otherId: string = state.plants[1].id;

    const same = await fetch(`${baseUrl}/api/crossbreed/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: id, parent2Id: id, uvLevel: 0 })
    });
    assert.equal(same.status, 400);

    const missing = await fetch(`${baseUrl}/api/crossbreed/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: id, parent2Id: 'does-not-exist', uvLevel: 0 })
    });
    assert.equal(missing.status, 404);

    const badUv = await fetch(`${baseUrl}/api/crossbreed/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: id, parent2Id: otherId, uvLevel: 150 })
    });
    assert.equal(badUv.status, 400);
  } finally {
    server.close();
  }
});
