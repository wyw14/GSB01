import { Genotype, Allele } from '../../shared/types';
import { GENE_KEYS, GENE_INFO } from '../data/species';

function getAllelePair(parent1Alleles: [Allele, Allele], parent2Alleles: [Allele, Allele]): [Allele, Allele] {
  const allele1 = parent1Alleles[Math.random() < 0.5 ? 0 : 1];
  const allele2 = parent2Alleles[Math.random() < 0.5 ? 0 : 1];
  return [allele1, allele2];
}

export function crossGenotypes(parent1: Genotype, parent2: Genotype): Genotype {
  const offspring: Partial<Genotype> = {};

  for (const gene of GENE_KEYS) {
    offspring[gene] = getAllelePair(parent1[gene], parent2[gene]);
  }

  return offspring as Genotype;
}

function flipAllele(allele: Allele, gene: keyof Genotype): Allele {
  const info = GENE_INFO[gene];
  if (allele === info.dominantAllele) {
    return info.recessiveAllele;
  }
  return info.dominantAllele;
}

export function mutateGenotype(
  genotype: Genotype,
  uvLevel: number
): { genotype: Genotype; mutated: boolean; mutationDetails?: { gene: keyof Genotype; from: [Allele, Allele]; to: [Allele, Allele] } } {
  const baseMutationRate = 0.02;
  const uvMultiplier = 1 + (uvLevel / 100) * 4;
  const mutationRate = baseMutationRate * uvMultiplier;

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
