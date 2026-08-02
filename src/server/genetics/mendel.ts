import { Genotype, Allele } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../data/species';
import { GeneKey } from '../../shared/constants';

export function getMutationRate(uvLevel: number): number {
  const baseMutationRate = 0.02;
  const uvMultiplier = 1 + (uvLevel / 100) * 4;
  return baseMutationRate * uvMultiplier;
}

export function flipAllele(allele: Allele, gene: keyof Genotype): Allele {
  const info = GENE_INFO[gene];
  if (allele === info.dominantAllele) {
    return info.recessiveAllele;
  }
  return info.dominantAllele;
}

export function isDominantAllele(gene: GeneKey, allele: Allele): boolean {
  return allele === GENE_INFO[gene].dominantAllele;
}

export function canonicalPair(gene: GeneKey, pair: [Allele, Allele]): [Allele, Allele] {
  const [a, b] = pair;
  if (a === b) return [a, b];
  return isDominantAllele(gene, a) ? [a, b] : [b, a];
}

export function pairKey(gene: GeneKey, pair: [Allele, Allele]): string {
  return canonicalPair(gene, pair).join('');
}

export function keyToPair(gene: GeneKey, key: string): [Allele, Allele] {
  const { dominantAllele, recessiveAllele } = GENE_INFO[gene];
  const alleles = key
    .split('')
    .map(ch => (ch === dominantAllele ? dominantAllele : recessiveAllele)) as Allele[];
  return [alleles[0], alleles[1]];
}

export type Distribution<T> = { value: T; probability: number }[];

// 单个基因的孟德尔分离分布：亲本各贡献一个等位基因，4 种组合概率各 1/4。
// 同一位点上 [D,R] 与 [R,D] 等价，合并后得到至多 3 种无序基因型。
export function getInheritanceDistribution(
  gene: GeneKey,
  parent1Pair: [Allele, Allele],
  parent2Pair: [Allele, Allele]
): Distribution<[Allele, Allele]> {
  const aggregated = new Map<string, number>();
  for (const a of parent1Pair) {
    for (const b of parent2Pair) {
      const key = pairKey(gene, [a, b]);
      aggregated.set(key, (aggregated.get(key) ?? 0) + 0.25);
    }
  }
  return Array.from(aggregated.entries()).map(([key, probability]) => ({
    value: keyToPair(gene, key),
    probability
  }));
}

// 对继承得到的基因型应用逐等位基因突变：每个等位基因位独立以概率 r 翻转。
export function getMutationDistribution(
  gene: GeneKey,
  inherited: [Allele, Allele],
  mutationRate: number
): Distribution<[Allele, Allele]> {
  const stay = 1 - mutationRate;
  const aggregated = new Map<string, number>();
  for (let slot = 0; slot < 2; slot++) {
    const original = inherited[slot];
    const options: Array<{ allele: Allele; probability: number }> = [
      { allele: original, probability: stay },
      { allele: flipAllele(original, gene), probability: mutationRate }
    ];
    if (slot === 0) {
      for (const opt of options) {
        aggregated.set(opt.allele, opt.probability);
      }
    } else {
      const next = new Map<string, number>();
      for (const [firstAllele, firstProb] of aggregated) {
        for (const opt of options) {
          const key = pairKey(gene, [firstAllele as Allele, opt.allele]);
          next.set(key, (next.get(key) ?? 0) + firstProb * opt.probability);
        }
      }
      aggregated.clear();
      for (const [k, v] of next) aggregated.set(k, v);
    }
  }
  return Array.from(aggregated.entries()).map(([key, probability]) => ({
    value: keyToPair(gene, key),
    probability
  }));
}

// 卷积继承与突变，得到单个基因最终基因型的精确分布。
export function getGeneOffspringDistribution(
  gene: GeneKey,
  parent1Pair: [Allele, Allele],
  parent2Pair: [Allele, Allele],
  mutationRate: number
): Distribution<[Allele, Allele]> {
  const inherited = getInheritanceDistribution(gene, parent1Pair, parent2Pair);
  const combined = new Map<string, number>();
  for (const entry of inherited) {
    const mutated = getMutationDistribution(gene, entry.value, mutationRate);
    for (const m of mutated) {
      const key = pairKey(gene, m.value);
      combined.set(key, (combined.get(key) ?? 0) + entry.probability * m.probability);
    }
  }
  return Array.from(combined.entries()).map(([key, probability]) => ({
    value: keyToPair(gene, key),
    probability
  }));
}

