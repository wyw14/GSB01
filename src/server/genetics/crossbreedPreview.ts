import { Genotype, Phenotype, Plant, Species, CrossBreedPreviewResponse, TraitOutcomePreview, SpeciesUnlockPreview } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../../shared/constants';
import { roundPercentages } from '../../shared/probability';
import { SPECIES } from '../data/species';
import { genotypeToPhenotype } from './genotypeToPhenotype';
import { checkNewSpecies } from './speciesDetector';
import { getMutationRate, getOffspringGeneDistribution } from './inheritanceModel';

/** 单个基因两位等位基因中显性等位基因的个数（0/1/2），表型与物种匹配均只依赖该数量 */
type DominantCount = 0 | 1 | 2;

function pairFromCount(gene: keyof Genotype, count: DominantCount): [string, string] {
  const info = GENE_INFO[gene];
  if (count === 2) return [info.dominantAllele, info.dominantAllele];
  if (count === 1) return [info.dominantAllele, info.recessiveAllele];
  return [info.recessiveAllele, info.recessiveAllele];
}

/**
 * 精确计算杂交预览：枚举 5 个基因共 3^5 = 243 种子代基因型组合（各基因独立），
 * 表型与物种判定直接复用 genotypeToPhenotype / checkNewSpecies，保证与真实杂交口径一致。
 */
export function computeCrossBreedPreview(
  parent1Id: string,
  parent2Id: string,
  parent1: Genotype,
  parent2: Genotype,
  uvLevel: number,
  unlockedSpecies: string[]
): CrossBreedPreviewResponse {
  const mutationRate = getMutationRate(uvLevel);

  // 单基因精确分布来自共享遗传模型，与真实杂交的随机过程同分布（非随机抽样）
  const geneDistributions = GENE_KEYS.map(gene => ({
    gene,
    dist: getOffspringGeneDistribution(parent1[gene], parent2[gene], GENE_INFO[gene].dominantAllele, mutationRate)
  }));

  // 性状概率按表型取值聚合：Map<表型值, 概率>
  const traitBuckets = new Map<keyof Genotype, Map<string | null, number>>(
    GENE_KEYS.map(gene => [gene, new Map<string | null, number>()])
  );
  const speciesProbability = new Map<string, number>();
  let noNewSpeciesProbability = 0;

  // 枚举全部 3^5 种组合；基因之间相互独立，组合概率为各基因概率之积
  const counts: DominantCount[] = [0, 1, 2];
  for (const c0 of counts) for (const c1 of counts) for (const c2 of counts)
  for (const c3 of counts) for (const c4 of counts) {
    const combination = [c0, c1, c2, c3, c4];
    let probability = 1;
    const genotype = {} as Genotype;
    for (let i = 0; i < GENE_KEYS.length; i++) {
      const { gene, dist } = geneDistributions[i];
      probability *= dist[combination[i]];
      genotype[gene] = pairFromCount(gene, combination[i]) as Genotype[typeof gene];
    }
    if (probability === 0) continue;

    const phenotype: Phenotype = genotypeToPhenotype(genotype);
    for (const gene of GENE_KEYS) {
      const bucket = traitBuckets.get(gene)!;
      const value = phenotype[gene];
      bucket.set(value, (bucket.get(value) || 0) + probability);
    }

    // 与真实杂交一致：每次杂交只解锁优先级最高的那个未解锁物种
    const previewPlant: Plant = {
      id: 'preview',
      name: 'preview',
      genotype,
      phenotype,
      generation: 0,
      isMutant: false
    };
    const unlocked = checkNewSpecies(previewPlant, unlockedSpecies);
    if (unlocked) {
      speciesProbability.set(unlocked.id, (speciesProbability.get(unlocked.id) || 0) + probability);
    } else {
      noNewSpeciesProbability += probability;
    }
  }

  const traits = GENE_KEYS.map(gene => {
    const info = GENE_INFO[gene];
    const bucket = traitBuckets.get(gene)!;
    // 显性性状排在前面，展示顺序稳定
    const orderedValues: (string | null)[] = [info.dominantTrait, info.recessiveTrait === 'none' ? null : info.recessiveTrait];
    const outcomes: TraitOutcomePreview[] = orderedValues
      .filter(value => bucket.has(value))
      .map(value => ({ value, probability: bucket.get(value)!, percentage: '' }));
    const percentages = roundPercentages(outcomes.map(o => o.probability));
    outcomes.forEach((o, i) => { o.percentage = percentages[i]; });
    return { gene, outcomes };
  });

  const lockedSpecies = SPECIES.filter(species => !unlockedSpecies.includes(species.id));
  // 物种解锁事件互斥，与“无新物种”构成完整分布，作为一组统一舍入保证合计 100.00%
  const speciesGroupProbabilities = [...lockedSpecies.map(s => speciesProbability.get(s.id) || 0), noNewSpeciesProbability];
  const speciesGroupPercentages = roundPercentages(speciesGroupProbabilities);

  const speciesUnlocks: SpeciesUnlockPreview[] = lockedSpecies
    .map((species: Species, i) => ({
      speciesId: species.id,
      name: species.name,
      rarity: species.rarity,
      image: species.image,
      probability: speciesGroupProbabilities[i],
      percentage: speciesGroupPercentages[i]
    }))
    .sort((a, b) => b.probability - a.probability);

  // 整株突变概率 = 1 - 10 个等位基因全部不翻转的概率
  const mutationProbability = 1 - Math.pow(1 - mutationRate, GENE_KEYS.length * 2);

  return {
    parent1Id,
    parent2Id,
    uvLevel,
    mutationProbability,
    mutationPercentage: (mutationProbability * 100).toFixed(2),
    traits,
    speciesUnlocks,
    noNewSpeciesProbability,
    noNewSpeciesPercentage: speciesGroupPercentages[speciesGroupPercentages.length - 1]
  };
}
