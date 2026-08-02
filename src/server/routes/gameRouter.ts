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
  generateId,
  readGameStateReadOnly,
  GameStateUnavailableError
} from '../storage/jsonStorage';
import { crossParents, generateRandomGenotype } from '../genetics/mendel';
import { genotypeToPhenotype, generateName } from '../genetics/genotypeToPhenotype';
import { checkNewSpecies } from '../genetics/speciesDetector';
import { computeCrossPreview } from '../genetics/crossPreview';
import { SPECIES } from '../data/species';
import {
  CrossBreedRequest,
  CrossBreedResponse,
  CrossPreviewRequest,
  Plant,
  GameState
} from '../../shared/types';

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

    const crossResult = crossParents(parent1.genotype, parent2.genotype, uvLevel);
    const offspringGenotype = crossResult.genotype;

    const offspringPhenotype = genotypeToPhenotype(offspringGenotype);
    const maxGeneration = Math.max(parent1.generation, parent2.generation);

    const offspring: Plant = {
      id: generateId(),
      name: generateName(offspringPhenotype),
      genotype: offspringGenotype,
      phenotype: offspringPhenotype,
      generation: maxGeneration + 1,
      isMutant: crossResult.mutated
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
      mutationOccurred: crossResult.mutated,
      mutationDetails: crossResult.mutationDetails,
      newSpeciesUnlocked: newSpecies || undefined
    };

    res.json(response);
  } catch (error) {
    console.error('Crossbreed error:', error);
    res.status(500).json({ error: 'Failed to crossbreed' });
  }
});

// 只读的杂交预览：仅读取当前存档并做精确概率计算，绝不新增植物/解锁物种/改亲本/写存档。
router.post('/crossbreed/preview', (req: Request, res: Response) => {
  try {
    const { parent1Id, parent2Id, uvLevel }: CrossPreviewRequest = req.body;

    if (!parent1Id || !parent2Id) {
      return res.status(400).json({ error: '请先选择两株亲本植物' });
    }

    if (parent1Id === parent2Id) {
      return res.status(400).json({ error: '请选择两株不同的亲本植物' });
    }

    if (typeof uvLevel !== 'number' || Number.isNaN(uvLevel) || uvLevel < 0 || uvLevel > 100) {
      return res.status(400).json({ error: '紫外线强度需在 0 到 100 之间' });
    }

    // 严格只读：不使用 loadGameState（其会在缺失/损坏/需归一化时创建或重写存档），
    // 改用 readGameStateReadOnly，存档不存在或损坏时返回错误但绝不落盘。
    let state: GameState;
    try {
      state = readGameStateReadOnly();
    } catch (error) {
      if (error instanceof GameStateUnavailableError) {
        return res.status(409).json({ error: '存档不可用，无法生成预览' });
      }
      throw error;
    }

    const parent1 = state.plants.find(p => p.id === parent1Id);
    const parent2 = state.plants.find(p => p.id === parent2Id);

    if (!parent1 || !parent2) {
      return res.status(404).json({ error: '亲本植物不存在或已被删除' });
    }

    const preview = computeCrossPreview(parent1, parent2, uvLevel, state.unlockedSpecies);
    res.json(preview);
  } catch (error) {
    console.error('Crossbreed preview error:', error);
    res.status(500).json({ error: 'Failed to compute crossbreed preview' });
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
