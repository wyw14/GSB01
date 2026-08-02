import { Genotype, Allele } from '../../shared/types';

// 重新导出遗传核心，保持向后兼容
// 预览和真实杂交的唯一规则来源是 geneticCore.ts
export {
  getMutationRate,
  flipAllele,
  crossAndMutateGenotype,
  getSingleGeneDistribution,
  getAllGeneDistributions
} from './geneticCore';
export type { GenotypeProbTriple, MutationDetails, CrossAndMutateResult } from './geneticCore';

// 随机生成初始植物基因型（仅用于培育新种子，不参与杂交规则）
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
