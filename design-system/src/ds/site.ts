/** Where this page and the registry live once deployed */
export const SITE = "https://solana-playground-ds.vercel.app"

/** The command that installs one of our components into a shadcn project */
export const install = (name: string) => `npx shadcn@latest add ${SITE}/r/${name}.json`
