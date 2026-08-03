import test from 'node:test';
import assert from 'node:assert/strict';

import { Allele, Genotype, Phenotype } from '../shared/types';
import { GENE_KEYS, GENE_INFO } from '../server/data/species';
import { computeCrossPreview } from '../server/genetics/crossPreview';
import { crossGenotypes, mutateGenotype, crossParents, getMutationRate } from '../server/genetics/mendel';
import {
  RandomSource,
  enumerateContributedAllele,
  sampleContributedAllele,
  contributeAllele,
  pickSlot,
  shouldMutate,
  pickAllele,
  flipAllele,
  maybeMutate
} from '../server/genetics/geneticsRules';
import { genotypeToPhenotype } from '../server/genetics/genotypeToPhenotype';

function homozygous(a: Allele, b: Allele, c: Allele, d: Allele, e: Allele): Genotype {
  return {
    glowColor: [a, a],
    leafShape: [b, b],
    plantSize: [c, c],
    glowIntensity: [d, d],
    specialTrait: [e, e]
  };
}

const HETERO: Genotype = {
  glowColor: ['A', 'a'],
  leafShape: ['B', 'b'],
  plantSize: ['C', 'c'],
  glowIntensity: ['D', 'd'],
  specialTrait: ['E', 'e']
};

function makeParent(id: string, genotype: Genotype) {
  return { id, name: id, genotype, phenotype: genotypeToPhenotype(genotype), generation: 0, isMutant: false };
}

// 用固定序列驱动 RandomSource，得到确定性抽样，便于逐位点核对规则。
function sequenceRandom(values: number[]): RandomSource {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

// ---- 证明：真实杂交抽样 与 预览枚举 依赖同一套配子分离 + 突变规则 ----

test('规则共用：单次抽样结果一定落在预览枚举的可能分布内，且其概率非零', () => {
  const parent1 = HETERO;
  const parent2 = homozygous('a', 'b', 'c', 'd', 'e');
  const uvLevel = 40;
  const mutationRate = getMutationRate(uvLevel);

  // 对每个基因，枚举“该亲本贡献某等位基因”的分布，再验证真实抽样只会产出分布中的等位基因。
  for (const gene of GENE_KEYS) {
    const dist1 = enumerateContributedAllele(parent1[gene], gene, mutationRate);
    const allowed = new Set(dist1.filter(o => o.probability > 0).map(o => o.allele));

    // 多次抽样（不同随机数），结果必须都在枚举出的允许集合内。
    for (let draw = 0; draw < 1; draw += 0.1) {
      for (let mut = 0; mut < 1; mut += 0.1) {
        const rng = sequenceRandom([draw, mut]);
        const sampled = sampleContributedAllele(parent1[gene], gene, mutationRate, rng);
        assert.ok(allowed.has(sampled), `抽样得到的 ${sampled} 不在枚举分布内 (gene=${gene})`);
      }
    }
  }
});

test('规则共用：抽样的经验分布收敛到预览枚举的精确分布', () => {
  const parentPair: [Allele, Allele] = ['A', 'a'];
  const gene: keyof Genotype = 'glowColor';
  const mutationRate = getMutationRate(70);

  // 蒙特卡洛抽样统计。
  const counts = new Map<Allele, number>();
  const N = 200000;
  // mulberry32：统计质量足够、可重复的伪随机源。
  let state = 0x12345678;
  const rng: RandomSource = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < N; i++) {
    const a = sampleContributedAllele(parentPair, gene, mutationRate, rng);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }

  const enumerated = enumerateContributedAllele(parentPair, gene, mutationRate);
  for (const outcome of enumerated) {
    const empirical = (counts.get(outcome.allele) ?? 0) / N;
    assert.ok(
      Math.abs(empirical - outcome.probability) < 0.01,
      `等位基因 ${outcome.allele} 经验概率 ${empirical} 与枚举 ${outcome.probability} 偏差过大`
    );
  }
});

