import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Plant,
  Genotype,
  PreviewResponse
} from '../../shared/types';
import { GENE_KEYS } from '../../shared/constants';
import { computeCrossbreedPreview } from '../genetics/preview';
import {
  crossGenotypes,
  getMutationRate,
  getOffspringGenotypeDistribution,
  mutateGenotype
} from '../genetics/mendel';
import { genotypeToPhenotype } from '../genetics/genotypeToPhenotype';
import { speciesMatchesGenotypePhenotype, rankSpecies } from '../genetics/speciesDetector';
import { SPECIES } from '../data/species';

type TestCase = { name: string; run: () => void | Promise<void> };
const tests: TestCase[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

const HET: Genotype = {
  glowColor: ['A', 'a'],
  leafShape: ['B', 'b'],
  plantSize: ['C', 'c'],
  glowIntensity: ['D', 'd'],
  specialTrait: ['E', 'e']
};

const ALL_DOM: Genotype = {
  glowColor: ['A', 'A'],
  leafShape: ['B', 'B'],
  plantSize: ['C', 'C'],
  glowIntensity: ['D', 'D'],
  specialTrait: ['E', 'E']
};

function buildGenotype(spec: Partial<Record<keyof Genotype, [string, string]>>): Genotype {
  return { ...ALL_DOM, ...spec } as Genotype;
}

function phenotypeOf(genotype: Genotype) {
  return genotypeToPhenotype(genotype);
}

function makePlant(id: string, genotype: Genotype, name = id): Plant {
  return {
    id,
    name,
    genotype,
    phenotype: phenotypeOf(genotype),
    generation: 0,
    isMutant: false
  };
}

function sumPercent(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function geneById(preview: PreviewResponse, gene: keyof Genotype) {
  const found = preview.genes.find(g => g.gene === gene);
  assert.ok(found, `gene ${gene} should be present`);
  return found!;
}

// ---------- 纯合亲本 ----------
test('纯合显性 AA × 纯合隐性 aa：Aa 占 0.98²≈96.04%，AA 与 aa 各约 1.96%', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ glowColor: ['A', 'A'] })),
    parent2: makePlant('p2', buildGenotype({ glowColor: ['a', 'a'] })),
    uvLevel: 0,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'glowColor');
  const byKey = new Map(gene.genotypeOutcomes.map(o => [o.genotype.join(''), o.probabilityPercent]));
  assert.ok(Math.abs((byKey.get('Aa') ?? 0) - 96.04) < 0.05);
  assert.ok(Math.abs((byKey.get('AA') ?? 0) - 1.96) < 0.05);
  assert.ok(Math.abs((byKey.get('aa') ?? 0) - 1.96) < 0.05);
  assert.strictEqual(sumPercent(gene.genotypeOutcomes.map(o => o.probabilityPercent)), 100);
});

// ---------- 杂合亲本 ----------
test('杂合 × 杂合：基因型近似 1:2:1（受 UV=0 的 2% 突变轻微影响），合计 100.00%', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ leafShape: ['B', 'b'] })),
    parent2: makePlant('p2', buildGenotype({ leafShape: ['B', 'b'] })),
    uvLevel: 0,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'leafShape');
  const byKey = new Map(gene.genotypeOutcomes.map(o => [o.genotype.join(''), o.probabilityPercent]));
  assert.ok(Math.abs((byKey.get('BB') ?? 0) - 25) < 5);
  assert.ok(Math.abs((byKey.get('Bb') ?? 0) - 50) < 5);
  assert.ok(Math.abs((byKey.get('bb') ?? 0) - 25) < 5);
  assert.strictEqual(sumPercent(gene.genotypeOutcomes.map(o => o.probabilityPercent)), 100);
  assert.strictEqual(sumPercent(gene.phenotypeOutcomes.map(o => o.probabilityPercent)), 100);
});

