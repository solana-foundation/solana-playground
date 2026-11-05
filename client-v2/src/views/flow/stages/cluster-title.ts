/** The cluster as the status rows name it: "devnet" reads "Devnet" */
export const clusterTitle = (cluster: string) =>
  cluster.charAt(0).toUpperCase() + cluster.slice(1);
