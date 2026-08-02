import {
  Allele,
  Genotype,
  Phenotype,
  Plant,
  CrossPreviewResponse,
  TraitPreview,
  TraitOutcome,
  SpeciesUnlockChance
} from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../data/species';
import { getMutationRate, enumerateContributedAllele } from './geneticsRules';
import { genotypeToPhenotype } from './genotypeToPhenotype';
import { checkNewSpecies } from './speciesDetector';
import { SPECIES } from '../data/species';

// 展示用的中文标签。仅是渲染文案，不是基因/物种规则的副本；
// 遗传抽样/枚举复用 geneticsRules，物种判定复用 speciesDetector，表型复用 genotypeToPhenotype。
const GENE_LABELS: Record<keyof Genotype, string> = {
  glowColor: '发光颜色',
  leafShape: '叶片形状',
  plantSize: '植株大小',
  glowIntensity: '发光强度',
  specialTrait: '特殊能力'
};

const TRAIT_LABELS: Record<string, string> = {
  cyan: '青色',
  magenta: '品红',
  crystalline: '晶体状',
  tentacle: '触手状',
  giant: '巨型',
  dwarf: '微型',
  bright: '明亮',
  dim: '暗淡',
  floating: '漂浮'
};

// 特殊性状隐性结果沿用 Phenotype 的 null 口径，展示时给出中文文案。
const NULL_TRAIT_LABEL = '无特殊能力';

// 单个基因经“遗传 + UV 突变”后，后代携带 0/1/2 个显性等位基因的精确分布。
type GeneStateDistribution = {
  homozygousDominant: number; // 2 个显性
  heterozygous: number; // 1 个显性
  homozygousRecessive: number; // 0 个显性
};

// 从统一规则枚举出的“贡献等位基因分布”里，取某亲本贡献显性等位基因的概率。
function dominantContributionProbability(
  sourcePair: [Allele, Allele],
  gene: keyof Genotype,
  mutationRate: number
): number {
  const dominantAllele = GENE_INFO[gene].dominantAllele;
  return enumerateContributedAllele(sourcePair, gene, mutationRate)
    .filter(outcome => outcome.allele === dominantAllele)
    .reduce((sum, outcome) => sum + outcome.probability, 0);
}

// 后代某基因的显性数量分布：两个亲本各自“贡献显性的概率”相互独立组合。
// 完全建立在 enumerateContributedAllele（= 真实杂交 sampleContributedAllele 的分布展开）之上，
// 因此预览与真实杂交依赖同一套分离 + 突变规则。
function computeGeneDistribution(
  parent1Pair: [Allele, Allele],
  parent2Pair: [Allele, Allele],
  gene: keyof Genotype,
  mutationRate: number
): GeneStateDistribution {
  const qd1 = dominantContributionProbability(parent1Pair, gene, mutationRate);
  const qd2 = dominantContributionProbability(parent2Pair, gene, mutationRate);

  return {
    homozygousDominant: qd1 * qd2,
    heterozygous: qd1 * (1 - qd2) + (1 - qd1) * qd2,
    homozygousRecessive: (1 - qd1) * (1 - qd2)
  };
}

function pairForDominantCount(gene: keyof Genotype, dominantCount: 0 | 1 | 2): [Allele, Allele] {
  const info = GENE_INFO[gene];
  if (dominantCount === 2) return [info.dominantAllele, info.dominantAllele];
  if (dominantCount === 1) return [info.dominantAllele, info.recessiveAllele];
  return [info.recessiveAllele, info.recessiveAllele];
}

// 通过真实的 genotypeToPhenotype 得到某基因“显性/隐性表达”对应的表型取值，
// 从而继承其 null 口径（特殊性状隐性 → null，而非字符串 'none'）。
function phenotypeValueForGene(gene: keyof Genotype, dominantExpressed: boolean): string | null {
  const count: 0 | 1 | 2 = dominantExpressed ? 2 : 0;
  const genotype = {} as Genotype;
  for (const g of GENE_KEYS) {
    genotype[g] = pairForDominantCount(g, g === gene ? count : 2);
  }
  return genotypeToPhenotype(genotype)[gene as keyof Phenotype];
}

function traitLabel(value: string | null): string {
  if (value === null) return NULL_TRAIT_LABEL;
  return TRAIT_LABELS[value] ?? value;
}

// 大余数法：把一组和为 1 的概率转成保留两位小数、且合计恰为 100.00 的百分比。
export function toPercentagesSummingTo100(probabilities: number[]): number[] {
  if (probabilities.length === 0) return [];

  const scaled = probabilities.map(p => p * 10000);
  const floors = scaled.map(Math.floor);
  const floorSum = floors.reduce((sum, value) => sum + value, 0);
  // 目标恒为 10000（即 100.00%），可抵消浮点求和的极小误差。
  const remainder = 10000 - floorSum;

  const byFractionDesc = scaled
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction);

  const hundredths = [...floors];
  for (let i = 0; i < remainder; i++) {
    hundredths[byFractionDesc[i % byFractionDesc.length].index] += 1;
  }

  return hundredths.map(value => value / 100);
}

function roundTwoDecimals(probability: number): number {
  return Math.round(probability * 10000) / 100;
}

