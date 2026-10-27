import type { YanEvent, Unsubscribe } from '../contracts';

export class EventBus {
  private subs = new Set<(e: YanEvent) => void>();

  subscribe(fn: (e: YanEvent) => void): Unsubscribe {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  emit(e: YanEvent): void {
    for (const fn of [...this.subs]) {
      try {
        fn(e);
      } catch {
        // 单个订阅者出错不影响其他订阅者
      }
    }
  }
}
