export { TitleService, TitleSourceKey, type ITitleSource } from './title-service.js'
export { attachTitleBar } from './title-bar.js'
export { removeSplash, type SplashDocument, type SplashElement } from './splash.js'
// The compiled PragmaticWindowChrome module (its `resources:` merge app-global on
// AddModule; its `.services:` registers TitleService). Apps add it to their shell.
export { PragmaticWindowChrome } from './window-chrome.module.mu.js'
