/** 씬 계약. 로비와 게임은 이 인터페이스 하나로 교체된다. */
import type { Connection } from '../net/connection';
import type { ClientWorld } from '../net/clientWorld';
import type { SnapshotBuffer } from '../net/snapshotBuffer';
import type { InputController } from '../input/inputController';

export interface Scene {
  update(dtMs: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  destroy(): void;
}

/** 씬이 공유하는 것들. 씬이 바뀌어도 이 객체들은 살아남는다. */
export interface SceneContext {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  conn: Connection;
  world: ClientWorld;
  buffer: SnapshotBuffer;
  input: InputController;
  /** CSS 픽셀 기준 화면 크기. main이 리사이즈 때 갱신한다. */
  view: { w: number; h: number };
  stats: { rttMs: number; fps: number };
}
