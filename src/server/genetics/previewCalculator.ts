import {
  Genotype,
  Phenotype,
  Plant,
  Species,
  GenePreview,
  ProbabilityEntry,
  SpeciesUnlockProbability,
  CrossBreedPreviewResponse
} from '../../shared/types';
import { GENE_KEYS, GENE_INFO, GeneKey } from '../../shared/constants';
import {
  getMutationRate,
  getAllGeneDistributions,
  GenotypeProbTriple
} from './geneticCore';
import type { Allele } from '../../shared/types';
import { genotypeToPhenotype } from './genotypeToPhenotype';
import { detectMatchingSpeciesFromGenotypePhenotype } from './speciesDetector';
import { SPECIES } from '../data/species';

const ROUND_DECIMALS = 2;

function roundPercent(value: number): number {
  const factor = Math.pow(10, ROUND_DECIMALS);
  return Math.round(value * factor) / factor;
}

// 性状概率使用最大余数法修正舍入误差，确保合计100.00%
function normalizeProbabilities(entries: ProbabilityEntry[]): ProbabilityEntry[] {
  if (entries.length === 0) return entries;

  const rounded = entries.map(e => ({
    ...e,
    probability: roundPercent(e.probability * 100)
  }));

  const sum = rounded.reduce((acc, e) => acc + e.probability, 0);
  const diff = roundPercent(100 - sum);

  // 将舍入误差补到概率最大的项，保证合计严格为100.00%
  if (Math.abs(diff) > 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i].probability > rounded[maxIdx].probability) {
        maxIdx = i;
      }
    }
    rounded[maxIdx].probability = roundPercent(rounded[maxIdx].probability + diff);
  }

  return rounded;
}

function enumerateAllGenotypes(
  distributions: Record<GeneKey, GenotypeProbTriple>
): { genotype: Genotype; probability: number }[] {
  const results: { genotype: Genotype; probability: number }[] = [];
  const options = [0, 1, 2];

  function getAllelesForOption(geneIdx: number, option: number): [Allele, Allele] {
    const key = GENE_KEYS[geneIdx];
    const info = GENE_INFO[key];
    if (option === 0) return [info.dominantAllele, info.dominantAllele];
    if (option === 1) return [info.dominantAllele, info.recessiveAllele];
    return [info.recessiveAllele, info.recessiveAllele];
  }

  function getProbForOption(geneIdx: number, option: number): number {
    const key = GENE_KEYS[geneIdx];
    const dist = distributions[key];
    if (option === 0) return dist.homozygousDominant;
    if (option === 1) return dist.heterozygous;
    return dist.homozygousRecessive;
  }

  function recurse(geneIdx: number, currentProb: number, currentGenotype: Partial<Genotype>): void {
    if (geneIdx === GENE_KEYS.length) {
      results.push({
        genotype: { ...currentGenotype } as Genotype,
        probability: currentProb
      });
      return;
    }

    const key = GENE_KEYS[geneIdx];
    for (const opt of options) {
      const alleles = getAllelesForOption(geneIdx, opt);
      const prob = getProbForOption(geneIdx, opt);
      if (prob <= 0) continue;
      const nextGenotype = { ...currentGenotype, [key]: alleles };
      recurse(geneIdx + 1, currentProb * prob, nextGenotype);
    }
  }

  recurse(0, 1, {});
  return results;
}

function getPhenotypeLabel(gene: GeneKey, phenotype: Phenotype): string {
  const value = phenotype[gene];
  if (gene === 'specialTrait' && value === null) return '无特殊能力';
  return value as string;
}

// 根据真实解锁优先级，确定该基因型实际解锁的未解锁物种
function determineUnlockedSpecies(
  genotype: Genotype,
  phenotype: Phenotype,
  unlockedSpecies: string[]
): Species | null {
  const matching = detectMatchingSpeciesFromGenotypePhenotype(genotype, phenotype);
  return matching.find(s => !unlockedSpecies.includes(s.id)) || null;
}

export function calculateCrossBreedPreview(
  parent1: Plant,
  parent2: Plant,
  uvLevel: number,
  unlockedSpecies: string[]
): CrossBreedPreviewResponse {
  const mutationRate = getMutationRate(uvLevel);
  const totalAlleleCount = GENE_KEYS.length * 2;
  const noMutationProb = Math.pow(1 - mutationRate, totalAlleleCount);
  const mutationProbability = 1 - noMutationProb;

  // 使用共享核心模块计算各基因概率分布
  const distributions = getAllGeneDistributions(parent1.genotype, parent2.genotype, uvLevel);
  const allGenotypes = enumerateAllGenotypes(distributions);

  const traitPhenotypeProbs: Record<GeneKey, Map<string, number>> = {} as Record<GeneKey, Map<string, number>>;
  for (const gene of GENE_KEYS) {
    traitPhenotypeProbs[gene] = new Map();
  }

  // 按真实优先级累加每个未解锁物种的概率
  const speciesUnlockProbs = new Map<string, number>();

  for (const { genotype, probability } of allGenotypes) {
    const phenotype = genotypeToPhenotype(genotype);

    for (const gene of GENE_KEYS) {
      const label = getPhenotypeLabel(gene, phenotype);
      const current = traitPhenotypeProbs[gene].get(label) || 0;
      traitPhenotypeProbs[gene].set(label, current + probability);
    }

    const newSpecies = determineUnlockedSpecies(genotype, phenotype, unlockedSpecies);
    if (newSpecies) {
      const current = speciesUnlockProbs.get(newSpecies.id) || 0;
      speciesUnlockProbs.set(newSpecies.id, current + probability);
    }
  }

  const traitProbabilities: GenePreview[] = GENE_KEYS.map(gene => {
    const phenotypeMap = traitPhenotypeProbs[gene];
    const entries: ProbabilityEntry[] = [];
    for (const [label, prob] of phenotypeMap.entries()) {
      if (prob > 0) {
        entries.push({ label, probability: prob });
      }
    }
    entries.sort((a, b) => b.probability - a.probability);
    return {
      gene,
      phenotypes: normalizeProbabilities(entries)
    };
  });

  // 遍历全部物种，保留所有未解锁物种（包括概率为0.00%的）
  // 物种概率不需要合计为100%，因为一次杂交只可能解锁一个（或零个）新物种
  const speciesUnlockProbabilities: SpeciesUnlockProbability[] = SPECIES
    .filter(species => !unlockedSpecies.includes(species.id))
    .map(species => {
      const rawProb = speciesUnlockProbs.get(species.id) || 0;
      return {
        speciesId: species.id,
        speciesName: species.name,
        rarity: species.rarity,
        image: species.image,
        probability: roundPercent(rawProb * 100)
      };
    })
    .sort((a, b) => b.probability - a.probability);

  return {
    traitProbabilities,
    mutationProbability: roundPercent(mutationProbability * 100),
    speciesUnlockProbabilities
  };
}
