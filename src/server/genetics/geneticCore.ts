import { Genotype, Allele } from '../../shared/types';
import { GENE_KEYS, GENE_INFO, GeneKey } from '../../shared/constants';

export type GenotypeProbTriple = {
  homozygousDominant: number;
  heterozygous: number;
  homozygousRecessive: number;
};

export type MutationDetails = {
  gene: GeneKey;
  from: [Allele, Allele];
  to: [Allele, Allele];
};

export type CrossAndMutateResult = {
  genotype: Genotype;
  mutated: boolean;
  mutationDetails?: MutationDetails;
};

// 唯一的突变率公式：基础2%，UV=100时提升至10%
export function getMutationRate(uvLevel: number): number {
  const baseMutationRate = 0.02;
  const uvMultiplier = 1 + (uvLevel / 100) * 4;
  return baseMutationRate * uvMultiplier;
}

// 唯一的等位基因翻转规则
export function flipAllele(allele: Allele, gene: GeneKey): Allele {
  const info = GENE_INFO[gene];
  if (allele === info.dominantAllele) {
    return info.recessiveAllele;
  }
  return info.dominantAllele;
}

// ============================================================================
// 唯一的遗传+突变规则
// ============================================================================
// 随机过程（真实杂交使用）：
//   1. 每个亲本以50%概率传递一个等位基因 → 4种均等组合
//   2. 每个继承的等位基因独立以 mutationRate 概率翻转
//
// 解析概率（预览使用）：getSingleGeneDistribution 计算上述过程的精确分布。
// 真实杂交的 sampleInheritAndMutate 执行上述过程的蒙特卡洛采样。
// 两者描述同一个随机过程，数学上严格等价，不可能分岔。
// ============================================================================

// 解析版：计算单个基因遗传+突变后的基因型概率分布（预览使用）
export function getSingleGeneDistribution(
  parent1Alleles: [Allele, Allele],
  parent2Alleles: [Allele, Allele],
  dominant: Allele,
  recessive: Allele,
  mutationRate: number
): GenotypeProbTriple {
  let pDD = 0;
  let pDd = 0;
  let pdd = 0;

  // 4种均等的遗传组合
  const combos: [Allele, Allele][] = [
    [parent1Alleles[0], parent2Alleles[0]],
    [parent1Alleles[0], parent2Alleles[1]],
    [parent1Alleles[1], parent2Alleles[0]],
    [parent1Alleles[1], parent2Alleles[1]]
  ];

  for (const [a1, a2] of combos) {
    // 每个等位基因独立突变
    const p1D = a1 === dominant ? (1 - mutationRate) : mutationRate;
    const p1d = a1 === dominant ? mutationRate : (1 - mutationRate);
    const p2D = a2 === dominant ? (1 - mutationRate) : mutationRate;
    const p2d = a2 === dominant ? mutationRate : (1 - mutationRate);

    pDD += p1D * p2D;
    pDd += p1D * p2d + p1d * p2D;
    pdd += p1d * p2d;
  }

  return {
    homozygousDominant: pDD / 4,
    heterozygous: pDd / 4,
    homozygousRecessive: pdd / 4
  };
}

// 采样版：执行遗传+突变过程，返回最终基因型和突变详情（真实杂交使用）
// 此函数实现的随机过程与 getSingleGeneDistribution 完全一致。
function sampleInheritAndMutate(
  parent1Alleles: [Allele, Allele],
  parent2Alleles: [Allele, Allele],
  gene: GeneKey,
  mutationRate: number,
  random: () => number
): { alleles: [Allele, Allele]; mutated: boolean; details?: MutationDetails } {
  // 步骤1：遗传——每个亲本以50%概率传递一个等位基因
  const inherited: [Allele, Allele] = [
    parent1Alleles[random() < 0.5 ? 0 : 1],
    parent2Alleles[random() < 0.5 ? 0 : 1]
  ];

  // 在任何突变之前捕获原始基因型（修复双等位基因突变时的详情捕获 bug）
  const original: [Allele, Allele] = [inherited[0], inherited[1]];

  // 步骤2：逐等位基因独立突变
  let geneMutated = false;
  for (let i = 0; i < 2; i++) {
    if (random() < mutationRate) {
      inherited[i] = flipAllele(inherited[i], gene);
      geneMutated = true;
    }
  }

  return {
    alleles: inherited,
    mutated: geneMutated,
    details: geneMutated
      ? { gene, from: original, to: [inherited[0], inherited[1]] }
      : undefined
  };
}

// 真实杂交入口：对每个基因执行与预览同一规则的采样
export function crossAndMutateGenotype(
  parent1: Genotype,
  parent2: Genotype,
  uvLevel: number,
  random: () => number = Math.random
): CrossAndMutateResult {
  const mutationRate = getMutationRate(uvLevel);
  const newGenotype = {} as Genotype;
  let mutated = false;
  let mutationDetails: MutationDetails | undefined;

  for (const gene of GENE_KEYS) {
    const result = sampleInheritAndMutate(
      parent1[gene],
      parent2[gene],
      gene,
      mutationRate,
      random
    );
    newGenotype[gene] = result.alleles;
    if (result.mutated) {
      mutated = true;
      mutationDetails = result.details;
    }
  }

  return { genotype: newGenotype, mutated, mutationDetails };
}

// 批量获取所有基因的概率分布（预览使用）
export function getAllGeneDistributions(
  parent1: Genotype,
  parent2: Genotype,
  uvLevel: number
): Record<GeneKey, GenotypeProbTriple> {
  const mutationRate = getMutationRate(uvLevel);
  const result = {} as Record<GeneKey, GenotypeProbTriple>;
  for (const gene of GENE_KEYS) {
    const info = GENE_INFO[gene];
    result[gene] = getSingleGeneDistribution(
      parent1[gene],
      parent2[gene],
      info.dominantAllele,
      info.recessiveAllele,
      mutationRate
    );
  }
  return result;
}
