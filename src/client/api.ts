import {
  GameState,
  CrossBreedRequest,
  CrossBreedResponse,
  Species,
  Plant,
  PreviewRequest,
  PreviewResult
} from '../shared/types';

const API_BASE = '/api';

type RequestOptions = RequestInit & { allowErrorBody?: boolean };

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { allowErrorBody = false, ...fetchOptions } = options;
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers
    },
    ...fetchOptions
  });

  if (!response.ok && !allowErrorBody) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getState(signal?: AbortSignal): Promise<GameState> {
    return request<GameState>('/state', { signal });
  },

  getSpecies(signal?: AbortSignal): Promise<Species[]> {
    return request<Species[]>('/species', { signal });
  },

  resetGame(): Promise<GameState> {
    return request<GameState>('/reset', { method: 'POST' });
  },

  crossbreed(data: CrossBreedRequest, signal?: AbortSignal): Promise<CrossBreedResponse> {
    return request<CrossBreedResponse>('/crossbreed', {
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

  selectParent(plantId: string, slot: 1 | 2, signal?: AbortSignal): Promise<GameState> {
    return request<GameState>('/select', {
      method: 'POST',
      body: JSON.stringify({ plantId, slot }),
      signal
    });
  },

  deletePlant(plantId: string, signal?: AbortSignal): Promise<GameState> {
    return request<GameState>(`/plants/${plantId}`, {
      method: 'DELETE',
      signal
    });
  },

  generatePlant(signal?: AbortSignal): Promise<{ plant: Plant; newSpecies?: Species }> {
    return request<{ plant: Plant; newSpecies?: Species }>('/generate', {
      method: 'POST',
      signal
    });
  },

  previewCrossbreed(data: PreviewRequest, signal?: AbortSignal): Promise<PreviewResult> {
    return request<PreviewResult>('/preview', {
      method: 'POST',
      body: JSON.stringify(data),
      allowErrorBody: true,
      signal
    });
  }
};