test('测交：杂合 × 纯合隐性，近似 1:1，合计 100.00%', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ plantSize: ['C', 'c'] })),
    parent2: makePlant('p2', buildGenotype({ plantSize: ['c', 'c'] })),
    uvLevel: 0,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'plantSize');
  const byKey = new Map(gene.genotypeOutcomes.map(o => [o.genotype.join(''), o.probabilityPercent]));
  assert.ok(Math.abs((byKey.get('Cc') ?? 0) - 50) < 5);
  assert.ok(Math.abs((byKey.get('cc') ?? 0) - 50) < 5);
  assert.strictEqual(sumPercent(gene.genotypeOutcomes.map(o => o.probabilityPercent)), 100);
});

// ---------- 突变率与整株突变概率 ----------
test('UV=0 时每个等位基因突变率 2%，整株突变概率 1-0.98^10', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', ALL_DOM),
    parent2: makePlant('p2', ALL_DOM),
    uvLevel: 0,
    unlockedSpecies: []
  });
  assert.strictEqual(preview.perAlleleMutationRate, 0.02);
  assert.strictEqual(preview.mutationProbabilityPercent, Math.round((1 - Math.pow(0.98, 10)) * 10000) / 100);
});

test('UV=100 时每个等位基因突变率 10%，整株突变概率 1-0.9^10', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', ALL_DOM),
    parent2: makePlant('p2', ALL_DOM),
    uvLevel: 100,
    unlockedSpecies: []
  });
  assert.strictEqual(preview.perAlleleMutationRate, 0.1);
  assert.strictEqual(preview.mutationProbabilityPercent, Math.round((1 - Math.pow(0.9, 10)) * 10000) / 100);
});

test('UV=100 下纯合显性亲本可产生 aa，且三类基因型合计 100%', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ glowColor: ['A', 'A'] })),
    parent2: makePlant('p2', buildGenotype({ glowColor: ['A', 'A'] })),
    uvLevel: 100,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'glowColor');
  const keys = gene.genotypeOutcomes.map(o => o.genotype.join(''));
  assert.ok(keys.includes('aa'));
  assert.strictEqual(sumPercent(gene.genotypeOutcomes.map(o => o.probabilityPercent)), 100);
});

// ---------- 五类杂合亲本：精确 46.6796875% 的解锁概率 ----------
function exactAnyUnlockProbability(unlocked: string[]): number {
  // 直接复用与真实杂交相同的分布函数，逐基因型枚举。
  const distributions = getOffspringGenotypeDistribution(HET, HET, 0);
  const ranked = rankSpecies(SPECIES).filter(({ species }) => !unlocked.includes(species.id));

  let total = 0;
  let anyUnlock = 0;
  const enumerate = (geneIdx: number, accumulated: number, current: Genotype): void => {
    if (geneIdx === GENE_KEYS.length) {
      total += accumulated;
      const phenotype = genotypeToPhenotype(current);
      const winner = ranked.find(({ species }) =>
        speciesMatchesGenotypePhenotype(current, phenotype, species)
      );
      if (winner) anyUnlock += accumulated;
      return;
    }
    const gene = GENE_KEYS[geneIdx];
    for (const entry of distributions[gene]) {
      current[gene] = entry.value;
      enumerate(geneIdx + 1, accumulated * entry.probability, current);
    }
  };
  enumerate(0, 1, {} as Genotype);
  assert.ok(Math.abs(total - 1) < 1e-9, '总概率必须为 1');
  return anyUnlock;
}

