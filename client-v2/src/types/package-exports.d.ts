// `moduleResolution: "node"` ignores package `exports`; these types cannot sit in tsconfig `paths`, which webpack and vitest resolve runtime imports through
declare module "cn/config" {
  export * from "cn/dist/config";
}

declare module "@shadcn/react/message-scroller" {
  export * from "@shadcn/react/dist/message-scroller";
}
