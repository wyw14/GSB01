import { Genotype, Allele } from '../../shared/types';
import { GENE_KEYS } from '../data/species';
import {
  RandomSource,
  defaultRandomSource,
  getMutationRate,
  pickSlot,
  shouldMutate,
  contributeAllele,
  pickAllele,
  maybeMutate
} from './geneticsRules';

// 突变率公式仍从统一规则中导出，保持对外 API 不变。
export { getMutationRate };

export type MutationDetails = { gene: keyof Genotype; from: [Allele, Allele]; to: [Allele, Allele] };

export type CrossResult = {
  genotype: Genotype;
  mutated: boolean;
  mutationDetails?: MutationDetails;
};

// ============================================================================
// 真实杂交的唯一入口：对后代每个基因的两个槽位，各走一次
// “选槽位(pickSlot) → 是否突变(shouldMutate) → 产出(contributeAllele)”。
// contributeAllele 正是预览 enumerateContributedAllele 所枚举的同一决策函数，
// 因此真实杂交产出的后代与预览给出的分布严格来自同一套规则，不可能不一致。
// 突变提示语义保持不变：mutated = 任一槽位相对“未突变基线”发生翻转；
// mutationDetails 记录最后一个发生翻转的基因（from=基线配子对，to=突变后配子对）。
// ============================================================================
export function crossParents(
  parent1: Genotype,
  parent2: Genotype,
  uvLevel: number,
  rng: RandomSource = defaultRandomSource
): CrossResult {
  const mutationRate = getMutationRate(uvLevel);
  const offspring: Partial<Genotype> = {};
  let mutated = false;
  let mutationDetails: MutationDetails | undefined;

  for (const gene of GENE_KEYS) {
    const sources: [Genotype, Genotype] = [parent1, parent2];
    const baseline: Allele[] = [];
    const final: Allele[] = [];

    for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
      const sourcePair = sources[slotIndex][gene];
      const slot = pickSlot(rng());
      const mutate = shouldMutate(rng(), mutationRate);
      // 未突变基线与实际结果都经由同一决策函数，仅 mutate 标志不同。
      baseline.push(contributeAllele(sourcePair, gene, slot, false));
      final.push(contributeAllele(sourcePair, gene, slot, mutate));
    }

    offspring[gene] = [final[0], final[1]];

    if (final[0] !== baseline[0] || final[1] !== baseline[1]) {
      mutated = true;
      mutationDetails = {
        gene,
        from: [baseline[0], baseline[1]],
        to: [final[0], final[1]]
      };
    }
  }

  return { genotype: offspring as Genotype, mutated, mutationDetails };
}

// 真实杂交第 1 步（保留导出，供测试验证分离规则）：孟德尔分离。
export function crossGenotypes(
  parent1: Genotype,
  parent2: Genotype,
  rng: RandomSource = defaultRandomSource
): Genotype {
  const offspring: Partial<Genotype> = {};

  for (const gene of GENE_KEYS) {
    const allele1 = pickAllele(parent1[gene], rng());
    const allele2 = pickAllele(parent2[gene], rng());
    offspring[gene] = [allele1, allele2];
  }

  return offspring as Genotype;
}

// 真实杂交第 2 步（保留导出，供测试验证突变规则）：UV 突变。
export function mutateGenotype(
  genotype: Genotype,
  uvLevel: number,
  rng: RandomSource = defaultRandomSource
): CrossResult {
  const mutationRate = getMutationRate(uvLevel);
  const newGenotype: Genotype = JSON.parse(JSON.stringify(genotype));
  let mutated = false;
  let mutationDetails: MutationDetails | undefined;

  for (const gene of GENE_KEYS) {
    const original: [Allele, Allele] = [...newGenotype[gene]] as [Allele, Allele];
    for (let i = 0; i < 2; i++) {
      newGenotype[gene][i] = maybeMutate(newGenotype[gene][i], gene, rng(), mutationRate);
    }
    if (newGenotype[gene][0] !== original[0] || newGenotype[gene][1] !== original[1]) {
      mutated = true;
      mutationDetails = { gene, from: original, to: [...newGenotype[gene]] as [Allele, Allele] };
    }
  }

  return { genotype: newGenotype, mutated, mutationDetails };
}

export function generateRandomGenotype(rng: RandomSource = defaultRandomSource): Genotype {
  const getRandomAllele = (dominant: Allele, recessive: Allele): Allele => {
    return rng() < 0.7 ? dominant : recessive;
  };

  return {
    glowColor: [getRandomAllele('A', 'a'), getRandomAllele('A', 'a')],
    leafShape: [getRandomAllele('B', 'b'), getRandomAllele('B', 'b')],
    plantSize: [getRandomAllele('C', 'c'), getRandomAllele('C', 'c')],
    glowIntensity: [getRandomAllele('D', 'd'), getRandomAllele('D', 'd')],
    specialTrait: [getRandomAllele('E', 'e'), getRandomAllele('E', 'e')]
  };
}
