export type Allele = 'A' | 'a' | 'B' | 'b' | 'C' | 'c' | 'D' | 'd' | 'E' | 'e';

export type Genotype = {
  glowColor: [Allele, Allele];
  leafShape: [Allele, Allele];
  plantSize: [Allele, Allele];
  glowIntensity: [Allele, Allele];
  specialTrait: [Allele, Allele];
};

export type Phenotype = {
  glowColor: string;
  leafShape: string;
  plantSize: string;
  glowIntensity: string;
  specialTrait: string | null;
};

export type Plant = {
  id: string;
  name: string;
  genotype: Genotype;
  phenotype: Phenotype;
  generation: number;
  isMutant: boolean;
};

export type Species = {
  id: string;
  name: string;
  description: string;
  requiredGenotype: Partial<Genotype>;
  requiredPhenotype: Partial<Phenotype>;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  image: string;
};

export type GameState = {
  plants: Plant[];
  unlockedSpecies: string[];
  uvLevel: number;
  selectedParent1: string | null;
  selectedParent2: string | null;
};

export type CrossBreedRequest = {
  parent1Id: string;
  parent2Id: string;
  uvLevel: number;
};

export type CrossBreedResponse = {
  offspring: Plant;
  mutationOccurred: boolean;
  mutationDetails?: {
    gene: keyof Genotype;
    from: [Allele, Allele];
    to: [Allele, Allele];
  };
  newSpeciesUnlocked?: Species;
};

export type CrossBreedPreviewRequest = {
  parent1Id: string;
  parent2Id: string;
  /** 不传则使用存档中的当前 UV 强度 */
  uvLevel?: number;
};

/** 单一表型取值的精确概率；probability 为 0~1 精确值，percentage 为 0~100 两位小数字符串 */
export type TraitOutcomePreview = {
  value: string | null;
  probability: number;
  percentage: string;
};

export type TraitPreview = {
  gene: keyof Genotype;
  outcomes: TraitOutcomePreview[];
};

export type SpeciesUnlockPreview = {
  speciesId: string;
  name: string;
  rarity: Species['rarity'];
  image: string;
  /** 本次杂交中“实际被解锁”的精确概率（已扣除更高优先级物种同时匹配的情况） */
  probability: number;
  percentage: string;
};

export type CrossBreedPreviewResponse = {
  parent1Id: string;
  parent2Id: string;
  uvLevel: number;
  /** 整株至少一个等位基因发生突变的概率 */
  mutationProbability: number;
  mutationPercentage: string;
  traits: TraitPreview[];
  /** 仅包含尚未解锁的物种；与 noNewSpecies 一起构成完整分布（合计 100.00%） */
  speciesUnlocks: SpeciesUnlockPreview[];
  noNewSpeciesProbability: number;
  noNewSpeciesPercentage: string;
};

export type GeneInfo = {
  gene: keyof Genotype;
  dominantAllele: Allele;
  recessiveAllele: Allele;
  dominantTrait: string;
  recessiveTrait: string;
};
