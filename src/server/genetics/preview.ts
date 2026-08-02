import {
  Allele,
  Genotype,
  Phenotype,
  Plant,
  GenePreview,
  GenotypeOutcome,
  PhenotypeOutcome,
  PreviewResponse,
  SpeciesUnlockOutcome
} from '../../shared/types';
import { GENE_KEYS, GENE_INFO, GeneKey } from '../../shared/constants';
import { genotypeToPhenotype } from './genotypeToPhenotype';
import {
  getMutationRate,
  getOffspringGenotypeDistribution,
  Distribution,
  pairKey,
  keyToPair
} from './mendel';
import { rankSpecies, speciesMatchesGenotypePhenotype } from './speciesDetector';
import { SPECIES } from '../data/species';

const GENE_LABELS: Record<GeneKey, string> = {
  glowColor: '发光颜色',
  leafShape: '叶片形状',
  plantSize: '植株大小',
  glowIntensity: '发光强度',
  specialTrait: '特殊能力'
};

const TOTAL_ALLELE_SLOTS = GENE_KEYS.length * 2;

type Offspring = { genotype: Genotype; phenotype: Phenotype; probability: number };

function phenotypeForPair(gene: GeneKey, pair: [Allele, Allele]): string {
  const { dominantAllele, dominantTrait, recessiveTrait } = GENE_INFO[gene];
  const hasDominant = pair[0] === dominantAllele || pair[1] === dominantAllele;
  if (gene === 'specialTrait') {
    return hasDominant ? dominantTrait : 'none';
  }
  return hasDominant ? dominantTrait : recessiveTrait;
}

function roundToHundredths(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// 最大余额法：只对“真正构成完整、互斥概率分布”的一组权重使用，
// 把它们舍入到 0.01% 并保证合计恰好等于原始总和乘以 100，不再人为补到 100。
function largestRemainder(rawProbabilities: number[], total: number = 1): number[] {
  if (rawProbabilities.length === 0) return [];
  const target = total * 100;
  const exact = rawProbabilities.map(p => p * 100);
  const floored = exact.map(v => Math.floor(v * 100) / 100);
  const sumFloored = roundToHundredths(floored.reduce((a, b) => a + b, 0));
  const deficitHundredths = Math.round((target - sumFloored) * 100);
  const remainders = exact
    .map((v, i) => ({ index: i, remainder: v * 100 - Math.floor(v * 100) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const increments = new Array(rawProbabilities.length).fill(0);
  for (let i = 0; i < deficitHundredths; i++) {
    increments[remainders[i % remainders.length].index] += 0.01;
  }
  return floored.map((v, i) => roundToHundredths(v + increments[i]));
}

function distributionToMap(dist: Distribution<[Allele, Allele]>, gene: GeneKey): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of dist) {
    const key = pairKey(gene, entry.value);
    map.set(key, (map.get(key) ?? 0) + entry.probability);
  }
  return map;
}

function buildGenePreview(gene: GeneKey, dist: Distribution<[Allele, Allele]>): GenePreview {
  const asMap = distributionToMap(dist, gene);
  const entries = Array.from(asMap.entries())
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rounded = largestRemainder(entries.map(([, p]) => p), 1);

  const genotypeOutcomes: GenotypeOutcome[] = entries.map(([key], i) => ({
    genotype: keyToPair(gene, key),
    probabilityPercent: rounded[i]
  }));

  const phenotypeDist = new Map<string, number>();
  for (const [key, prob] of asMap) {
    const phenotype = phenotypeForPair(gene, keyToPair(gene, key));
    phenotypeDist.set(phenotype, (phenotypeDist.get(phenotype) ?? 0) + prob);
  }
  const phenoEntries = Array.from(phenotypeDist.entries())
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const phenoRounded = largestRemainder(phenoEntries.map(([, p]) => p), 1);

  const phenotypeOutcomes: PhenotypeOutcome[] = phenoEntries.map(([key], i) => ({
    phenotype: key,
    probabilityPercent: phenoRounded[i]
  }));

  return {
    gene,
    label: GENE_LABELS[gene],
    genotypeOutcomes,
    phenotypeOutcomes
  };
}

function enumerateFullOffspring(
  perGene: Record<GeneKey, Distribution<[Allele, Allele]>>
): Offspring[] {
  let combined: Array<{ encoded: string; probability: number }> = [{ encoded: '', probability: 1 }];
  for (const gene of GENE_KEYS) {
    const next: Array<{ encoded: string; probability: number }> = [];
    for (const prefix of combined) {
      for (const entry of perGene[gene]) {
        next.push({
          encoded: prefix.encoded + pairKey(gene, entry.value),
          probability: prefix.probability * entry.probability
        });
      }
    }
    combined = next;
  }

  return combined.map(({ encoded, probability }) => {
    const genotype = {} as Genotype;
    for (let g = 0; g < GENE_KEYS.length; g++) {
      const gene = GENE_KEYS[g];
      genotype[gene] = keyToPair(gene, encoded.slice(g * 2, g * 2 + 2));
    }
    return { genotype, phenotype: genotypeToPhenotype(genotype), probability };
  });
}

function computeSpeciesUnlocks(
  offspring: Offspring[],
  unlockedSpecies: string[]
): { outcomes: SpeciesUnlockOutcome[]; anyUnlockProbability: number } {
  const lockedRanked = rankSpecies(SPECIES).filter(
    ({ species }) => !unlockedSpecies.includes(species.id)
  );

  const matchProb = lockedRanked.map(() => 0);
  const unlockProb = lockedRanked.map(() => 0);
  const overlap: number[][] = lockedRanked.map(() => lockedRanked.map(() => 0));

  for (const child of offspring) {
    const flags = lockedRanked.map(({ species }) =>
      speciesMatchesGenotypePhenotype(child.genotype, child.phenotype, species)
    );
    flags.forEach((matches, i) => {
      if (matches) matchProb[i] += child.probability;
    });
    const winnerIndex = flags.findIndex(Boolean);
    if (winnerIndex >= 0) {
      unlockProb[winnerIndex] += child.probability;
    }
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i]) continue;
      for (let j = 0; j < flags.length; j++) {
        if (i !== j && flags[j]) overlap[i][j] += child.probability;
      }
    }
  }

  // 注意：物种的 matchProb / unlockProb 都不构成完整分布（大量后代不匹配任何物种，
  // 且同一后代可同时匹配多个物种），因此这里只做“总和保持原值”的舍入，
  // 不强制把合计补成 100%。
  const rawAnyUnlock = unlockProb.reduce((a, b) => a + b, 0);
  const roundedMatch = largestRemainder(matchProb, matchProb.reduce((a, b) => a + b, 0));
  const roundedUnlock = largestRemainder(unlockProb, rawAnyUnlock);

  const outcomes = lockedRanked.map(({ species }, i) => {
    const blockedBy: string[] = [];
    if (matchProb[i] > 0 && unlockProb[i] < matchProb[i]) {
      for (let j = 0; j < i; j++) {
        if (overlap[i][j] > 0) blockedBy.push(lockedRanked[j].species.name);
      }
    }
    return {
      speciesId: species.id,
      speciesName: species.name,
      rarity: species.rarity,
      image: species.image,
      matchProbabilityPercent: roundedMatch[i],
      unlockProbabilityPercent: roundedUnlock[i],
      blockedBy
    };
  });

  return { outcomes, anyUnlockProbability: rawAnyUnlock };
}