function buildTraitPreview(gene: keyof Genotype, distribution: GeneStateDistribution): TraitPreview {
  // 表型转换：至少 1 个显性等位基因即表现显性性状，否则表现隐性性状。
  const dominantProbability = distribution.homozygousDominant + distribution.heterozygous;
  const recessiveProbability = distribution.homozygousRecessive;

  const [dominantPercent, recessivePercent] = toPercentagesSummingTo100([
    dominantProbability,
    recessiveProbability
  ]);

  const dominantValue = phenotypeValueForGene(gene, true);
  const recessiveValue = phenotypeValueForGene(gene, false);

  const outcomes: TraitOutcome[] = [
    { value: dominantValue, label: traitLabel(dominantValue), probability: dominantPercent },
    { value: recessiveValue, label: traitLabel(recessiveValue), probability: recessivePercent }
  ];

  return {
    gene,
    geneLabel: GENE_LABELS[gene],
    outcomes
  };
}

// 遍历 3^5 = 243 种后代基因型状态组合，逐一用真实的物种判定规则
// （genotypeToPhenotype + checkNewSpecies）确定该组合实际会解锁哪个尚未解锁物种，
// 按组合精确概率累加，得到每个未解锁物种的解锁概率及“不解锁”概率。
function computeSpeciesUnlock(
  distributions: Record<keyof Genotype, GeneStateDistribution>,
  unlockedSpecies: string[]
): { chances: SpeciesUnlockChance[]; noUnlockProbability: number } {
  const dominantCounts: (0 | 1 | 2)[] = [0, 1, 2];
  const perGeneProb = (gene: keyof Genotype, count: 0 | 1 | 2): number => {
    const dist = distributions[gene];
    if (count === 2) return dist.homozygousDominant;
    if (count === 1) return dist.heterozygous;
    return dist.homozygousRecessive;
  };

  const unlockProbabilityById = new Map<string, number>();
  let noUnlockProbability = 0;

  for (const c0 of dominantCounts) {
    for (const c1 of dominantCounts) {
      for (const c2 of dominantCounts) {
        for (const c3 of dominantCounts) {
          for (const c4 of dominantCounts) {
            const counts: (0 | 1 | 2)[] = [c0, c1, c2, c3, c4];
            let comboProbability = 1;
            const genotype: Partial<Genotype> = {};

            for (let i = 0; i < GENE_KEYS.length; i++) {
              const gene = GENE_KEYS[i];
              comboProbability *= perGeneProb(gene, counts[i]);
              genotype[gene] = pairForDominantCount(gene, counts[i]);
            }

            if (comboProbability === 0) continue;

            const fullGenotype = genotype as Genotype;
            const candidate: Plant = {
              id: 'preview',
              name: 'preview',
              genotype: fullGenotype,
              phenotype: genotypeToPhenotype(fullGenotype),
              generation: 0,
              isMutant: false
            };

            const unlocked = checkNewSpecies(candidate, unlockedSpecies);
            if (unlocked) {
              unlockProbabilityById.set(
                unlocked.id,
                (unlockProbabilityById.get(unlocked.id) ?? 0) + comboProbability
              );
            } else {
              noUnlockProbability += comboProbability;
            }
          }
        }
      }
    }
  }

  // 列出全部尚未解锁的物种（含概率为 0 的），最后一项为“不解锁”，一起做合计=100 的舍入。
  const lockedSpecies = SPECIES.filter(species => !unlockedSpecies.includes(species.id));
  const rawProbabilities = [
    ...lockedSpecies.map(species => unlockProbabilityById.get(species.id) ?? 0),
    noUnlockProbability
  ];
  const percentages = toPercentagesSummingTo100(rawProbabilities);

  const chances: SpeciesUnlockChance[] = lockedSpecies.map((species, index) => ({
    speciesId: species.id,
    speciesName: species.name,
    probability: percentages[index]
  }));

  return {
    chances,
    noUnlockProbability: percentages[percentages.length - 1]
  };
}

// 只读地根据两株亲本与 UV 计算完整杂交预览。纯函数：不读写存档、不改状态。
export function computeCrossPreview(
  parent1: Plant,
  parent2: Plant,
  uvLevel: number,
  unlockedSpecies: string[]
): CrossPreviewResponse {
  const mutationRate = getMutationRate(uvLevel);

  const distributions = {} as Record<keyof Genotype, GeneStateDistribution>;
  for (const gene of GENE_KEYS) {
    distributions[gene] = computeGeneDistribution(
      parent1.genotype[gene],
      parent2.genotype[gene],
      gene,
      mutationRate
    );
  }

  const traits: TraitPreview[] = GENE_KEYS.map(gene => buildTraitPreview(gene, distributions[gene]));

  // 整株突变 = 10 个等位基因位点中至少有一个发生翻转（与真实杂交 mutated 标志一致）。
  const mutationProbability = roundTwoDecimals(1 - Math.pow(1 - mutationRate, GENE_KEYS.length * 2));

  const speciesUnlock = computeSpeciesUnlock(distributions, unlockedSpecies);

  return {
    uvLevel,
    parent1Id: parent1.id,
    parent2Id: parent2.id,
    traits,
    mutationProbability,
    speciesUnlock
  };
}
