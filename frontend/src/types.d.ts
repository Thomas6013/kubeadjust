// TypeScript 6 requires explicit type declarations for non-TS side-effect imports.
// Covers global CSS imports such as `import './globals.css'` in layout.tsx.
declare module '*.css' {}
