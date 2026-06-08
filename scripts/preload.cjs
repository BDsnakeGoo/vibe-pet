const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  subscribeSnapshot: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on("snapshot:update", listener);
    return () => ipcRenderer.removeListener("snapshot:update", listener);
  },
  openPetMenu: (petId) => ipcRenderer.send("pet:menu", petId),
  openHistory: (petId) => ipcRenderer.send("history:open", petId),
  openSettings: () => ipcRenderer.send("settings:open"),
  installHooks: () => ipcRenderer.invoke("hooks:install"),
  uninstallHooks: () => ipcRenderer.invoke("hooks:uninstall"),
  updatePet: (petId, payload) => ipcRenderer.invoke("pet:update", petId, payload),
  updateSettings: (payload) => ipcRenderer.invoke("settings:update", payload),
  submitPrompt: (prompt) => ipcRenderer.invoke("ai:submit-prompt", prompt),
  resizePetWindow: (petId, size) => ipcRenderer.send("pet:resize-window", petId, size),
  startPetWindowDrag: (point) => ipcRenderer.send("pet:drag-start", point),
  dragPetWindow: (point) => ipcRenderer.send("pet:drag-move", point),
  endPetWindowDrag: () => ipcRenderer.send("pet:drag-end")
};

contextBridge.exposeInMainWorld("vibePet", api);
