/**
 * 过期请求废止器：每次相关状态变化都使在途请求令牌失效，
 * 响应返回时仅当令牌仍最新才允许应用结果，
 * 避免旧结果覆盖已经更新的提示或新请求的结果。
 */
export type LatestRequestTracker = {
  /** 使所有在途请求失效，并返回一个新令牌 */
  invalidate(): number;
  /** 令牌是否仍然最新（期间没有新的状态变化或新请求） */
  isLatest(token: number): boolean;
};

export function createLatestRequestTracker(): LatestRequestTracker {
  let seq = 0;
  return {
    invalidate: () => ++seq,
    isLatest: token => token === seq
  };
}
