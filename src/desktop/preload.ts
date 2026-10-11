import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  openImage: () => ipcRenderer.invoke('image:open'),
  saveImage: (image: string) => ipcRenderer.invoke('image:save', image),
  openMediaFile: (file: File) => ipcRenderer.invoke('media:open', webUtils.getPathForFile(file)),
  exportMedia: (request: unknown) => ipcRenderer.invoke('media:export', request),
  cancelMedia: () => ipcRenderer.invoke('media:cancel'),
  onMediaProgress: (callback: (value: { frames: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { frames: number; total: number }) => callback(value);
    ipcRenderer.on('media:progress', listener);
    return () => ipcRenderer.removeListener('media:progress', listener);
  }
});