test('五类基因均杂合、UV=0、无已解锁物种时，至少解锁一个新物种的概率为 46.6796875%', () => {
  const exact = exactAnyUnlockProbability([]);
  assert.ok(
    Math.abs(exact - 0.466796875) < 1e-9,
    `期望 0.466796875，实际 ${exact}`
  );

  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', HET),
    parent2: makePlant('p2', HET),
    uvLevel: 0,
    unlockedSpecies: []
  });
  assert.ok(
    Math.abs(preview.anySpeciesUnlockProbabilityPercent - 46.68) < 0.005,
    `任意解锁概率应约为 46.68%，实际 ${preview.anySpeciesUnlockProbabilityPercent}`
  );
  assert.ok(
    Math.abs(preview.noSpeciesUnlockProbabilityPercent - 53.32) < 0.005,
    `不解锁概率应约为 53.32%，实际 ${preview.noSpeciesUnlockProbabilityPercent}`
  );
  // 两者之和必须恰好 100.00（最大余额法分别舍入后仍互补到 100）。
  assert.strictEqual(
    Math.round(
      (preview.anySpeciesUnlockProbabilityPercent + preview.noSpeciesUnlockProbabilityPercent) * 100
    ) / 100,
    100
  );

  // 各物种“实际解锁”概率是互斥事件，合计必须等于任意解锁概率（不再被强制凑到 100%）。
  const unlockSum = sumPercent(preview.speciesUnlocks.map(s => s.unlockProbabilityPercent));
  assert.ok(
    Math.abs(unlockSum - preview.anySpeciesUnlockProbabilityPercent) < 0.02,
    `各物种实际解锁概率合计应≈任意解锁概率，实际合计 ${unlockSum}`
  );
  assert.ok(unlockSum < 100, '物种解锁概率合计不得被强制补成 100%');
});

// ---------- 全部物种已解锁 ----------
test('全部物种已解锁时返回有效预览、speciesUnlocks 为空且不报错', () => {
  const allIds = SPECIES.map(s => s.id);
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', HET),
    parent2: makePlant('p2', HET),
    uvLevel: 0,
    unlockedSpecies: allIds
  });
  assert.strictEqual(preview.valid, true);
  assert.deepStrictEqual(preview.speciesUnlocks, []);
  assert.strictEqual(preview.anySpeciesUnlockProbabilityPercent, 0);
  assert.strictEqual(preview.noSpeciesUnlockProbabilityPercent, 100);
  // 基因分布仍然正常
  assert.strictEqual(preview.genes.length, 5);
  for (const gene of preview.genes) {
    assert.strictEqual(sumPercent(gene.genotypeOutcomes.map(o => o.probabilityPercent)), 100);
  }
});

// ---------- 空概率集合的舍入 ----------
test('空物种列表经过 largest-remainder 舍入后仍为空，不抛异常', () => {
  // 该用例通过“全部物种已解锁”间接验证：computeSpeciesUnlocks 收到空数组
  // 并必须返回空数组而不是崩溃。
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', ALL_DOM),
    parent2: makePlant('p2', ALL_DOM),
    uvLevel: 50,
    unlockedSpecies: SPECIES.map(s => s.id)
  });
  assert.deepStrictEqual(preview.speciesUnlocks, []);
});

// ---------- 物种优先级与重叠 ----------
test('全显性纯合亲本：星辉巨灵 specificity 最高，优先于巨光晶/浮空晶莲解锁', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', ALL_DOM),
    parent2: makePlant('p2', ALL_DOM),
    uvLevel: 0,
    unlockedSpecies: []
  });
  const byId = new Map(preview.speciesUnlocks.map(s => [s.speciesId, s]));
  const titan = byId.get('starlight-titan');
  const giant = byId.get('giant-glow-crystal');
  const floating = byId.get('floating-lotus');
  assert.ok(titan && giant && floating);

  // P(CC)=0.9604；P(DD)=0.9604；巨光晶需要同时满足，故 ≈ 92.24%。
  assert.ok(Math.abs(giant!.matchProbabilityPercent - 92.24) < 0.5);
  // 星辉巨灵需要 5 个基因全显性纯合：0.9604^5 ≈ 81.71%。
  const expectedTitan = Math.pow(0.9604, 5) * 100;
  assert.ok(Math.abs(titan!.matchProbabilityPercent - expectedTitan) < 0.5);
  // 星辉巨灵的实际解锁概率 ≈ 匹配概率（它优先级最高）。
  assert.ok(Math.abs(titan!.unlockProbabilityPercent - expectedTitan) < 0.5);
  // 巨光晶的实际解锁概率 = 匹配概率 - 被星辉巨灵抢先的概率。
  const giantStandalone = giant!.matchProbabilityPercent - titan!.matchProbabilityPercent;
  assert.ok(Math.abs(giant!.unlockProbabilityPercent - giantStandalone) < 0.5);
  assert.ok(giant!.blockedBy.length > 0);
  assert.ok(floating!.blockedBy.length > 0);
});

