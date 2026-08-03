import { Allele, Genotype } from '../../shared/types';
import { GENE_INFO } from '../../shared/constants';

/**
 * 真实杂交（随机路径）与精确预览（解析路径）共同依赖的遗传与突变规则。
 * 全部为无副作用纯函数：随机路径用它采样，解析路径用它推导分布，
 * 规则只此一份，避免两套实现产生偏差。
 */

/** 子代单个基因含 0/1/2 个显性等位基因的概率分布（下标即显性等位基因个数） */
export type DominantCountDistribution = [number, number, number];

/** 单个等位基因在指定 UV 强度下的翻转概率 */
export function getMutationRate(uvLevel: number): number {
  const baseMutationRate = 0.02;
  const uvMultiplier = 1 + (uvLevel / 100) * 4;
  return baseMutationRate * uvMultiplier;
}

/** 亲本某个基因按孟德尔分离定律产生显性/隐性配子的概率 */
export function getGameteProbabilities(
  parentPair: readonly [Allele, Allele],
  dominantAllele: Allele
): { dominant: number; recessive: number } {
  const dominantCount = (parentPair[0] === dominantAllele ? 1 : 0) + (parentPair[1] === dominantAllele ? 1 : 0);
  return { dominant: dominantCount / 2, recessive: 1 - dominantCount / 2 };
}

/** 等位基因突变：显隐互换 */
export function flipAllele(allele: Allele, gene: keyof Genotype): Allele {
  const info = GENE_INFO[gene];
  return allele === info.dominantAllele ? info.recessiveAllele : info.dominantAllele;
}

/** 突变前合子分布：两个亲本配子自由组合后含 0/1/2 个显性等位基因的概率 */
export function getZygoteDistribution(gamete1: { dominant: number }, gamete2: { dominant: number }): DominantCountDistribution {
  const q1 = gamete1.dominant;
  const q2 = gamete2.dominant;
  return [
    (1 - q1) * (1 - q2),
    q1 * (1 - q2) + (1 - q1) * q2,
    q1 * q2
  ];
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  return n === 2 ? 2 : 1; // 一个基因只有 2 个等位基因，n 最大为 2
}

/**
 * 对合子分布施加“每个等位基因以 r 独立翻转”的突变，得到最终分布。
 * 与逐等位基因随机翻转（mutateGenotype）是同一随机模型的解析形式。
 */
export function applyMutationToDistribution(pre: DominantCountDistribution, mutationRate: number): DominantCountDistribution {
  const post: DominantCountDistribution = [0, 0, 0];
  const r = mutationRate;
  for (let k = 0; k <= 2; k++) {
    // k 个显性等位基因各自以 r 翻转为隐性，2-k 个隐性等位基因各自以 r 翻转为显性
    for (let flippedDom = 0; flippedDom <= k; flippedDom++) {
      for (let flippedRec = 0; flippedRec <= 2 - k; flippedRec++) {
        const finalCount = k - flippedDom + flippedRec;
        post[finalCount] +=
          pre[k] *
          binomial(k, flippedDom) * Math.pow(r, flippedDom) * Math.pow(1 - r, k - flippedDom) *
          binomial(2 - k, flippedRec) * Math.pow(r, flippedRec) * Math.pow(1 - r, 2 - k - flippedRec);
      }
    }
  }
  return post;
}

/** 单基因完整分布：孟德尔分离 + UV 突变后，子代含 0/1/2 个显性等位基因的精确概率 */
export function getOffspringGeneDistribution(
  parent1Pair: readonly [Allele, Allele],
  parent2Pair: readonly [Allele, Allele],
  dominantAllele: Allele,
  mutationRate: number
): DominantCountDistribution {
  const pre = getZygoteDistribution(
    getGameteProbabilities(parent1Pair, dominantAllele),
    getGameteProbabilities(parent2Pair, dominantAllele)
  );
  return applyMutationToDistribution(pre, mutationRate);
}
