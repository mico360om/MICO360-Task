// Allow importing static image assets (resolved by the Metro bundler at build time).
declare module '*.png' {
  const value: number;
  export default value;
}

// The bundled fonts (assets/fonts, loaded by core/fonts.ts).
declare module '*.ttf' {
  const value: number;
  export default value;
}
