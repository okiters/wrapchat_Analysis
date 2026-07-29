import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped into the bundle so a running app can say which build it is. The
// edge function logs it per call, which is how a stale install gets spotted
// (a sync that never ran leaves the device on a build the logs still name).
function buildStamp() {
  let sha = 'nogit'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // Building outside a git checkout — the timestamp alone still identifies it.
  }
  return `${sha}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __WRAPCHAT_BUILD__: JSON.stringify(buildStamp()),
  },
})
