export interface PetWindowCloseContext {
  petId: string;
  isQuitting: boolean;
  petStillExists: boolean;
}

export class PetWindowDismissals {
  private readonly dismissedPetIds = new Set<string>();

  markClosed(context: PetWindowCloseContext): void {
    if (context.isQuitting || !context.petStillExists) {
      return;
    }

    this.dismiss(context.petId);
  }

  dismiss(petId: string): void {
    this.dismissedPetIds.add(petId);
  }

  forget(petId: string): void {
    this.dismissedPetIds.delete(petId);
  }

  restoreAll(): void {
    this.dismissedPetIds.clear();
  }

  shouldCreateWindow(petId: string): boolean {
    return !this.dismissedPetIds.has(petId);
  }
}
