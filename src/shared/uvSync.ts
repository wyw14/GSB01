import { GameState } from './types';

/**
 * UV 滑块变化时先在本地生效：保证页面显示值、预览使用值和真实杂交使用值
 * 始终一致，即使 /api/uv 的请求尚未返回。原状态不被修改。
 */
export function applyUVLevelLocally(state: GameState, uvLevel: number): GameState {
  return { ...state, uvLevel };
}

/**
 * 合并 /api/uv 响应：仅当响应对应最后一次滑块操作时才采用，
 * 避免快速拖动时乱序响应把旧 UV 覆盖回来；只合并 uvLevel，
 * 不覆盖等待期间本地已确认的亲本选择等其它状态。
 */
export function mergeUVResponse(state: GameState, response: GameState, isLatest: boolean): GameState {
  if (!isLatest) {
    return state;
  }
  return { ...state, uvLevel: response.uvLevel };
}

/**
 * UV 保存串行队列：多次滑块操作产生的保存请求按发起顺序依次执行，
 * 保证服务端存档的写入顺序与页面操作顺序一致；
 * 杂交前调用 drain() 等待全部保存落盘，使页面值、预览值与存档值对齐。
 */
export type UVSaveQueue = {
  /** 将一次保存操作排入队列，返回该操作（含其前所有操作）完成的 Promise */
  enqueue(task: () => Promise<void>): Promise<void>;
  /** 等待当前已排入的所有保存完成 */
  drain(): Promise<void>;
};

export function createUVSaveQueue(): UVSaveQueue {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      // 单个任务失败不阻断后续保存；错误由任务自身处理（如记录日志）
      chain = chain.then(() => task().catch(() => undefined));
      return chain;
    },
    drain() {
      return chain;
    }
  };
}
