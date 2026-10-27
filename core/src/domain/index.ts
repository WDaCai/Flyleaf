export * from './paths';
export * from './text';
export * from './frontmatter';
export * from './state';
export * from './outline';
export * from './wikilink';
export * from './hash';
export * from './tree';
export * from './search';
export * from './capture';
// FolderEntry / FoldersConfig 与 contracts 同名，只从本模块导出纯函数与常量
export {
  FOLDERS_FILE,
  SYSTEM_ENSURE_DIRS,
  PROTECTED_FOLDER_PATHS,
  DEFAULT_FOLDER_SEED,
  normalizeFolderPath,
  validateFolderPath,
  isProtectedFolderPath,
  slugFolderName,
  normalizeFoldersConfig,
  seedFromExisting,
  canDeleteFolder,
  pickNextInbox,
} from './folders';
