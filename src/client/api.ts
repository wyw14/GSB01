import {
  GameState,
  CrossBreedRequest,
  CrossBreedResponse,
  Species,
  Plant
} from '../shared/types';

const API_BASE = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getState(): Promise<GameState> {
    return request<GameState>('/state');
  },

  getSpecies(): Promise<Species[]> {
    return request<Species[]>('/species');
  },

  resetGame(): Promise<GameState> {
    return request<GameState>('/reset', { method: 'POST' });
  },

  crossbreed(data: CrossBreedRequest): Promise<CrossBreedResponse> {
    return request<CrossBreedResponse>('/crossbreed', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  setUVLevel(uvLevel: number): Promise<GameState> {
    return request<GameState>('/uv', {
      method: 'POST',
      body: JSON.stringify({ uvLevel })
    });
  },

  selectParent(plantId: string, slot: 1 | 2): Promise<GameState> {
    return request<GameState>('/select', {
      method: 'POST',
      body: JSON.stringify({ plantId, slot })
    });
  },

  deletePlant(plantId: string): Promise<GameState> {
    return request<GameState>(`/plants/${plantId}`, {
      method: 'DELETE'
    });
  },

  generatePlant(): Promise<{ plant: Plant; newSpecies?: Species }> {
    return request<{ plant: Plant; newSpecies?: Species }>('/generate', {
      method: 'POST'
    });
  }
};
