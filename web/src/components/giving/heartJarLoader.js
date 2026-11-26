// Loads the <heart-jar> element from public/heart-jar, in the browser and only
// on the pages that show a jar: first heart-jar-assets.js (its pictures and
// layout, about 1.6 MB, kept by the browser after the first visit), then
// heart-jar.js, which defines the element. Every jar waits on the same
// promise, so the two scripts are added once however many jars a page has,
// and not again on the next Giving page the visitor opens.

const ASSETS_SRC = '/heart-jar/heart-jar-assets.js';
const ELEMENT_SRC = '/heart-jar/heart-jar.js';

let loading = null;

function addScript(src) {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new Error(`Could not load ${src}`));
    const old = document.querySelector(`script[data-heart-jar="${src}"]`);
    if (old) {
      if (old.dataset.loaded === '1') resolve();
      else {
        old.addEventListener('load', () => resolve(), { once: true });
        old.addEventListener('error', failed, { once: true });
      }
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.heartJar = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = failed;
    document.head.appendChild(s);
  });
}

// Resolves once customElements.whenDefined('heart-jar') has.
export function loadHeartJar() {
  if (typeof window === 'undefined') return Promise.reject(new Error('<heart-jar> loads in the browser only'));
  if (window.customElements.get('heart-jar')) return Promise.resolve();
  if (!loading) {
    loading = (window.HeartJarAssets ? Promise.resolve() : addScript(ASSETS_SRC))
      .then(() => addScript(ELEMENT_SRC))
      .then(() => window.customElements.whenDefined('heart-jar'))
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}
