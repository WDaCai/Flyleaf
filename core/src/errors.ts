export class ConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(
    readonly rel: string,
    readonly currentMtimeMs: number,
  ) {
    super(`文件已被外部修改：${rel}`);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly rel: string) {
    super(`文件不存在：${rel}`);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  readonly code = 'BAD_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class VaultError extends Error {
  readonly code = 'VAULT';
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export function toApiError(e: unknown): { code: string; message: string } {
  if (e instanceof ConflictError) return { code: e.code, message: e.message };
  if (e instanceof NotFoundError) return { code: e.code, message: e.message };
  if (e instanceof BadRequestError) return { code: e.code, message: e.message };
  if (e instanceof VaultError) return { code: e.code, message: e.message };
  if (e instanceof Error) return { code: 'INTERNAL', message: e.message };
  return { code: 'INTERNAL', message: String(e) };
}