test('规则共用：预览分布可由 enumerateContributedAllele 独立重算得到（口径一致）', () => {
  const parent1 = makeParent('p1', HETERO);
  const parent2 = makeParent('p2', homozygous('A', 'b', 'C', 'd', 'E'));
  const uvLevel = 55;
  const mutationRate = getMutationRate(uvLevel);
  const preview = computeCrossPreview(parent1, parent2, uvLevel, []);

  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    // 用统一规则独立算出“后代表现显性”的精确概率。
    const qd1 = enumerateContributedAllele(parent1.genotype[gene], gene, mutationRate)
      .filter(o => o.allele === info.dominantAllele)
      .reduce((s, o) => s + o.probability, 0);
    const qd2 = enumerateContributedAllele(parent2.genotype[gene], gene, mutationRate)
      .filter(o => o.allele === info.dominantAllele)
      .reduce((s, o) => s + o.probability, 0);
    // 至少一个显性即表现显性：1 - (两个槽位都隐性)。
    const dominantProb = 1 - (1 - qd1) * (1 - qd2);
    const expectedDominantPct = Math.round(dominantProb * 10000) / 100;

    const trait = preview.traits.find(t => t.gene === gene)!;
    const dominantOutcome = trait.outcomes[0];
    // 允许 0.01 的大余数舍入误差。
    assert.ok(
      Math.abs(dominantOutcome.probability - expectedDominantPct) <= 0.01,
      `gene=${gene} 预览显性概率 ${dominantOutcome.probability} 与独立重算 ${expectedDominantPct} 不一致`
    );
  }
});

test('规则共用：mutateGenotype 的翻转与 flipAllele/maybeMutate 一致（100% 突变率下整株翻转）', () => {
  // 构造确定性 rng：pickAllele 用不到（mutateGenotype 只对已给基因型逐位点判定突变），
  // 每次突变判定都返回 0（< 任意正突变率 → 必翻转）。
  const alwaysMutate: RandomSource = () => 0;
  const genotype = homozygous('A', 'B', 'C', 'D', 'E');
  const result = mutateGenotype(genotype, 100, alwaysMutate);

  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    // 原为纯合显性，100% 翻转后应变为纯合隐性。
    assert.deepEqual(result.genotype[gene], [info.recessiveAllele, info.recessiveAllele]);
    // 与 flipAllele 原语结果一致。
    assert.equal(result.genotype[gene][0], flipAllele(info.dominantAllele, gene));
  }
  assert.equal(result.mutated, true);
});

test('规则共用：crossGenotypes 分离只取自亲本槽位（复用 pickAllele）', () => {
  const parent1 = homozygous('A', 'B', 'C', 'D', 'E');
  const parent2 = homozygous('a', 'b', 'c', 'd', 'e');
  // rng 恒返回 0 → pickAllele 取槽位 0；两亲本纯合，结果必为 parent1[0], parent2[0]。
  const rng: RandomSource = () => 0;
  const offspring = crossGenotypes(parent1, parent2, rng);

  for (const gene of GENE_KEYS) {
    assert.equal(offspring[gene][0], parent1[gene][0]);
    assert.equal(offspring[gene][1], parent2[gene][0]);
    // 与直接调用 pickAllele 一致。
    assert.equal(offspring[gene][0], pickAllele(parent1[gene], 0));
  }
});

// ---- 真实杂交 crossParents 与预览共用同一决策函数 contributeAllele ----

test('规则共用：crossParents 后代每个等位基因都等于 contributeAllele 的直接结果', () => {
  const parent1 = HETERO;
  const parent2 = homozygous('A', 'b', 'C', 'd', 'E');
  const uvLevel = 50;
  const mutationRate = getMutationRate(uvLevel);

  // 构造可预测的随机序列：每个槽位消耗两次 rng（先 pickSlot，再 shouldMutate）。
  // 这里让所有 pickSlot 取槽位 0（draw=0），所有突变都不发生（draw=0.99 >= mutationRate）。
  const rng: RandomSource = () => 0.99;
  // draw=0.99 → pickSlot=1（因为 0.99>=0.5）；shouldMutate(0.99)=false。
  const result = crossParents(parent1, parent2, uvLevel, rng);

  for (const gene of GENE_KEYS) {
    // 复算：两个槽位都用 slot=1、mutate=false，经由同一 contributeAllele。
    const expected0 = contributeAllele(parent1[gene], gene, pickSlot(0.99), shouldMutate(0.99, mutationRate));
    const expected1 = contributeAllele(parent2[gene], gene, pickSlot(0.99), shouldMutate(0.99, mutationRate));
    assert.equal(result.genotype[gene][0], expected0);
    assert.equal(result.genotype[gene][1], expected1);
  }
  assert.equal(result.mutated, false);
});

