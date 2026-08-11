export interface RuntimeState {
  userId: string;

  message: string;

  identity?: unknown;

  memories?: unknown[];

  knowledge?: unknown[];

  plans?: unknown[];

  context?: string;

  prompt?: string;

  response?: string;
}