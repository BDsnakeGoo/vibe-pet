import type { AppSettings, AppSnapshot, PetProfile, PetWindowSize } from "../shared/types";

declare global {
  interface Window {
    vibePet: {
      getSnapshot(): Promise<AppSnapshot>;
      subscribeSnapshot(handler: (snapshot: AppSnapshot) => void): () => void;
      openPetMenu(petId: string): void;
      openHistory(petId?: string): void;
      openSettings(): void;
      installHooks(): Promise<{ codexInstalled: boolean; claudeInstalled: boolean }>;
      uninstallHooks(): Promise<{ codexInstalled: boolean; claudeInstalled: boolean }>;
      updatePet(petId: string, payload: Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>): Promise<PetProfile | undefined>;
      updateSettings(payload: Partial<AppSettings>): Promise<AppSettings>;
      resizePetWindow(petId: string, size: PetWindowSize): void;
      startPetWindowDrag(point: { x: number; y: number }): void;
      dragPetWindow(point: { x: number; y: number }): void;
      endPetWindowDrag(): void;
    };
  }
}

export {};
