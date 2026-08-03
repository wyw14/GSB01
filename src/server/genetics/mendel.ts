import { Genotype, Allele } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../data/species';
import { getMutationRate, getGameteProbabilities, flipAllele } from './inheritanceModel';

/** 按共享遗传规则（getGameteProbabilities）从一个亲本基因中随机取一个配子等位基因 */
function pickGameteAllele(parentAlleles: [Allele, Allele], gene: keyof Genotype): Allele {
  const info = GENE_INFO[gene];
  const gamete = getGameteProbabilities(parentAlleles, info.dominantAllele);
  return Math.random() < gamete.dominant ? info.dominantAllele : info.recessiveAllele;
}

export function crossGenotypes(parent1: Genotype, parent2: Genotype): Genotype {
  const offspring: Partial<Genotype> = {};

  for (const gene of GENE_KEYS) {
    offspring[gene] = [pickGameteAllele(parent1[gene], gene), pickGameteAllele(parent2[gene], gene)];
  }

  return offspring as Genotype;
}

export function mutateGenotype(
  genotype: Genotype,
  uvLevel: number
): { genotype: Genotype; mutated: boolean; mutationDetails?: { gene: keyof Genotype; from: [Allele, Allele]; to: [Allele, Allele] } } {
  const mutationRate = getMutationRate(uvLevel);

  const newGenotype: Genotype = JSON.parse(JSON.stringify(genotype));
  let mutated = false;
  let mutationDetails: { gene: keyof Genotype; from: [Allele, Allele]; to: [Allele, Allele] } | undefined;

  for (const gene of GENE_KEYS) {
    for (let i = 0; i < 2; i++) {
      if (Math.random() < mutationRate) {
        const original: [Allele, Allele] = [...newGenotype[gene]] as [Allele, Allele];
        newGenotype[gene][i] = flipAllele(newGenotype[gene][i], gene);
        mutated = true;
        mutationDetails = {
          gene,
          from: original,
          to: [...newGenotype[gene]] as [Allele, Allele]
        };
      }
    }
  }

  return {
    genotype: newGenotype,
    mutated,
    mutationDetails
  };
}

export function generateRandomGenotype(): Genotype {
  const alleles: Allele[] = ['A', 'a', 'B', 'b', 'C', 'c', 'D', 'd', 'E', 'e'];
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
