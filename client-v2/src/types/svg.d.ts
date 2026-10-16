declare module "*.svg" {
  /** URL of the bundled asset, as `react-scripts` resolves it */
  const url: string;
  export default url;
}