export function getOffspringGenotypeDistribution(
  parent1: Genotype,
  parent2: Genotype,
  uvLevel: number
): Record<GeneKey, Distribution<[Allele, Allele]>> {
  const r = getMutationRate(uvLevel);
  const result = {} as Record<GeneKey, Distribution<[Allele, Allele]>>;
  for (const gene of GENE_KEYS) {
    result[gene] = getGeneOffspringDistribution(gene, parent1[gene], parent2[gene], r);
  }
  return result;
}

// 从离散分布中抽取一个结果，保证真实杂交与预览使用完全相同的概率模型。
export function sampleFromDistribution<T>(
  distribution: Distribution<T>,
  random: () => number = Math.random
): T {
  const roll = random();
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += entry.probability;
    if (roll < cumulative) {
      return entry.value;
    }
  }
  return distribution[distribution.length - 1].value;
}

export function crossGenotypes(parent1: Genotype, parent2: Genotype): Genotype {
  const offspring = {} as Genotype;
  for (const gene of GENE_KEYS) {
    const inheritance = getInheritanceDistribution(gene, parent1[gene], parent2[gene]);
    offspring[gene] = sampleFromDistribution(inheritance);
  }
  return offspring;
}

type MutationDetails = {
  gene: keyof Genotype;
  from: [Allele, Allele];
  to: [Allele, Allele];
};

// 从一个“单个等位基因位是否翻转”的伯努利分布中抽样。
// 预览通过 10 个独立同分布的该事件计算整株突变概率，真实杂交也必须逐位独立抽样，
// 不能从“一个基因的联合分布”里用一次随机数抽出两个位（那会让两位耦合，导致偏差）。
export function sampleAlleleMutation(
  original: Allele,
  gene: GeneKey,
  mutationRate: number
): { allele: Allele; mutated: boolean } {
  if (Math.random() < mutationRate) {
    return { allele: flipAllele(original, gene), mutated: true };
  }
  return { allele: original, mutated: false };
}

// 真实杂交的突变采样：对 10 个等位基因位分别独立做一次伯努利试验，
// 与预览使用的 getMutationDistribution（两个位独立卷积）严格对应。
export function mutateGenotype(
  genotype: Genotype,
  uvLevel: number
): { genotype: Genotype; mutated: boolean; mutationDetails?: MutationDetails } {
  const mutationRate = getMutationRate(uvLevel);
  const original: Genotype = JSON.parse(JSON.stringify(genotype));
  const newGenotype: Genotype = JSON.parse(JSON.stringify(genotype));
  let mutated = false;
  let mutationDetails: MutationDetails | undefined;

  for (const gene of GENE_KEYS) {
    let geneMutated = false;
    for (let slot = 0; slot < 2; slot++) {
      const result = sampleAlleleMutation(original[gene][slot], gene, mutationRate);
      newGenotype[gene][slot] = result.allele;
      if (result.mutated) {
        mutated = true;
        geneMutated = true;
      }
    }
    if (geneMutated) {
      // 与原实现一致：mutationDetails 记录最后一个发生突变的基因。
      mutationDetails = {
        gene,
        from: [...original[gene]] as [Allele, Allele],
        to: [...newGenotype[gene]] as [Allele, Allele]
      };
    }
  }

  return {
    genotype: newGenotype,
    mutated,
    mutationDetails
  };
}

export function generateRandomGenotype(): Genotype {
  const getRandomAllele = (dominant: Allele, recessive: Allele): Allele => {
    return Math.random() < 0.7 ? dominant : recessive;
  };

  return {
    glowColor: [getRandomAllele('A', 'a'), getRandomAllele('A', 'a')],
    leafShape: [getRandomAllele('B', 'b'), getRandomAllele('B', 'b')],
    plantSize: [getRandomAllele('C', 'c'), getRandomAllele('C', 'c')],
    glowIntensity: [getRandomAllele('D', 'd'), getRandomAllele('D', 'd')],
    specialTrait: [getRandomAllele('E', 'e'), getRandomAllele('E', 'e')]
  };
}
