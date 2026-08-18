import { RetryCache } from "./retry-cache.ts";

export interface Profile {
  readonly id: string;
  readonly name: string;
}

export class ProfileService {
  readonly #cache = new RetryCache();

  constructor(readonly loadProfile: (id: string) => Promise<Profile>) {}

  getProfile(id: string): Promise<Profile> {
    return this.#cache.getOrLoad(id, () => this.loadProfile(id));
  }
}
