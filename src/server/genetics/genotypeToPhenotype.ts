import { Genotype, Phenotype, Allele } from '../../shared/types';
import { GENE_INFO } from '../data/species';

function isDominant(allele1: Allele, allele2: Allele, dominant: Allele): boolean {
  return allele1 === dominant || allele2 === dominant;
}

export function genotypeToPhenotype(genotype: Genotype): Phenotype {
  const glowColor = isDominant(genotype.glowColor[0], genotype.glowColor[1], GENE_INFO.glowColor.dominantAllele)
    ? GENE_INFO.glowColor.dominantTrait
    : GENE_INFO.glowColor.recessiveTrait;

  const leafShape = isDominant(genotype.leafShape[0], genotype.leafShape[1], GENE_INFO.leafShape.dominantAllele)
    ? GENE_INFO.leafShape.dominantTrait
    : GENE_INFO.leafShape.recessiveTrait;

  const plantSize = isDominant(genotype.plantSize[0], genotype.plantSize[1], GENE_INFO.plantSize.dominantAllele)
    ? GENE_INFO.plantSize.dominantTrait
    : GENE_INFO.plantSize.recessiveTrait;

  const glowIntensity = isDominant(genotype.glowIntensity[0], genotype.glowIntensity[1], GENE_INFO.glowIntensity.dominantAllele)
    ? GENE_INFO.glowIntensity.dominantTrait
    : GENE_INFO.glowIntensity.recessiveTrait;

  const hasSpecialTrait = isDominant(genotype.specialTrait[0], genotype.specialTrait[1], GENE_INFO.specialTrait.dominantAllele);
  const specialTrait = hasSpecialTrait ? GENE_INFO.specialTrait.dominantTrait : null;

  return {
    glowColor,
    leafShape,
    plantSize,
    glowIntensity,
    specialTrait
  };
}

export function generateName(phenotype: Phenotype): string {
  const colorPrefix: Record<string, string> = {
    cyan: '青岚',
    magenta: '品紫'
  };

  const shapePrefix: Record<string, string> = {
    crystalline: '晶',
    tentacle: '蔓'
  };

  const sizeSuffix: Record<string, string> = {
    giant: '巨灵',
    dwarf: '微灵'
  };

  const intensityModifier: Record<string, string> = {
    bright: '耀',
    dim: '幽'
  };

  const prefix = colorPrefix[phenotype.glowColor] || '异';
  const shape = shapePrefix[phenotype.leafShape] || '灵';
  const intensity = intensityModifier[phenotype.glowIntensity] || '幻';
  const suffix = phenotype.specialTrait === 'floating' ? '浮' : '';
  const size = sizeSuffix[phenotype.plantSize] || '灵';

  return `${prefix}${intensity}${shape}${suffix}${size}`;
}