test('已解锁物种不会出现在预览列表中', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ specialTrait: ['E', 'E'] })),
    parent2: makePlant('p2', buildGenotype({ specialTrait: ['E', 'E'] })),
    uvLevel: 0,
    unlockedSpecies: ['floating-lotus']
  });
  assert.ok(!preview.speciesUnlocks.some(s => s.speciesId === 'floating-lotus'));
});

test('ee × ee，UV=0 时 specialTrait 为 none 的概率约 96.04%，合计 100%', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', buildGenotype({ specialTrait: ['e', 'e'] })),
    parent2: makePlant('p2', buildGenotype({ specialTrait: ['e', 'e'] })),
    uvLevel: 0,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'specialTrait');
  const none = gene.phenotypeOutcomes.find(o => o.phenotype === 'none');
  assert.ok(none);
  assert.ok(Math.abs(none!.probabilityPercent - 96.04) < 0.05);
  assert.strictEqual(sumPercent(gene.phenotypeOutcomes.map(o => o.probabilityPercent)), 100);
});

// ---------- 共享规则：crossGenotypes 与预览使用同一分布 ----------
test('crossGenotypes 在固定随机种子下严格从预览分布中抽样', () => {
  // 验证 sampleFromDistribution 与 crossGenotypes 使用同一套规则：
  // 多次抽样的等位基因频率应接近分布给出的概率。
  const p1 = makePlant('p1', buildGenotype({ glowColor: ['A', 'A'] }));
  const p2 = makePlant('p2', buildGenotype({ glowColor: ['a', 'a'] }));

  // 无突变情况下，crossGenotypes 只做继承，结果必为 Aa（canonical 后）。
  // 这里固定 Math.random 返回 0，保证两个亲本都选择第 0 个等位基因 (A, a)。
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => {
    calls++;
    return 0; // 始终选索引 0
  };
  try {
    const offspring = crossGenotypes(p1.genotype, p2.genotype);
    assert.deepStrictEqual(offspring.glowColor, ['A', 'a']);
    assert.ok(calls >= 5, '每个基因都需要一次随机抽样');
  } finally {
    Math.random = originalRandom;
  }

  // 同时验证预览分布中 Aa 是最大项（与上面抽样一致）。
  const preview = computeCrossbreedPreview({
    parent1: p1,
    parent2: p2,
    uvLevel: 0,
    unlockedSpecies: []
  });
  const gene = geneById(preview, 'glowColor');
  const top = gene.genotypeOutcomes[0];
  assert.deepStrictEqual(top.genotype, ['A', 'a']);
});

test('getMutationRate 与预览共享公式：UV=0/25/100', () => {
  assert.strictEqual(getMutationRate(0), 0.02);
  assert.strictEqual(getMutationRate(25), 0.04);
  assert.strictEqual(getMutationRate(100), 0.1);
});

test('mutateGenotype 与预览使用同一突变分布：大样本下频率吻合', () => {
  // UV=100，每个等位基因以 10% 翻转。对 [A,A] 进行 20000 次独立突变，
  // 统计 AA/Aa/aa 频率，应分别接近 0.81 / 0.18 / 0.01（与预览分布完全一致）。
  const genotype: Genotype = { ...ALL_DOM, glowColor: ['A', 'A'] };
  const counts = { AA: 0, Aa: 0, aa: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const res = mutateGenotype(genotype, 100);
    const pair = res.genotype.glowColor;
    const dom = (pair[0] === 'A' ? 1 : 0) + (pair[1] === 'A' ? 1 : 0);
    if (dom === 2) counts.AA++;
    else if (dom === 1) counts.Aa++;
    else counts.aa++;
  }
  const freqAA = counts.AA / N;
  const freqAa = counts.Aa / N;
  const freqAa2 = counts.aa / N;
  assert.ok(Math.abs(freqAA - 0.81) < 0.02, `AA 频率应≈0.81，实际 ${freqAA}`);
  assert.ok(Math.abs(freqAa - 0.18) < 0.02, `Aa 频率应≈0.18，实际 ${freqAa}`);
  assert.ok(Math.abs(freqAa2 - 0.01) < 0.01, `aa 频率应≈0.01，实际 ${freqAa2}`);

  // 同时验证 mutateGenotype 只会产生 A 或 a（不会出现第三种等位基因）
  for (let i = 0; i < 1000; i++) {
    const res = mutateGenotype(genotype, 100);
    for (const a of res.genotype.glowColor) {
      assert.ok(a === 'A' || a === 'a');
    }
  }
});

