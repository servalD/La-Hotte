/**
 * Nom lisible d'un appareil à partir de son agent utilisateur (« Chrome · Windows »). Pur et sans
 * dépendance : il ne sert qu'à l'affichage, jamais à une décision. Faute de reconnaître l'agent, on
 * rend `null` et l'appelant affiche l'agent brut.
 */
export function deviceName(userAgent: string): string | null {
  const ua = userAgent;
  // L'ordre compte : Edge et Opera se déclarent aussi Chrome, Chrome se déclare aussi Safari.
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const system = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null;
  if (browser === null && system === null) return null;
  return [browser, system].filter((part): part is string => part !== null).join(' · ');
}
