// Tiny typed event bus. The music engine emits, the world listens.
// Keeping this one-directional is what makes the sync feel intentional.

export type Mood = 'warm' | 'cool';

export interface MusicEvents {
  beat: { beat: number; bar: number; time: number };
  bar: { bar: number; time: number };
  chord: { name: string; mood: Mood; index: number };
  section: { name: SectionName; bar: number };
  hat: { velocity: number };
  kick: Record<string, never>;
}

export type SectionName = 'intro' | 'groove' | 'bridge' | 'breakdown';

type Handler<T> = (payload: T) => void;

class Bus {
  private handlers = new Map<keyof MusicEvents, Handler<never>[]>();

  on<K extends keyof MusicEvents>(event: K, fn: Handler<MusicEvents[K]>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(fn as Handler<never>);
    this.handlers.set(event, list);
  }

  emit<K extends keyof MusicEvents>(event: K, payload: MusicEvents[K]): void {
    const list = this.handlers.get(event) as Handler<MusicEvents[K]>[] | undefined;
    list?.forEach((fn) => fn(payload));
  }
}

export const bus = new Bus();