test('mutateGenotype 的整株突变率与预览公式 1-(1-r)^10 一致', () => {
  // 这是回归测试：过去真实杂交对每个基因用一次随机数抽联合分布，
  // 导致两个等位基因位耦合、整体突变率显著低于预览。这里用大样本验证修复后两者一致。
  const genotype: Genotype = { ...ALL_DOM };
  for (const uv of [0, 50, 100]) {
    const r = getMutationRate(uv);
    const expected = 1 - Math.pow(1 - r, 10);
    const N = 100000;
    let mutated = 0;
    for (let i = 0; i < N; i++) {
      if (mutateGenotype(genotype, uv).mutated) mutated++;
    }
    const freq = mutated / N;
    const se = Math.sqrt(expected * (1 - expected) / N);
    assert.ok(
      Math.abs(freq - expected) < 4 * se,
      `UV=${uv} 整株突变率应≈${(expected * 100).toFixed(2)}%，实际 ${(freq * 100).toFixed(2)}%`
    );
  }
});

test('所有五个基因都出现在预览结果中', () => {
  const preview = computeCrossbreedPreview({
    parent1: makePlant('p1', ALL_DOM),
    parent2: makePlant('p2', ALL_DOM),
    uvLevel: 0,
    unlockedSpecies: []
  });
  assert.deepStrictEqual(preview.genes.map(g => g.gene), GENE_KEYS);
});

type JsonResponse = Record<string, unknown>;

async function readJson(res: Awaited<ReturnType<typeof fetch>>): Promise<JsonResponse> {
  return (await res.json()) as JsonResponse;
}

// ---------- HTTP 集成测试 ----------
async function withTempServer(): Promise<{
  baseUrl: string;
  cleanup: () => Promise<void>;
  dataDir: string;
  stateFile: string;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-preview-'));
  process.env.PLANT_GAME_DATA_DIR = tmpDir;
  // 清除 require 缓存，确保 storage 模块重新读取环境变量。
  for (const key of Object.keys(require.cache)) {
    if (key.includes('jsonStorage') || key.includes('gameRouter') || key.includes('index')) {
      delete require.cache[key];
    }
  }
  const mod = await import('../routes/gameRouter');
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', mod.default);
  await new Promise<void>(resolve => {
    const server = app.listen(0, () => resolve());
    (app as unknown as { __server?: typeof server }).__server = server;
  });
  const addr = (app as unknown as { __server: { address: () => { port: number } } }).__server.address();
  return {
    baseUrl: `http://localhost:${addr.port}/api`,
    dataDir: tmpDir,
    stateFile: path.join(tmpDir, 'gamestate.json'),
    cleanup: async () => {
      await new Promise<void>(resolve => {
        (app as unknown as { __server: { close: (cb: () => void) => void } }).__server.close(() => resolve());
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.PLANT_GAME_DATA_DIR;
    }
  };
}

async function getState(baseUrl: string) {
  const res = await fetch(`${baseUrl}/state`);
  return res.json() as Promise<{
    plants: Plant[];
    unlockedSpecies: string[];
    selectedParent1: string | null;
    selectedParent2: string | null;
  }>;
}

test('预览端点只读：连续预览不改变存档、亲本、解锁列表', async () => {
  const { baseUrl, cleanup } = await withTempServer();
  try {
    const stateBefore = await getState(baseUrl);
    assert.ok(stateBefore.plants.length >= 2);
    const p1 = stateBefore.plants[0].id;
    const p2 = stateBefore.plants[1].id;

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 50 })
      });
      assert.strictEqual(res.status, 200);
      const body = await readJson(res);
      assert.strictEqual(body.valid, true);
    }

    const stateAfter = await getState(baseUrl);
    assert.strictEqual(stateAfter.plants.length, stateBefore.plants.length);
    assert.deepStrictEqual(stateAfter.unlockedSpecies, stateBefore.unlockedSpecies);
    assert.strictEqual(stateAfter.selectedParent1, null);
    assert.strictEqual(stateAfter.selectedParent2, null);
  } finally {
    await cleanup();
  }
});

