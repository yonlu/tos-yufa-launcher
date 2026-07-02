import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ptBR from './locales/pt-BR.json'

void i18n.use(initReactI18next).init({
  resources: {
    'pt-BR': { translation: ptBR },
    en: { translation: en },
  },
  lng: 'pt-BR',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n

/** Picks the best language variant from a { lang: text } map. */
export function pickText(loc: Record<string, string>, lang: string): string {
  return loc[lang] ?? loc['en'] ?? loc['pt-BR'] ?? Object.values(loc)[0] ?? ''
}
