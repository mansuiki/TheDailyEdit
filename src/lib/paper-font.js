let headlineFontCSS;

// SVG/PNG captures need an embedded font; a loaded page font alone is not enough.
// Keep this local so capture does not depend on third-party font services.
export function getHeadlineFontCSS() {
  headlineFontCSS ??= fetch('/fonts/instrument-serif/InstrumentSerif-Regular.ttf')
    .then(async (response) => {
      if (!response.ok) throw new Error('Could not load the newspaper headline font.');
      const blob = await response.blob();
      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return `@font-face { font-family: 'Instrument Serif'; src: url('${dataURL}') format('truetype'); font-weight: 400; font-style: normal; }`;
    })
    .catch((error) => {
      headlineFontCSS = undefined;
      throw error;
    });
  return headlineFontCSS;
}
