import type { MetadataRoute } from 'next';

/**
 * PWA-01 : manifeste complet (nom, icônes dont masquables, couleurs, `standalone`, raccourcis) ;
 * PWA-02 : cible de partage, chemin principal d'ajout sur mobile. L'identité visuelle définitive
 * reste à décider (`10`, question 1) : icônes provisoires.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'La Hotte',
    short_name: 'La Hotte',
    description: 'Listes de souhaits et cadeaux en famille',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbf7f0',
    theme_color: '#fbf7f0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Ajouter un souhait',
        url: '/share',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Mon panier',
        url: '/cart',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
    share_target: {
      action: '/share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  };
}
