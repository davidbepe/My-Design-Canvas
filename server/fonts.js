// Daftar Google Fonts populer yang bisa dipilih di editor.
// Setiap font: [nama, kategori, ketebalan yang tersedia (format API css2: "100..900" atau "400;700")].
export const GOOGLE_FONTS = [
  ['Inter', 'sans-serif', '100..900'],
  ['Roboto', 'sans-serif', '100..900'],
  ['Open Sans', 'sans-serif', '300..800'],
  ['Poppins', 'sans-serif', '100;200;300;400;500;600;700;800;900'],
  ['Montserrat', 'sans-serif', '100..900'],
  ['Lato', 'sans-serif', '100;300;400;700;900'],
  ['Plus Jakarta Sans', 'sans-serif', '200..800'],
  ['DM Sans', 'sans-serif', '100..1000'],
  ['Manrope', 'sans-serif', '200..800'],
  ['Nunito', 'sans-serif', '200..1000'],
  ['Work Sans', 'sans-serif', '100..900'],
  ['Raleway', 'sans-serif', '100..900'],
  ['Outfit', 'sans-serif', '100..900'],
  ['Space Grotesk', 'sans-serif', '300..700'],
  ['Sora', 'sans-serif', '100..800'],
  ['Figtree', 'sans-serif', '300..900'],
  ['Urbanist', 'sans-serif', '100..900'],
  ['Lexend', 'sans-serif', '100..900'],
  ['Rubik', 'sans-serif', '300..900'],
  ['Karla', 'sans-serif', '200..800'],
  ['IBM Plex Sans', 'sans-serif', '100;200;300;400;500;600;700'],
  ['Source Sans 3', 'sans-serif', '200..900'],
  ['Noto Sans', 'sans-serif', '100..900'],
  ['Mulish', 'sans-serif', '200..1000'],
  ['Barlow', 'sans-serif', '100;200;300;400;500;600;700;800;900'],
  ['Archivo', 'sans-serif', '100..900'],
  ['Oswald', 'sans-serif', '200..700'],
  ['Bebas Neue', 'sans-serif', '400'],
  ['Playfair Display', 'serif', '400..900'],
  ['Merriweather', 'serif', '300;400;700;900'],
  ['Lora', 'serif', '400..700'],
  ['DM Serif Display', 'serif', '400'],
  ['Fraunces', 'serif', '100..900'],
  ['Libre Baskerville', 'serif', '400;700'],
  ['Cormorant Garamond', 'serif', '300..700'],
  ['EB Garamond', 'serif', '400..800'],
  ['JetBrains Mono', 'monospace', '100..800'],
  ['Fira Code', 'monospace', '300..700'],
  ['IBM Plex Mono', 'monospace', '100;200;300;400;500;600;700'],
  ['Space Mono', 'monospace', '400;700'],
  ['Caveat', 'cursive', '400..700'],
  ['Pacifico', 'cursive', '400'],
];

const BY_NAME = new Map(GOOGLE_FONTS.map((f) => [f[0].toLowerCase(), f]));

// Nama font pertama dari nilai font-family, mis. '"Plus Jakarta Sans", sans-serif' -> 'Plus Jakarta Sans'.
export function primaryFamily(fontFamily) {
  return fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
}

export function isGoogleFont(name) {
  return BY_NAME.has(name.toLowerCase());
}

// URL stylesheet Google Fonts untuk beberapa font sekaligus.
export function googleFontsUrl(names) {
  const families = [...new Set(names)]
    .map((n) => BY_NAME.get(n.toLowerCase()))
    .filter(Boolean)
    .map(([name, , weights]) => `family=${name.replace(/ /g, '+')}:wght@${weights}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}