test('存档不存在时预览不创建存档文件', async () => {
  const { baseUrl, dataDir, stateFile, cleanup } = await withTempServer();
  try {
    // withTempServer 已经创建了空的临时目录 dataDir，但存档文件不应存在
    assert.ok(fs.existsSync(dataDir), '临时目录应已存在');
    assert.ok(!fs.existsSync(stateFile), '启动时存档文件不应存在');

    const state = await getState(baseUrl);
    // /state 是写路径，会初始化存档
    assert.ok(fs.existsSync(stateFile), '/state 应正常初始化存档');

    // 删除存档后，再调用预览，不应重新创建
    fs.rmSync(stateFile);
    assert.ok(!fs.existsSync(stateFile));

    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;
    const res = await fetch(`${baseUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 0 })
    });
    // 存档已删除时，预览会回退到内存默认状态（其中植物 ID 与 p1/p2 不同），
    // 因此可能返回 404 PARENT_NOT_FOUND；无论 200 还是 404 都可以，关键是不得写文件。
    assert.ok(res.status === 200 || res.status === 404, `expected 200 or 404, got ${res.status}`);

    assert.ok(!fs.existsSync(stateFile), '预览不得重新创建存档文件');
    // 临时目录仍可存在，但不应包含 gamestate.json
    if (fs.existsSync(dataDir)) {
      assert.ok(!fs.readdirSync(dataDir).includes('gamestate.json'));
    }
  } finally {
    await cleanup();
  }
});

test('存档需要归一化时预览只在内存归一化，不回写文件', async () => {
  const { baseUrl, stateFile, cleanup } = await withTempServer();
  try {
    // 先通过 /state 创建一个正常存档
    await getState(baseUrl);
    const original = fs.readFileSync(stateFile, 'utf-8');

    // 手动写入一个需要归一化的状态（UV 越界、非法已解锁物种）
    const parsed = JSON.parse(original);
    parsed.uvLevel = 999;
    parsed.unlockedSpecies = ['nonexistent-species'];
    const corrupted = JSON.stringify(parsed, null, 2);
    fs.writeFileSync(stateFile, corrupted, 'utf-8');

    const p1 = parsed.plants[0].id;
    const p2 = parsed.plants[1].id;
    const res = await fetch(`${baseUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 50 })
    });
    assert.strictEqual(res.status, 200);
    const body = await readJson(res);
    assert.strictEqual(body.valid, true);
    // 预览请求里使用的是请求体中的 uvLevel=50，不受存档里的 999 影响
    assert.strictEqual(body.uvLevel, 50);

    // 文件必须保持原样，没有被归一化写回
    const after = fs.readFileSync(stateFile, 'utf-8');
    assert.strictEqual(after, corrupted, '预览不得把归一化后的状态写回磁盘');
  } finally {
    await cleanup();
  }
});

