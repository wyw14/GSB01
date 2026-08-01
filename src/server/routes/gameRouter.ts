import { Router, Request, Response } from 'express';
import {
  loadGameState,
  saveGameState,
  resetGameState,
  addPlant,
  removePlant,
  unlockSpecies,
  setUVLevel,
  selectParent,
  generateId
} from '../storage/jsonStorage';
import { crossGenotypes, mutateGenotype, generateRandomGenotype } from '../genetics/mendel';
import { genotypeToPhenotype, generateName } from '../genetics/genotypeToPhenotype';
import { checkNewSpecies } from '../genetics/speciesDetector';
import { SPECIES } from '../data/species';
import { CrossBreedRequest, CrossBreedResponse, Plant, GameState } from '../../shared/types';

const router = Router();

router.get('/state', (req: Request, res: Response) => {
  try {
    const state = loadGameState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load game state' });
  }
});

router.get('/species', (req: Request, res: Response) => {
  try {
    res.json(SPECIES);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load species' });
  }
});

router.post('/reset', (req: Request, res: Response) => {
  try {
    const state = resetGameState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset game state' });
  }
});

router.post('/crossbreed', (req: Request, res: Response) => {
  try {
    const { parent1Id, parent2Id, uvLevel }: CrossBreedRequest = req.body;

    if (!parent1Id || !parent2Id) {
      return res.status(400).json({ error: 'Both parents must be selected' });
    }

    if (parent1Id === parent2Id) {
      return res.status(400).json({ error: 'Parents must be two different plants' });
    }

    const state = loadGameState();
    
    const parent1 = state.plants.find(p => p.id === parent1Id);
    const parent2 = state.plants.find(p => p.id === parent2Id);

    if (!parent1 || !parent2) {
      return res.status(404).json({ error: 'One or both parents not found' });
    }

    let offspringGenotype = crossGenotypes(parent1.genotype, parent2.genotype);
    const mutationResult = mutateGenotype(offspringGenotype, uvLevel);
    offspringGenotype = mutationResult.genotype;

    const offspringPhenotype = genotypeToPhenotype(offspringGenotype);
    const maxGeneration = Math.max(parent1.generation, parent2.generation);

    const offspring: Plant = {
      id: generateId(),
      name: generateName(offspringPhenotype),
      genotype: offspringGenotype,
      phenotype: offspringPhenotype,
      generation: maxGeneration + 1,
      isMutant: mutationResult.mutated
    };

    let newState = addPlant(state, offspring);
    const newSpecies = checkNewSpecies(offspring, newState.unlockedSpecies);
    
    if (newSpecies) {
      newState = unlockSpecies(newState, newSpecies.id);
    }

    newState.selectedParent1 = null;
    newState.selectedParent2 = null;

    saveGameState(newState);

    const response: CrossBreedResponse = {
      offspring,
      mutationOccurred: mutationResult.mutated,
      mutationDetails: mutationResult.mutationDetails,
      newSpeciesUnlocked: newSpecies || undefined
    };

    res.json(response);
  } catch (error) {
    console.error('Crossbreed error:', error);
    res.status(500).json({ error: 'Failed to crossbreed' });
  }
});

router.post('/uv', (req: Request, res: Response) => {
  try {
    const { uvLevel } = req.body;
    
    if (uvLevel === undefined || uvLevel === null) {
      return res.status(400).json({ error: 'UV level is required' });
    }

    const state = loadGameState();
    const newState = setUVLevel(state, uvLevel);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to set UV level' });
  }
});

router.post('/select', (req: Request, res: Response) => {
  try {
    const { plantId, slot } = req.body;

    if (!plantId || !slot) {
      return res.status(400).json({ error: 'Plant ID and slot are required' });
    }

    if (slot !== 1 && slot !== 2) {
      return res.status(400).json({ error: 'Slot must be 1 or 2' });
    }

    const state = loadGameState();
    
    if (!state.plants.find(p => p.id === plantId)) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const newState = selectParent(state, plantId, slot);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to select parent' });
  }
});

router.delete('/plants/:plantId', (req: Request, res: Response) => {
  try {
    const { plantId } = req.params;
    const state = loadGameState();
    
    if (!state.plants.find(p => p.id === plantId)) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const newState = removePlant(state, plantId);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove plant' });
  }
});

router.post('/generate', (req: Request, res: Response) => {
  try {
    const state = loadGameState();
    const genotype = generateRandomGenotype();
    const phenotype = genotypeToPhenotype(genotype);
    
    const newPlant: Plant = {
      id: generateId(),
      name: generateName(phenotype),
      genotype,
      phenotype,
      generation: 0,
      isMutant: false
    };

    let newState = addPlant(state, newPlant);
    const newSpecies = checkNewSpecies(newPlant, newState.unlockedSpecies);
    
    if (newSpecies) {
      newState = unlockSpecies(newState, newSpecies.id);
    }

    saveGameState(newState);
    res.json({ plant: newPlant, newSpecies: newSpecies || undefined });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate new plant' });
  }
});

export default router;
