import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type PatcherProgressEvent,
  type PatcherStateEvent,
  type UpdaterStatusEvent,
  type YufaApi,
} from '@yufa/shared'

function on<T>(channel: string) {
  return (cb: (e: T) => void): (() => void) => {
    const listener = (_event: unknown, data: T): void => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api: YufaApi = {
  patcherCheck: () => ipcRenderer.invoke(IPC.patcherCheck),
  patcherStart: () => ipcRenderer.invoke(IPC.patcherStart),
  patcherRepair: () => ipcRenderer.invoke(IPC.patcherRepair),
  patcherCancel: () => ipcRenderer.invoke(IPC.patcherCancel),
  patcherCheckRuntimes: () => ipcRenderer.invoke(IPC.patcherCheckRuntimes),
  gameLaunch: () => ipcRenderer.invoke(IPC.gameLaunch),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (partial) => ipcRenderer.invoke(IPC.settingsSet, partial),
  settingsSelectGamePath: (title) => ipcRenderer.invoke(IPC.settingsSelectGamePath, title),
  installDefaultPath: () => ipcRenderer.invoke(IPC.installDefaultPath),
  installValidatePath: (path) => ipcRenderer.invoke(IPC.installValidatePath, path),
  installBrowse: (current, title) => ipcRenderer.invoke(IPC.installBrowse, current, title),
  installStart: (path) => ipcRenderer.invoke(IPC.installStart, path),
  newsGet: () => ipcRenderer.invoke(IPC.newsGet),
  communityGet: () => ipcRenderer.invoke(IPC.communityGet),
  appGetInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  appOpenExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
  appOpenLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
  windowMinimize: () => {
    void ipcRenderer.invoke(IPC.windowMinimize)
  },
  windowClose: () => {
    void ipcRenderer.invoke(IPC.windowClose)
  },
  updaterInstall: () => ipcRenderer.invoke(IPC.updaterInstall),
  updaterCheck: () => ipcRenderer.invoke(IPC.updaterCheck),
  dxvkEnable: () => ipcRenderer.invoke(IPC.dxvkEnable),
  dxvkDisable: () => ipcRenderer.invoke(IPC.dxvkDisable),
  onPatcherState: on<PatcherStateEvent>(IPC.patcherState),
  onPatcherProgress: on<PatcherProgressEvent>(IPC.patcherProgress),
  onUpdaterStatus: on<UpdaterStatusEvent>(IPC.updaterStatus),
}

contextBridge.exposeInMainWorld('yufa', api)