test('规则共用：crossParents 全突变时结果 = contributeAllele(mutate=true)，且突变提示不变', () => {
  const parent1 = homozygous('A', 'B', 'C', 'D', 'E');
  const parent2 = homozygous('A', 'B', 'C', 'D', 'E');
  const uvLevel = 100;
  // rng 恒为 0 → pickSlot=0，shouldMutate(0)=true（0 < 任意正突变率）。
  const rng: RandomSource = () => 0;
  const result = crossParents(parent1, parent2, uvLevel, rng);

  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    // 每个槽位都翻转 → 纯合隐性。
    assert.deepEqual(result.genotype[gene], [info.recessiveAllele, info.recessiveAllele]);
    assert.equal(result.genotype[gene][0], contributeAllele(parent1[gene], gene, 0, true));
  }
  // 突变提示语义保持：发生突变 → mutated=true，且记录 from/to。
  assert.equal(result.mutated, true);
  assert.ok(result.mutationDetails, '应给出突变详情');
  assert.notDeepEqual(result.mutationDetails!.from, result.mutationDetails!.to);
});

test('规则共用：crossParents 的整株后代分布收敛到预览分布（端到端一致）', () => {
  const parent1 = makeParent('p1', HETERO);
  const parent2 = makeParent('p2', homozygous('A', 'b', 'C', 'd', 'e'));
  const uvLevel = 60;
  const preview = computeCrossPreview(parent1, parent2, uvLevel, []);

  // mulberry32：可重复的高质量伪随机源。
  let state = 0x9e3779b9;
  const rng: RandomSource = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const N = 200000;
  const domCount: Record<string, number> = {};
  for (const gene of GENE_KEYS) domCount[gene] = 0;

  for (let i = 0; i < N; i++) {
    const { genotype } = crossParents(parent1.genotype, parent2.genotype, uvLevel, rng);
    const phen = genotypeToPhenotype(genotype);
    for (const gene of GENE_KEYS) {
      const info = GENE_INFO[gene];
      if (phen[gene as keyof Phenotype] === info.dominantTrait) domCount[gene] += 1;
    }
  }

  for (const trait of preview.traits) {
    const empirical = (domCount[trait.gene] / N) * 100;
    const previewDominant = trait.outcomes[0].probability;
    assert.ok(
      Math.abs(empirical - previewDominant) < 0.5,
      `gene=${trait.gene} 真实杂交经验显性% ${empirical.toFixed(2)} 与预览 ${previewDominant} 偏差过大`
    );
  }
});

// ---- 特殊性状 null 口径 ----

test('预览：特殊性状隐性结果为 null，且标签与表型 null 口径一致（不写成 "none"）', () => {
  const parent1 = makeParent('p1', homozygous('A', 'B', 'C', 'D', 'e'));
  const parent2 = makeParent('p2', homozygous('a', 'b', 'c', 'd', 'e'));
  const preview = computeCrossPreview(parent1, parent2, 0, []);

  const special = preview.traits.find(t => t.gene === 'specialTrait')!;
  const dominant = special.outcomes.find(o => o.value === 'floating');
  const recessive = special.outcomes.find(o => o.value === null);

  assert.ok(dominant, '应存在 floating 结果');
  assert.ok(recessive, '隐性结果 value 必须为 null');
  // 明确禁止出现字符串 'none'。
  assert.ok(!special.outcomes.some(o => o.value === 'none'), '预览不得使用字符串 none');

  // 与真实表型转换的 null 口径一致：纯隐性基因型的 specialTrait 表型为 null。
  const recessivePhenotype: Phenotype = genotypeToPhenotype(homozygous('a', 'b', 'c', 'd', 'e'));
  assert.equal(recessivePhenotype.specialTrait, null);
  assert.equal(recessive!.value, recessivePhenotype.specialTrait);
});
