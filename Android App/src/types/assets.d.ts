// Allow importing static image assets (resolved by the Metro bundler at build time).
declare module '*.png' {
  const value: number;
  export default value;
}
