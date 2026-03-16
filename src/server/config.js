import { existsSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const projectRoot = resolve(__dirname, '..', '..')
export const frontendDistDir = resolve(projectRoot, 'dist')
export const host = process.env.DUCKPULL_HOST || '127.0.0.1'
export const port = Number(process.env.DUCKPULL_PORT || 5767)

const configuredDataDir = process.env.DUCKPULL_DATA_DIR || './data/runtime'
export const dataDir = isAbsolute(configuredDataDir)
  ? configuredDataDir
  : resolve(projectRoot, configuredDataDir)

export const dbPath = join(dataDir, 'duckpull.db')
export const defaultDestinationDir = join(dataDir, 'synced-artifacts')

export function ensureDir(target) {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true })
  }
}

ensureDir(dataDir)
ensureDir(defaultDestinationDir)
