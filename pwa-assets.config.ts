import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const darkBackground = { background: '#060a0f', fit: 'contain' as const }

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.1, resizeOptions: darkBackground },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: darkBackground },
  },
  images: ['public/app-icon.svg'],
})
