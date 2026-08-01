import type { GeneInfo, Genotype } from './types';

export const GENE_KEYS = [
  'glowColor',
  'leafShape',
  'plantSize',
  'glowIntensity',
  'specialTrait'
] as const satisfies readonly (keyof Genotype)[];

export type GeneKey = typeof GENE_KEYS[number];

export const GENE_INFO: Record<GeneKey, GeneInfo> = {
  glowColor: {
    gene: 'glowColor',
    dominantAllele: 'A',
    recessiveAllele: 'a',
    dominantTrait: 'cyan',
    recessiveTrait: 'magenta'
  },
  leafShape: {
    gene: 'leafShape',
    dominantAllele: 'B',
    recessiveAllele: 'b',
    dominantTrait: 'crystalline',
    recessiveTrait: 'tentacle'
  },
  plantSize: {
    gene: 'plantSize',
    dominantAllele: 'C',
    recessiveAllele: 'c',
    dominantTrait: 'giant',
    recessiveTrait: 'dwarf'
  },
  glowIntensity: {
    gene: 'glowIntensity',
    dominantAllele: 'D',
    recessiveAllele: 'd',
    dominantTrait: 'bright',
    recessiveTrait: 'dim'
  },
  specialTrait: {
    gene: 'specialTrait',
    dominantAllele: 'E',
    recessiveAllele: 'e',
    dominantTrait: 'floating',
    recessiveTrait: 'none'
  }
};
