import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AppSnapshot, PetProfile, PetWindowSize } from "../shared/types.js";

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("snapshot:get"),
  subscribeSnapshot: (handler: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => handler(snapshot);
    ipcRenderer.on("snapshot:update", listener);
    return () => ipcRenderer.removeListener("snapshot:update", listener);
  },
  openPetMenu: (petId: string): void => ipcRenderer.send("pet:menu", petId),
  openHistory: (petId?: string): void => ipcRenderer.send("history:open", petId),
  openSettings: (): void => ipcRenderer.send("settings:open"),
  installHooks: (): Promise<{ codexInstalled: boolean; claudeInstalled: boolean }> => ipcRenderer.invoke("hooks:install"),
  uninstallHooks: (): Promise<{ codexInstalled: boolean; claudeInstalled: boolean }> => ipcRenderer.invoke("hooks:uninstall"),
  updatePet: (petId: string, payload: Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>): Promise<PetProfile | undefined> =>
    ipcRenderer.invoke("pet:update", petId, payload),
  updateSettings: (payload: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke("settings:update", payload),
  resizePetWindow: (petId: string, size: PetWindowSize): void => ipcRenderer.send("pet:resize-window", petId, size),
  startPetWindowDrag: (point: { x: number; y: number }): void => ipcRenderer.send("pet:drag-start", point),
  dragPetWindow: (point: { x: number; y: number }): void => ipcRenderer.send("pet:drag-move", point),
  endPetWindowDrag: (): void => ipcRenderer.send("pet:drag-end")
};

contextBridge.exposeInMainWorld("vibePet", api);

declare global {
  interface Window {
    vibePet: typeof api;
  }
}
