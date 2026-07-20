declare module '*.css?inline' {
  const content: string;
  // eslint-disable-next-line import-x/no-default-export -- Vite's CSS-inline shape is default-export
  export default content;
}