test('存档损坏时预览返回内存默认状态且不写文件', async () => {
  const { baseUrl, stateFile, cleanup } = await withTempServer();
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{ this is not valid json', 'utf-8');

    // 不使用 /state（它会修复文件），直接调用预览
    const res = await fetch(`${baseUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: 'x', parent2Id: 'y', uvLevel: 0 })
    });
    // 内存默认状态里没有 id=x/y 的植物，应返回 PARENT_NOT_FOUND
    assert.strictEqual(res.status, 404);
    const body = await readJson(res);
    assert.strictEqual((body.error as { code: string }).code, 'PARENT_NOT_FOUND');

    // 文件内容必须保持损坏状态不变
    const after = fs.readFileSync(stateFile, 'utf-8');
    assert.strictEqual(after, '{ this is not valid json');
  } finally {
    await cleanup();
  }
});

test('四类预览错误：缺少亲本、同一株、亲本不存在、UV 越界', async () => {
  const { baseUrl, cleanup } = await withTempServer();
  try {
    const state = await getState(baseUrl);
    const p1 = state.plants[0].id;

    async function expectError(
      init: RequestInit & { body: string },
      status: number,
      code: string
    ): Promise<void> {
      const res = await fetch(`${baseUrl}/preview`, init);
      assert.strictEqual(res.status, status);
      const body = await readJson(res);
      assert.strictEqual((body.error as { code: string }).code, code);
    }

    await expectError(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id: '', parent2Id: '', uvLevel: 0 })
      },
      400,
      'MISSING_PARENT'
    );

    await expectError(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id: p1, parent2Id: p1, uvLevel: 0 })
      },
      400,
      'SAME_PARENT'
    );

    await expectError(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id: p1, parent2Id: 'nope', uvLevel: 0 })
      },
      404,
      'PARENT_NOT_FOUND'
    );

    await expectError(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent1Id: p1, parent2Id: state.plants[1].id, uvLevel: 150 })
      },
      400,
      'UV_OUT_OF_RANGE'
    );
  } finally {
    await cleanup();
  }
});

test('预览后原有 /crossbreed 仍可正常使用并写入后代', async () => {
  const { baseUrl, cleanup } = await withTempServer();
  try {
    const stateBefore = await getState(baseUrl);
    const p1 = stateBefore.plants[0].id;
    const p2 = stateBefore.plants[1].id;

    const previewRes = await fetch(`${baseUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 0 })
    });
    assert.strictEqual(previewRes.status, 200);

    const crossRes = await fetch(`${baseUrl}/crossbreed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 0 })
    });
    assert.strictEqual(crossRes.status, 200);
    const crossBody = await crossRes.json() as { offspring: { id: string } };
    assert.ok(crossBody.offspring?.id);

    const stateAfter = await getState(baseUrl);
    assert.strictEqual(stateAfter.plants.length, stateBefore.plants.length + 1);
  } finally {
    await cleanup();
  }
});

test('全部物种已解锁时通过 HTTP 预览返回空 speciesUnlocks', async () => {
  const { baseUrl, cleanup } = await withTempServer();
  try {
    // 通过连续调用 /generate 不一定能解锁全部物种，这里直接手动写入存档
    const state = await getState(baseUrl);
    (state as { unlockedSpecies: string[] }).unlockedSpecies = SPECIES.map(s => s.id);
    // 用一个可用的 POST 接口写回：通过 reset 不行，直接通过内部 saveGameState 不方便；
    // 这里改用 fetch 到一个会保存的路径——反复删除后再添加植物不影响 unlockedSpecies。
    // 最简单做法：直接通过 fs 写入存档文件。
    const stateFile = path.join(process.env.PLANT_GAME_DATA_DIR!, 'gamestate.json');
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');

    const p1 = state.plants[0].id;
    const p2 = state.plants[1].id;
    const res = await fetch(`${baseUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent1Id: p1, parent2Id: p2, uvLevel: 0 })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json() as PreviewResponse;
    assert.strictEqual(body.valid, true);
    assert.deepStrictEqual(body.speciesUnlocks, []);
    assert.strictEqual(body.anySpeciesUnlockProbabilityPercent, 0);
    assert.strictEqual(body.noSpeciesUnlockProbabilityPercent, 100);
  } finally {
    await cleanup();
  }
});

(async function run(): Promise<void> {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.run();
      process.stdout.write(`  ✓ ${t.name}\n`);
      passed++;
    } catch (err) {
      process.stdout.write(`  ✗ ${t.name}\n`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  process.stdout.write(`\n${passed}/${tests.length} tests passed\n`);
})();
