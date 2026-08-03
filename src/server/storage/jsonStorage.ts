import * as fs from 'fs';
import * as path from 'path';
import { GameState, Plant } from '../../shared/types';
import { generateRandomGenotype } from '../genetics/mendel';
import { genotypeToPhenotype, generateName } from '../genetics/genotypeToPhenotype';
import { SPECIES } from '../data/species';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'gamestate.json');

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function createInitialPlants(): Plant[] {
  const plants: Plant[] = [];
  
  for (let i = 0; i < 4; i++) {
    const genotype = generateRandomGenotype();
    const phenotype = genotypeToPhenotype(genotype);
    plants.push({
      id: generateId(),
      name: generateName(phenotype),
      genotype,
      phenotype,
      generation: 0,
      isMutant: false
    });
  }
  
  return plants;
}

function getDefaultState(): GameState {
  return {
    plants: createInitialPlants(),
    unlockedSpecies: [],
    uvLevel: 0,
    selectedParent1: null,
    selectedParent2: null
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeGameState(state: GameState): GameState {
  const plantIds = new Set(state.plants.map(plant => plant.id));
  const validSpeciesIds = new Set(SPECIES.map(species => species.id));
  const selectedParent1 = state.selectedParent1 && plantIds.has(state.selectedParent1)
    ? state.selectedParent1
    : null;
  const selectedParent2 = state.selectedParent2 &&
    plantIds.has(state.selectedParent2) &&
    state.selectedParent2 !== selectedParent1
    ? state.selectedParent2
    : null;

  return {
    ...state,
    unlockedSpecies: [...new Set(state.unlockedSpecies)].filter(speciesId => validSpeciesIds.has(speciesId)),
    uvLevel: Math.max(0, Math.min(100, state.uvLevel)),
    selectedParent1,
    selectedParent2
  };
}

export function loadGameState(): GameState {
  ensureDataDir();
  
  if (!fs.existsSync(STATE_FILE)) {
    const defaultState = getDefaultState();
    saveGameState(defaultState);
    return defaultState;
  }
  
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsedState = JSON.parse(data) as GameState;
    const normalizedState = normalizeGameState(parsedState);

    if (JSON.stringify(parsedState) !== JSON.stringify(normalizedState)) {
      saveGameState(normalizedState);
    }

    return normalizedState;
  } catch (error) {
    console.error('Failed to load game state, using default:', error);
    const defaultState = getDefaultState();
    saveGameState(defaultState);
    return defaultState;
  }
}

export function saveGameState(state: GameState): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// 只读读取存档，供预览等只读接口使用。
// 与 loadGameState 的关键区别：绝不创建数据目录、绝不创建/修复/重写存档文件。
// 存档不存在或损坏时抛出 GameStateUnavailableError，由调用方转成错误响应，
// 归一化只在内存中进行、不落盘，从而保证存档是否存在及其原始字节都不被改变。
export class GameStateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameStateUnavailableError';
  }
}

export function readGameStateReadOnly(): GameState {
  if (!fs.existsSync(STATE_FILE)) {
    throw new GameStateUnavailableError('Game state file does not exist');
  }

  let data: string;
  try {
    data = fs.readFileSync(STATE_FILE, 'utf-8');
  } catch {
    throw new GameStateUnavailableError('Game state file is unreadable');
  }

  let parsedState: GameState;
  try {
    parsedState = JSON.parse(data) as GameState;
  } catch {
    throw new GameStateUnavailableError('Game state file is corrupted');
  }

  if (!parsedState || !Array.isArray(parsedState.plants)) {
    throw new GameStateUnavailableError('Game state file is malformed');
  }

  // 仅在内存中归一化，不写回文件。
  return normalizeGameState(parsedState);
}

export function resetGameState(): GameState {
  const defaultState = getDefaultState();
  saveGameState(defaultState);
  return defaultState;
}

export function addPlant(state: GameState, plant: Plant): GameState {
  return {
    ...state,
    plants: [...state.plants, plant]
  };
}

export function removePlant(state: GameState, plantId: string): GameState {
  return {
    ...state,
    plants: state.plants.filter(p => p.id !== plantId),
    selectedParent1: state.selectedParent1 === plantId ? null : state.selectedParent1,
    selectedParent2: state.selectedParent2 === plantId ? null : state.selectedParent2
  };
}

export function unlockSpecies(state: GameState, speciesId: string): GameState {
  if (state.unlockedSpecies.includes(speciesId)) {
    return state;
  }
  return {
    ...state,
    unlockedSpecies: [...state.unlockedSpecies, speciesId]
  };
}

export function setUVLevel(state: GameState, uvLevel: number): GameState {
  const clampedLevel = Math.max(0, Math.min(100, uvLevel));
  return {
    ...state,
    uvLevel: clampedLevel
  };
}

export function selectParent(state: GameState, parentId: string, parentSlot: 1 | 2): GameState {
  if (parentSlot === 1) {
    const shouldClearSlot = state.selectedParent1 === parentId;
    return {
      ...state,
      selectedParent1: shouldClearSlot ? null : parentId,
      selectedParent2: state.selectedParent2 === parentId ? null : state.selectedParent2
    };
  } else {
    const shouldClearSlot = state.selectedParent2 === parentId;
    return {
      ...state,
      selectedParent1: state.selectedParent1 === parentId ? null : state.selectedParent1,
      selectedParent2: shouldClearSlot ? null : parentId
    };
  }
}

export { generateId };
