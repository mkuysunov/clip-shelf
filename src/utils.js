const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;

// Тип карточки истории: link / text / image
export function kindOf(item) {
  if (item.type === 'image') return 'image';
  return URL_RE.test(item.text.trim()) ? 'link' : 'text';
}

export function hostOf(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const KIND_COLOR = {
  text: 'var(--c-text)',
  link: 'var(--c-link)',
  image: 'var(--c-image)',
};

export const KIND_LABEL_KEY = { text: 'kindText', link: 'kindLink', image: 'kindImage' };

// Палитра для новых коллекций (по кругу)
export const COLLECTION_COLORS = ['#ff5a5f', '#c65cf0', '#2f7bf5', '#34c759', '#ff9500', '#f2b705', '#5ac8fa'];

// Заголовок сниппета по умолчанию: первая непустая строка
export function defaultTitle(text, fallback) {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export const DND_TYPE = 'application/x-clipshelf-id';
