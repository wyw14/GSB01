import { Genotype, Phenotype, Plant, Species } from '../../shared/types';
import { SPECIES, GENE_KEYS } from '../data/species';

const RARITY_SCORE: Record<Species['rarity'], number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 4
};

function genotypeMatches(plantGenotype: Genotype, requiredGenotype: Partial<Genotype>): boolean {
  for (const gene of GENE_KEYS) {
    const required = requiredGenotype[gene];
    if (required) {
      const plantAlleles = [...plantGenotype[gene]].sort().join('');
      const requiredAlleles = [...required].sort().join('');
      if (plantAlleles !== requiredAlleles) {
        return false;
      }
    }
  }
  return true;
}

function phenotypeMatches(plantPhenotype: Phenotype, requiredPhenotype: Partial<Phenotype>): boolean {
  for (const [key, value] of Object.entries(requiredPhenotype)) {
    if (plantPhenotype[key as keyof Phenotype] !== value) {
      return false;
    }
  }
  return true;
}

function getSpeciesSpecificity(species: Species): number {
  return Object.keys(species.requiredGenotype).length + Object.keys(species.requiredPhenotype).length;
}

export function detectMatchingSpecies(plant: Plant): Species[] {
  return SPECIES
    .map((species, index) => ({ species, index }))
    .filter(({ species }) =>
      genotypeMatches(plant.genotype, species.requiredGenotype) &&
      phenotypeMatches(plant.phenotype, species.requiredPhenotype)
    )
    .sort((a, b) => {
      const specificityDiff = getSpeciesSpecificity(b.species) - getSpeciesSpecificity(a.species);
      if (specificityDiff !== 0) return specificityDiff;

      const rarityDiff = RARITY_SCORE[b.species.rarity] - RARITY_SCORE[a.species.rarity];
      if (rarityDiff !== 0) return rarityDiff;

      return a.index - b.index;
    })
    .map(({ species }) => species);
}

export function detectSpecies(plant: Plant): Species | null {
  return detectMatchingSpecies(plant)[0] || null;
}

export function checkNewSpecies(plant: Plant, unlockedSpecies: string[]): Species | null {
  return detectMatchingSpecies(plant).find(species => !unlockedSpecies.includes(species.id)) || null;
}
