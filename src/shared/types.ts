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

export type GeneInfo = {
  gene: keyof Genotype;
  dominantAllele: Allele;
  recessiveAllele: Allele;
  dominantTrait: string;
  recessiveTrait: string;
};

// ---- 杂交预览（只读）相关共享类型 ----
// 前后端共用，保证预览与真实杂交口径一致，且可被后续育种目标推荐直接复用。

export type CrossPreviewRequest = {
  parent1Id: string;
  parent2Id: string;
  uvLevel: number;
};

// 单个性状的一种可能结果。probability 为 0-100 的百分比，保留两位小数。
export type TraitOutcome = {
  // 表型取值，与 Phenotype 字段口径一致：特殊性状的隐性结果为 null（而非字符串 'none'）。
  value: string | null;
  label: string; // 展示用中文标签，由服务端提供，前端只负责渲染
  probability: number;
};

// 一类性状（对应一个基因）的完整可能结果，outcomes 舍入后合计 100.00。
export type TraitPreview = {
  gene: keyof Genotype;
  geneLabel: string;
  outcomes: TraitOutcome[];
};

// 某个尚未解锁物种在本次杂交中实际被解锁的概率（0-100）。
export type SpeciesUnlockChance = {
  speciesId: string;
  speciesName: string;
  probability: number;
};

// 物种解锁分组：所有物种概率 + noUnlockProbability 舍入后合计 100.00。
export type SpeciesUnlockPreview = {
  chances: SpeciesUnlockChance[];
  noUnlockProbability: number;
};

export type CrossPreviewResponse = {
  uvLevel: number;
  parent1Id: string;
  parent2Id: string;
  traits: TraitPreview[];
  mutationProbability: number; // 整株发生突变（至少一个等位基因翻转）的概率，0-100
  speciesUnlock: SpeciesUnlockPreview;
};
