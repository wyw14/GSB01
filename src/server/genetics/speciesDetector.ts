import { Genotype, Phenotype, Plant, Species } from '../../shared/types';
import { SPECIES, GENE_KEYS } from '../data/species';

const RARITY_SCORE: Record<Species['rarity'], number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 4
};

export function genotypeMatches(plantGenotype: Genotype, requiredGenotype: Partial<Genotype>): boolean {
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

export function phenotypeMatches(plantPhenotype: Phenotype, requiredPhenotype: Partial<Phenotype>): boolean {
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

type RankedSpecies = { species: Species; index: number; specificity: number; rarity: number };

export function rankSpecies(speciesList: Species[] = SPECIES): RankedSpecies[] {
  return speciesList
    .map((species, index) => ({
      species,
      index,
      specificity: getSpeciesSpecificity(species),
      rarity: RARITY_SCORE[species.rarity]
    }))
    .sort((a, b) => {
      const specificityDiff = b.specificity - a.specificity;
      if (specificityDiff !== 0) return specificityDiff;

      const rarityDiff = b.rarity - a.rarity;
      if (rarityDiff !== 0) return rarityDiff;

      return a.index - b.index;
    });
}

export function speciesMatchesGenotypePhenotype(
  genotype: Genotype,
  phenotype: Phenotype,
  species: Species
): boolean {
  return genotypeMatches(genotype, species.requiredGenotype)
    && phenotypeMatches(phenotype, species.requiredPhenotype);
}

export function detectMatchingSpecies(plant: Plant): Species[] {
  return rankSpecies()
    .filter(({ species }) =>
      speciesMatchesGenotypePhenotype(plant.genotype, plant.phenotype, species)
    )
    .map(({ species }) => species);
}

export function detectSpecies(plant: Plant): Species | null {
  return detectMatchingSpecies(plant)[0] || null;
}

export function checkNewSpecies(plant: Plant, unlockedSpecies: string[]): Species | null {
  return detectMatchingSpecies(plant).find(species => !unlockedSpecies.includes(species.id)) || null;
}
