import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

export default clientBundle('@deepseek-ai/dsh-experimental-task-strategy', ['lib/types/index.js'], {
  hostPhase: true,
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
  companions: [{
    entry: ['lib/types/cordis.js', 'lib/types/task-runtime-service.js', 'lib/types/plugin-codex.js', 'lib/types/plugin-claude.js', 'lib/types/plugin-zcode.js',
      'lib/types/plugin-codex-style.js', 'lib/types/plugin-claude-style.js', 'lib/types/plugin-zcode-style.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
  }],
})