export type PreviewInput = {
  parent1: Plant;
  parent2: Plant;
  uvLevel: number;
  unlockedSpecies: string[];
};

export function computeCrossbreedPreview(input: PreviewInput): PreviewResponse {
  const { parent1, parent2, uvLevel, unlockedSpecies } = input;
  const r = getMutationRate(uvLevel);
  const perGeneRaw = getOffspringGenotypeDistribution(parent1.genotype, parent2.genotype, uvLevel);

  // 过滤掉概率为 0 的项，保持输出稳定。
  const perGene = {} as Record<GeneKey, Distribution<[Allele, Allele]>>;
  for (const gene of GENE_KEYS) {
    perGene[gene] = perGeneRaw[gene].filter(e => e.probability > 0);
  }

  const genePreviews: GenePreview[] = GENE_KEYS.map(gene => buildGenePreview(gene, perGene[gene]));
  const offspring = enumerateFullOffspring(perGene);
  const { outcomes: speciesUnlocks, anyUnlockProbability } = computeSpeciesUnlocks(
    offspring,
    unlockedSpecies
  );

  const noMutationProb = Math.pow(1 - r, TOTAL_ALLELE_SLOTS);
  const mutationProbabilityPercent = roundToHundredths((1 - noMutationProb) * 100);
  const anySpeciesUnlockProbabilityPercent = roundToHundredths(anyUnlockProbability * 100);
  const noSpeciesUnlockProbabilityPercent = roundToHundredths(
    (1 - anyUnlockProbability) * 100
  );

  return {
    valid: true,
    parent1Name: parent1.name,
    parent2Name: parent2.name,
    uvLevel,
    perAlleleMutationRate: r,
    mutationProbabilityPercent,
    anySpeciesUnlockProbabilityPercent,
    noSpeciesUnlockProbabilityPercent,
    genes: genePreviews,
    speciesUnlocks
  };
}
