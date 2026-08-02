import {
  GameState,
  CrossBreedRequest,
  CrossBreedResponse,
  CrossBreedPreviewRequest,
  CrossBreedPreviewResponse,
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
    const errorData = await response.json().catch(() => ({ error: 'Unknown error', code: 'UNKNOWN' as const }));
    const error = new Error(errorData.error || `HTTP ${response.status}`) as Error & { code?: string; status?: number };
    error.code = errorData.code;
    error.status = response.status;
    throw error;
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

  preview(data: CrossBreedPreviewRequest, signal?: AbortSignal): Promise<CrossBreedPreviewResponse> {
    return request<CrossBreedPreviewResponse>('/preview', {
      method: 'POST',
      body: JSON.stringify(data),
      signal
    });
  },

  setUVLevel(uvLevel: number, signal?: AbortSignal): Promise<GameState> {
    return request<GameState>('/uv', {
      method: 'POST',
      body: JSON.stringify({ uvLevel }),
      signal
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
