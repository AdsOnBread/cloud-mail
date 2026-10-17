import i18next from 'i18next';
import en from './en.js';

i18next.init({
	lng: 'en',
	fallbackLng: 'en',
	resources: { en: { translation: en } }
});

export const t = (key, values) => i18next.t(key, values);
export default i18next;
