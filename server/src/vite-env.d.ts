declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare module "*.png" {
  const url: string;
  export default url;
}
