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

export type PreviewRequest = {
  parent1Id: string;
  parent2Id: string;
  uvLevel: number;
};

export type PreviewErrorCode =
  | 'MISSING_PARENT'
  | 'SAME_PARENT'
  | 'PARENT_NOT_FOUND'
  | 'UV_OUT_OF_RANGE';

export type PreviewError = {
  code: PreviewErrorCode;
  message: string;
};

export type GenotypeOutcome = {
  genotype: [Allele, Allele];
  probabilityPercent: number;
};

export type PhenotypeOutcome = {
  phenotype: string;
  probabilityPercent: number;
};

export type GenePreview = {
  gene: keyof Genotype;
  label: string;
  genotypeOutcomes: GenotypeOutcome[];
  phenotypeOutcomes: PhenotypeOutcome[];
};

export type SpeciesUnlockOutcome = {
  speciesId: string;
  speciesName: string;
  rarity: Species['rarity'];
  image: string;
  matchProbabilityPercent: number;
  unlockProbabilityPercent: number;
  blockedBy: string[];
};

export type PreviewResponse = {
  valid: true;
  parent1Name: string;
  parent2Name: string;
  uvLevel: number;
  perAlleleMutationRate: number;
  mutationProbabilityPercent: number;
  anySpeciesUnlockProbabilityPercent: number;
  noSpeciesUnlockProbabilityPercent: number;
  genes: GenePreview[];
  speciesUnlocks: SpeciesUnlockOutcome[];
};

export type PreviewResult = PreviewResponse | { valid: false; error: PreviewError };
