import { ThreeDots } from "./ThreeDots";

export const AppLoading = () => (
  <div className="relative h-dvh w-screen [&>:first-child]:absolute [&>:first-child]:bottom-4 [&>:first-child]:left-8">
    <ThreeDots />
  </div>
);
